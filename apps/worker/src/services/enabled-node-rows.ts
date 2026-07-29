import { workspaceSqlLiteral } from './workspaces';

const ENABLED_NODE_ROWS_BASE = `
SELECT n.*
FROM nodes n
INNER JOIN sources s ON s.id = n.source_id
WHERE n.enabled = 1
  AND s.enabled = 1`;

export function enabledNodeRowsQuery(extraCondition?: string, workspaceId?: string): string {
  const workspaceCondition = workspaceId
    ? `n.workspace_id = ${workspaceSqlLiteral(workspaceId)} AND s.workspace_id = ${workspaceSqlLiteral(workspaceId)}`
    : undefined;
  const condition = extraCondition?.trim();
  const conditions = [workspaceCondition, condition].filter(Boolean);
  return conditions.length > 0
    ? `${ENABLED_NODE_ROWS_BASE}\n  AND ${conditions.join('\n  AND ')}`
    : ENABLED_NODE_ROWS_BASE;
}
