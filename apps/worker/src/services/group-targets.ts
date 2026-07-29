import { DEFAULT_RULE_TARGET_GROUP_ID, GLOBAL_NODE_OUTLET_GROUP_IDS, isRuleTargetGroup } from '@uni-conf/shared';
import { jsonParse } from '../db/helpers';
import { DEFAULT_WORKSPACE_ID, workspaceEntityId } from './workspaces';

export { DEFAULT_RULE_TARGET_GROUP_ID };

export async function isEnabledTargetGroup(
  db: D1Database,
  id: string,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<boolean> {
  if (!isWorkspaceRuleTargetGroup(id)) return false;

  const row = await db
    .prepare(
      `SELECT id, collection_ids FROM groups
       WHERE id = ?
         AND workspace_id = ?
         AND enabled = 1
         AND (collection_ids IS NULL OR collection_ids = '[]')
         AND id NOT IN (${GLOBAL_NODE_OUTLET_GROUP_IDS.map(() => '?').join(',')})`
    )
    .bind(id, workspaceId, ...GLOBAL_NODE_OUTLET_GROUP_IDS.map(groupId => workspaceEntityId(workspaceId, groupId)))
    .first<{ id: string; collection_ids?: string | null }>();
  return Boolean(row && isWorkspaceRuleTargetGroup(row.id, parseCollectionIds(row.collection_ids)));
}

export async function listEnabledTargetGroupIds(
  db: D1Database,
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<Set<string>> {
  const { results } = await db
    .prepare(
      `SELECT id, collection_ids FROM groups
       WHERE workspace_id = ?
         AND enabled = 1
         AND (collection_ids IS NULL OR collection_ids = '[]')
         AND id NOT IN (${GLOBAL_NODE_OUTLET_GROUP_IDS.map(() => '?').join(',')})`
    )
    .bind(workspaceId, ...GLOBAL_NODE_OUTLET_GROUP_IDS.map(groupId => workspaceEntityId(workspaceId, groupId)))
    .all<{ id: string; collection_ids: string | null }>();
  return new Set(
    results
      .filter((row) => isWorkspaceRuleTargetGroup(row.id, parseCollectionIds(row.collection_ids)))
      .map((row) => row.id)
  );
}

export function normalizeRuleTargetGroupId(value: unknown, workspaceId = DEFAULT_WORKSPACE_ID): string {
  if (typeof value !== 'string') return workspaceEntityId(workspaceId, DEFAULT_RULE_TARGET_GROUP_ID);
  const id = value.trim();
  return id || workspaceEntityId(workspaceId, DEFAULT_RULE_TARGET_GROUP_ID);
}

function isWorkspaceRuleTargetGroup(id: string, collectionIds?: readonly string[] | null): boolean {
  const baseId = id.slice(id.lastIndexOf(':') + 1);
  return isRuleTargetGroup({ id: baseId, collectionIds });
}

function parseCollectionIds(value: string | null | undefined): string[] {
  if (!value) return [];
  return jsonParse<string[]>(value) ?? [];
}
