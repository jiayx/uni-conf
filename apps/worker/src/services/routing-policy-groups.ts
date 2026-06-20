import { ROUTING_POLICY_TEMPLATES } from '@uni-conf/shared';
import { jsonParse, jsonStringify } from '../db/helpers';

type GroupRow = Record<string, unknown>;

const DEFAULT_PROXY_GROUP_ID = 'builtin-proxy';
export const ALL_NODE_OUTLET_GROUP_IDS = [
  'builtin-all-nodes',
  'builtin-node-select',
  'builtin-auto-select',
];
const DEFAULT_MEMBER_GROUP_IDS = [
  DEFAULT_PROXY_GROUP_ID,
  'builtin-direct',
  'builtin-reject',
  ...ALL_NODE_OUTLET_GROUP_IDS,
];

const DEFAULT_GENERATED_GROUPS = [
  { id: 'builtin-proxy', name: 'PROXY', type: 'select', sortOrder: 0, builtins: ['DIRECT'] },
  { id: 'builtin-ai', name: 'AI', type: 'select', sortOrder: 1, builtins: [] },
  { id: 'builtin-streaming', name: 'Streaming', type: 'select', sortOrder: 2, builtins: [] },
  { id: 'builtin-social', name: 'Social', type: 'select', sortOrder: 3, builtins: [] },
  { id: 'builtin-github', name: 'GitHub', type: 'select', sortOrder: 4, builtins: [] },
  { id: 'builtin-apple', name: 'Apple', type: 'select', sortOrder: 5, builtins: [] },
  { id: 'builtin-microsoft', name: 'Microsoft', type: 'select', sortOrder: 6, builtins: [] },
  { id: 'builtin-crypto', name: 'Crypto', type: 'select', sortOrder: 7, builtins: [] },
  { id: 'builtin-gaming', name: 'Gaming', type: 'select', sortOrder: 8, builtins: [] },
  { id: 'builtin-developer', name: 'Developer', type: 'select', sortOrder: 9, builtins: [] },
  { id: 'builtin-direct', name: 'DIRECT', type: 'direct', sortOrder: 10, builtins: ['DIRECT'] },
  { id: 'builtin-reject', name: 'REJECT', type: 'reject', sortOrder: 11, builtins: ['REJECT'] },
  { id: 'builtin-all-nodes', name: '全部节点', type: 'select', sortOrder: 12, builtins: [] },
  { id: 'builtin-node-select', name: '节点选择', type: 'select', sortOrder: 13, builtins: [] },
  { id: 'builtin-auto-select', name: '自动选择', type: 'url-test', sortOrder: 14, builtins: [] },
];

export async function syncRoutingPolicyGroups(db: D1Database, ts: string): Promise<void> {
  await ensureDefaultGeneratedGroups(db, ts);
  await applyActiveTemplate(db, ts);

  const { results } = await db
    .prepare('SELECT id, type, collection_ids, enabled, is_builtin FROM groups ORDER BY sort_order ASC, created_at ASC')
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
  return resolveOutletGroupIds(groupRows).filter((id) => id !== routingGroupId);
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
