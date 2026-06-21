import { detectCountry, ROUTING_POLICY_TEMPLATES } from '@uni-conf/shared';
import { jsonParse, jsonStringify } from '../db/helpers';

type GroupRow = Record<string, unknown>;

const DEFAULT_PROXY_GROUP_ID = 'builtin-proxy';
export const ALL_NODE_OUTLET_GROUP_IDS = [
  'builtin-all-nodes',
  'builtin-node-select',
  'builtin-auto-select',
  'builtin-fallback-select',
];
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

const DEFAULT_GENERATED_GROUPS = [
  { id: 'builtin-proxy', name: 'PROXY', type: 'select', sortOrder: 0, builtins: ['DIRECT'] },
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

  if (routingGroupIds.length === 0) return;

  await db.batch(
    routingGroupIds.map((id) =>
      db
        .prepare('UPDATE groups SET group_ids = ?, updated_at = ? WHERE id = ?')
        .bind(jsonStringify(resolveRoutingMemberGroupIds(results, id)), ts, id)
    )
  );
}

export function applyRoutingPolicyGroupLinks<T extends GroupRow>(groupRows: T[]): T[] {
  const routingGroupIds = new Set(resolveRoutingGroupIds(groupRows));

  return groupRows.map((row) => (
    routingGroupIds.has(String(row.id))
      ? { ...row, group_ids: jsonStringify(resolveRoutingMemberGroupIds(groupRows, String(row.id))) }
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
    .filter((row) => Boolean(row.is_builtin))
    .filter((row) => !defaultOutletIds.has(String(row.id)) || String(row.id) === DEFAULT_PROXY_GROUP_ID)
    .filter((row) => !['direct', 'reject'].includes(String(row.type)))
    .filter((row) => parseIds(row.collection_ids).length === 0)
    .map((row) => String(row.id))
    .filter(Boolean);
}

export function resolveRoutingMemberGroupIds(groupRows: GroupRow[], routingGroupId: string): string[] {
  return sortRoutingMemberGroupIds(
    resolveOutletGroupIds(groupRows).filter((id) => id !== routingGroupId),
    groupRows,
    routingGroupId
  );
}

function sortRoutingMemberGroupIds(outletIds: string[], groupRows: GroupRow[], routingGroupId: string): string[] {
  const rowsById = new Map(groupRows.map((row) => [String(row.id), row]));
  const routingGroupName = String(rowsById.get(routingGroupId)?.name ?? routingGroupId).toUpperCase();
  const countryPreferences = ROUTING_COUNTRY_PREFERENCES[routingGroupName] ?? [];
  const used = new Set<string>();
  const ordered: string[] = [];

  const push = (id: string) => {
    if (!outletIds.includes(id) || used.has(id)) return;
    ordered.push(id);
    used.add(id);
  };

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

async function ensureDefaultGeneratedGroups(db: D1Database, ts: string): Promise<void> {
  const statements = DEFAULT_GENERATED_GROUPS.map((group) =>
    db.prepare(
      `INSERT OR IGNORE INTO groups
        (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, '[]', '[]', ?, ?, 300, 150, 1, 1, ?, 1, ?, ?)`
    ).bind(
      group.id,
      group.name,
      group.type,
      jsonStringify(group.builtins),
      'http://www.gstatic.com/generate_204',
      group.sortOrder,
      ts,
      ts
    )
  );

  await db.batch(statements);
}

async function applyActiveTemplate(db: D1Database, ts: string): Promise<void> {
  const template = await getActiveTemplate(db);
  const activeNames = new Set(template.groupNames.map((name) => name.toUpperCase()));
  const templateGroupNames = new Set(
    ROUTING_POLICY_TEMPLATES.flatMap((item) => item.groupNames).map((name) => name.toUpperCase())
  );
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
  const row = await db
    .prepare("SELECT routing_policy_template FROM app_settings WHERE id = 'singleton'")
    .first<{ routing_policy_template: string | null }>();
  return ROUTING_POLICY_TEMPLATES.find((template) => template.id === row?.routing_policy_template)
    ?? ROUTING_POLICY_TEMPLATES.find((template) => template.id === 'common')
    ?? ROUTING_POLICY_TEMPLATES[0]!;
}

function parseIds(value: unknown): string[] {
  return typeof value === 'string' ? jsonParse<string[]>(value) ?? [] : [];
}
