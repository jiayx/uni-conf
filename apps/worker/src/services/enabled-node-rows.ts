const ENABLED_NODE_ROWS_BASE = `
SELECT n.*
FROM nodes n
INNER JOIN sources s ON s.id = n.source_id
WHERE n.enabled = 1
  AND s.enabled = 1`;

export function enabledNodeRowsQuery(extraCondition?: string): string {
  const condition = extraCondition?.trim();
  return condition ? `${ENABLED_NODE_ROWS_BASE}\n  AND ${condition}` : ENABLED_NODE_ROWS_BASE;
}
