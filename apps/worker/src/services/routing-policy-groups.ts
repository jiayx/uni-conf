import {
  buildRoutingPolicyTemplateGroupNames,
  detectCountry,
  DEFAULT_HEALTH_CHECK,
  GLOBAL_NODE_OUTLET_GROUP_IDS,
  ROUTING_POLICY_TEMPLATES,
  type RoutingPolicyTemplate,
} from '@uni-conf/shared';
import { jsonParse, jsonStringify } from '../db/helpers';
import { getAppSettings } from './app-settings';

type GroupRow = Record<string, unknown>;

const DEFAULT_PROXY_GROUP_ID = 'builtin-proxy';
export const ALL_NODE_OUTLET_GROUP_IDS: string[] = [...GLOBAL_NODE_OUTLET_GROUP_IDS];
const DEFAULT_MEMBER_GROUP_IDS = [
  DEFAULT_PROXY_GROUP_ID,
  'builtin-direct',
  'builtin-reject',
  ...ALL_NODE_OUTLET_GROUP_IDS,
];

const GENERAL_OUTLET_ORDER = [
  'builtin-auto-select',
  'builtin-node-select',
  'builtin-fallback-select',
  'builtin-all-nodes',
  DEFAULT_PROXY_GROUP_ID,
  'builtin-direct',
  'builtin-reject',
];

const ROUTING_COUNTRY_PREFERENCES: Record<string, string[]> = {
  AI: ['US', 'JP', 'SG'],
  STREAMING: ['HK', 'JP', 'SG', 'TW', 'US'],
  TELEGRAM: ['SG', 'HK', 'JP', 'US'],
};

const ROUTING_TAG_GROUP_PREFERENCES: Record<string, string[]> = {
  AI: ['native'],
  STREAMING: ['streaming', 'native'],
};

const DEFAULT_GENERATED_GROUPS = [
  { id: 'builtin-proxy', name: 'PROXY', type: 'select', sortOrder: 0, builtins: [] },
  { id: 'builtin-ai', name: 'AI', type: 'select', sortOrder: 1, builtins: [] },
  { id: 'builtin-streaming', name: 'Streaming', type: 'select', sortOrder: 2, builtins: [] },
  { id: 'builtin-telegram', name: 'Telegram', type: 'select', sortOrder: 3, builtins: [] },
  { id: 'builtin-social', name: 'Social', type: 'select', sortOrder: 4, builtins: [] },
  { id: 'builtin-github', name: 'GitHub', type: 'select', sortOrder: 5, builtins: [] },
  { id: 'builtin-apple', name: 'Apple', type: 'select', sortOrder: 6, builtins: [] },
  { id: 'builtin-microsoft', name: 'Microsoft', type: 'select', sortOrder: 7, builtins: [] },
  { id: 'builtin-final', name: '漏网之鱼', type: 'select', sortOrder: 8, builtins: [] },
  { id: 'builtin-crypto', name: 'Crypto', type: 'select', sortOrder: 9, builtins: [] },
  { id: 'builtin-gaming', name: 'Gaming', type: 'select', sortOrder: 10, builtins: [] },
  { id: 'builtin-developer', name: 'Developer', type: 'select', sortOrder: 11, builtins: [] },
  { id: 'builtin-direct', name: 'DIRECT', type: 'direct', sortOrder: 12, builtins: ['DIRECT'] },
  { id: 'builtin-reject', name: 'REJECT', type: 'reject', sortOrder: 13, builtins: ['REJECT'] },
  { id: 'builtin-all-nodes', name: '全部节点', type: 'select', sortOrder: 14, builtins: [] },
  { id: 'builtin-node-select', name: '节点选择', type: 'select', sortOrder: 15, builtins: [] },
  { id: 'builtin-auto-select', name: '自动选择', type: 'url-test', sortOrder: 16, builtins: [] },
  { id: 'builtin-fallback-select', name: '故障切换', type: 'fallback', sortOrder: 17, builtins: [] },
];

export async function syncRoutingPolicyGroups(db: D1Database, ts: string): Promise<void> {
  await ensureDefaultGeneratedGroups(db, ts);
  await applyActiveTemplate(db, ts);

  const { results } = await db
    .prepare('SELECT id, name, type, collection_ids, enabled, is_builtin FROM groups ORDER BY sort_order ASC, created_at ASC')
    .all<GroupRow>();

  const routingGroupIds = resolveRoutingGroupIds(results);
  const outletPreferences = await getRoutingOutletPreferences(db);

  if (routingGroupIds.length === 0) return;

  await db.batch(
    routingGroupIds.map((id) =>
      db
        .prepare('UPDATE groups SET group_ids = ?, updated_at = ? WHERE id = ?')
        .bind(jsonStringify(resolveRoutingMemberGroupIds(results, id, outletPreferences)), ts, id)
    )
  );
}

export function applyRoutingPolicyGroupLinks<T extends GroupRow>(
  groupRows: T[],
  outletPreferences: Record<string, string> = {}
): T[] {
  const routingGroupIds = new Set(resolveRoutingGroupIds(groupRows));

  return groupRows.map((row) => (
    routingGroupIds.has(String(row.id))
      ? { ...row, group_ids: jsonStringify(resolveRoutingMemberGroupIds(groupRows, String(row.id), outletPreferences)) }
      : row
  ));
}

export function resolveOutletGroupIds(groupRows: GroupRow[]): string[] {
  const defaultIds = DEFAULT_MEMBER_GROUP_IDS.filter((id) =>
    groupRows.some((row) => String(row.id) === id && Boolean(row.enabled))
  );
  const nodeBackedIds = groupRows
    .filter((row) => Boolean(row.enabled))
    .filter((row) => parseIds(row.collection_ids).length > 0)
    .map((row) => String(row.id))
    .filter(Boolean);

  return [...new Set([...defaultIds, ...nodeBackedIds])];
}

export function resolveRoutingGroupIds(groupRows: GroupRow[]): string[] {
  const defaultOutletIds = new Set(DEFAULT_MEMBER_GROUP_IDS);
  return groupRows
    .filter((row) => Boolean(row.enabled))
    .filter((row) => !defaultOutletIds.has(String(row.id)) || String(row.id) === DEFAULT_PROXY_GROUP_ID)
    .filter((row) => !['direct', 'reject'].includes(String(row.type)))
    .filter((row) => parseIds(row.collection_ids).length === 0)
    .map((row) => String(row.id))
    .filter(Boolean);
}

export function resolveRoutingMemberGroupIds(
  groupRows: GroupRow[],
  routingGroupId: string,
  outletPreferences: Record<string, string> = {}
): string[] {
  return sortRoutingMemberGroupIds(
    resolveOutletGroupIds(groupRows).filter((id) => id !== routingGroupId),
    groupRows,
    routingGroupId,
    outletPreferences
  );
}

export function resolveActiveTemplateGroupNames(template: RoutingPolicyTemplate): Set<string> {
  return new Set(buildRoutingPolicyTemplateGroupNames(template).map((name) => name.toUpperCase()));
}

export function resolveManagedTemplateGroupNames(): Set<string> {
  return new Set(
    ROUTING_POLICY_TEMPLATES
      .flatMap((item) => buildRoutingPolicyTemplateGroupNames(item))
      .map((name) => name.toUpperCase())
  );
}

function sortRoutingMemberGroupIds(
  outletIds: string[],
  groupRows: GroupRow[],
  routingGroupId: string,
  outletPreferences: Record<string, string>
): string[] {
  const rowsById = new Map(groupRows.map((row) => [String(row.id), row]));
  const routingGroupName = String(rowsById.get(routingGroupId)?.name ?? routingGroupId).toUpperCase();
  const countryPreferences = ROUTING_COUNTRY_PREFERENCES[routingGroupName] ?? [];
  const preferredOutletId = outletPreferences[routingGroupId];
  const used = new Set<string>();
  const ordered: string[] = [];

  const push = (id: string) => {
    if (!outletIds.includes(id) || used.has(id)) return;
    ordered.push(id);
    used.add(id);
  };

  if (preferredOutletId) push(preferredOutletId);

  for (const tagKey of ROUTING_TAG_GROUP_PREFERENCES[routingGroupName] ?? []) {
    for (const id of outletIds) {
      if (tagGroupKeyFromGroup(rowsById.get(id)) === tagKey) push(id);
    }
  }

  for (const countryCode of countryPreferences) {
    for (const id of outletIds) {
      if (countryCodeFromGroup(rowsById.get(id)) === countryCode) push(id);
    }
  }

  for (const id of GENERAL_OUTLET_ORDER) push(id);

  for (const id of outletIds) push(id);

  return ordered;
}

function countryCodeFromGroup(row: GroupRow | undefined): string | undefined {
  if (!row || parseIds(row.collection_ids).length === 0) return undefined;
  return detectCountry(String(row.name ?? ''))?.countryCode;
}

function tagGroupKeyFromGroup(row: GroupRow | undefined): string | undefined {
  if (!row || parseIds(row.collection_ids).length === 0) return undefined;
  const name = String(row.name ?? '').toUpperCase();
  if (name.includes('STREAMING')) return 'streaming';
  if (name.includes('NATIVE')) return 'native';
  return undefined;
}

async function ensureDefaultGeneratedGroups(db: D1Database, ts: string): Promise<void> {
  const insertStatements = DEFAULT_GENERATED_GROUPS.map((group) =>
    db.prepare(
      `INSERT OR IGNORE INTO groups
        (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`
    ).bind(
      group.id,
      group.name,
      group.type,
      jsonStringify(group.builtins),
      DEFAULT_HEALTH_CHECK.testUrl,
      DEFAULT_HEALTH_CHECK.interval,
      DEFAULT_HEALTH_CHECK.tolerance,
      DEFAULT_HEALTH_CHECK.lazy ? 1 : 0,
      group.sortOrder,
      ts,
      ts
    )
  );
  const canonicalStatements = DEFAULT_GENERATED_GROUPS.map((group) =>
    db.prepare(
      `UPDATE groups SET
        name = ?,
        type = ?,
        collection_ids = '[]',
        builtins = ?,
        test_url = ?,
        interval = ?,
        tolerance = ?,
        lazy = ?,
        sort_order = ?,
        is_builtin = 1,
        updated_at = ?
       WHERE id = ?`
    ).bind(
      group.name,
      group.type,
      jsonStringify(group.builtins),
      DEFAULT_HEALTH_CHECK.testUrl,
      DEFAULT_HEALTH_CHECK.interval,
      DEFAULT_HEALTH_CHECK.tolerance,
      DEFAULT_HEALTH_CHECK.lazy ? 1 : 0,
      group.sortOrder,
      ts,
      group.id
    )
  );

  await db.batch(insertStatements);
  await db.batch(canonicalStatements);
}

async function applyActiveTemplate(db: D1Database, ts: string): Promise<void> {
  const template = await getActiveTemplate(db);
  const activeNames = resolveActiveTemplateGroupNames(template);
  const templateGroupNames = resolveManagedTemplateGroupNames();
  const statements = DEFAULT_GENERATED_GROUPS
    .filter((group) => templateGroupNames.has(group.name.toUpperCase()))
    .map((group) =>
      db
        .prepare('UPDATE groups SET enabled = ?, updated_at = ? WHERE id = ?')
        .bind(activeNames.has(group.name.toUpperCase()) ? 1 : 0, ts, group.id)
    );

  if (statements.length > 0) await db.batch(statements);
}

async function getActiveTemplate(db: D1Database) {
  const settings = await getAppSettings(db);
  return ROUTING_POLICY_TEMPLATES.find((template) => template.id === settings.routingPolicyTemplate)
    ?? ROUTING_POLICY_TEMPLATES.find((template) => template.id === 'common')
    ?? ROUTING_POLICY_TEMPLATES[0]!;
}

async function getRoutingOutletPreferences(db: D1Database): Promise<Record<string, string>> {
  return (await getAppSettings(db)).routingOutletPreferences ?? {};
}

function parseIds(value: unknown): string[] {
  return typeof value === 'string' ? jsonParse<string[]>(value) ?? [] : [];
}
