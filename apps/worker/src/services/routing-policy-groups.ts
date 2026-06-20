import { jsonParse, jsonStringify } from '../db/helpers';

type GroupRow = Record<string, unknown>;

export async function syncRoutingPolicyGroups(db: D1Database, ts: string): Promise<void> {
  const { results } = await db
    .prepare('SELECT id, type, collection_ids, enabled, is_builtin FROM groups ORDER BY sort_order ASC, created_at ASC')
    .all<GroupRow>();

  const outletGroupIds = resolveOutletGroupIds(results);
  const routingGroupIds = resolveRoutingGroupIds(results);

  if (routingGroupIds.length === 0) return;

  const nextGroupIds = jsonStringify(outletGroupIds);
  await db.batch(
    routingGroupIds.map((id) =>
      db
        .prepare('UPDATE groups SET group_ids = ?, updated_at = ? WHERE id = ?')
        .bind(nextGroupIds, ts, id)
    )
  );
}

export function applyRoutingPolicyGroupLinks<T extends GroupRow>(groupRows: T[]): T[] {
  const outletGroupIds = resolveOutletGroupIds(groupRows);
  const routingGroupIds = new Set(resolveRoutingGroupIds(groupRows));
  const nextGroupIds = jsonStringify(outletGroupIds);

  return groupRows.map((row) => (
    routingGroupIds.has(String(row.id))
      ? { ...row, group_ids: nextGroupIds }
      : row
  ));
}

export function resolveOutletGroupIds(groupRows: GroupRow[]): string[] {
  return groupRows
    .filter((row) => Boolean(row.enabled))
    .filter((row) => parseIds(row.collection_ids).length > 0)
    .map((row) => String(row.id))
    .filter(Boolean);
}

export function resolveRoutingGroupIds(groupRows: GroupRow[]): string[] {
  return groupRows
    .filter((row) => Boolean(row.enabled))
    .filter((row) => Boolean(row.is_builtin))
    .filter((row) => !['direct', 'reject'].includes(String(row.type)))
    .filter((row) => parseIds(row.collection_ids).length === 0)
    .map((row) => String(row.id))
    .filter(Boolean);
}

function parseIds(value: unknown): string[] {
  return typeof value === 'string' ? jsonParse<string[]>(value) ?? [] : [];
}
