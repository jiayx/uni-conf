export async function isEnabledTargetGroup(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM groups WHERE id = ? AND enabled = 1')
    .bind(id)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function listEnabledTargetGroupIds(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT id FROM groups WHERE enabled = 1')
    .all<{ id: string }>();
  return new Set(results.map((row) => row.id));
}
