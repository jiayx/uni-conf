import { GLOBAL_NODE_OUTLET_GROUP_IDS, RULE_TARGET_FOUNDATION_GROUP_IDS, isRuleTargetGroup } from '@uni-conf/shared';
import { jsonParse } from '../db/helpers';

export const DEFAULT_RULE_TARGET_GROUP_ID = RULE_TARGET_FOUNDATION_GROUP_IDS[0];

export async function isEnabledTargetGroup(db: D1Database, id: string): Promise<boolean> {
  if (!isRuleTargetGroup({ id })) return false;

  const row = await db
    .prepare(
      `SELECT id, collection_ids FROM groups
       WHERE id = ?
         AND enabled = 1
         AND (collection_ids IS NULL OR collection_ids = '[]')
         AND id NOT IN (${GLOBAL_NODE_OUTLET_GROUP_IDS.map(() => '?').join(',')})`
    )
    .bind(id, ...GLOBAL_NODE_OUTLET_GROUP_IDS)
    .first<{ id: string; collection_ids?: string | null }>();
  return Boolean(row && isRuleTargetGroup({ id: row.id, collectionIds: parseCollectionIds(row.collection_ids) }));
}

export async function listEnabledTargetGroupIds(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT id, collection_ids FROM groups
       WHERE enabled = 1
         AND (collection_ids IS NULL OR collection_ids = '[]')
         AND id NOT IN (${GLOBAL_NODE_OUTLET_GROUP_IDS.map(() => '?').join(',')})`
    )
    .bind(...GLOBAL_NODE_OUTLET_GROUP_IDS)
    .all<{ id: string; collection_ids: string | null }>();
  return new Set(
    results
      .filter((row) => isRuleTargetGroup({ id: row.id, collectionIds: parseCollectionIds(row.collection_ids) }))
      .map((row) => row.id)
  );
}

export function normalizeRuleTargetGroupId(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_RULE_TARGET_GROUP_ID;
  const id = value.trim();
  return id || DEFAULT_RULE_TARGET_GROUP_ID;
}

function parseCollectionIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return jsonParse<string[]>(value) ?? [];
}
