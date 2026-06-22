import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonStringify, mapRule, newId, now } from '../db/helpers';
import type { ProxyRule } from '@uni-conf/types';
import { getRuleCompatibility } from '@uni-conf/shared';
import { isEnabledTargetGroup, listEnabledTargetGroupIds } from '../services/group-targets';

const app = new Hono<{ Bindings: Env }>();

// ─── List rules ───────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM rules ORDER BY sort_order ASC, created_at ASC'
  ).all<Record<string, unknown>>();

  return c.json({ success: true, data: results.map(mapRule) });
});

// ─── Reorder rules ────────────────────────────────────────────────────────────

app.post('/reorder', async (c) => {
  const body = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(body.ids)) {
    return c.json({ success: false, error: 'ids array is required' }, 400);
  }

  const ts = now();
  const stmts = body.ids.map((id, index) =>
    c.env.DB.prepare(
      'UPDATE rules SET sort_order = ?, updated_at = ? WHERE id = ?'
    ).bind(index, ts, id)
  );

  await c.env.DB.batch(stmts);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM rules ORDER BY sort_order ASC'
  ).all<Record<string, unknown>>();

  return c.json({ success: true, data: results.map(mapRule) });
});

// ─── Batch create rules ───────────────────────────────────────────────────────

app.post('/batch', async (c) => {
  const body = await c.req.json<{
    rules: Array<Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>>;
  }>();

  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    return c.json({ success: false, error: 'rules array is required and must not be empty' }, 400);
  }

  const ts = now();
  const created: ProxyRule[] = [];

  // Get current max sort_order
  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM rules'
  ).first<{ max_order: number | null }>();
  let nextOrder = (maxRow?.max_order ?? -1) + 1;
  const enabledTargetGroupIds = await listEnabledTargetGroupIds(c.env.DB);

  for (const rule of body.rules) {
    if (!rule.type || !hasRequiredPayload(rule) || !rule.targetGroupId) continue;
    if (!enabledTargetGroupIds.has(rule.targetGroupId)) {
      return c.json({ success: false, error: `target group is disabled or missing: ${rule.targetGroupId}` }, 400);
    }

    const id = newId();
    await c.env.DB.prepare(
      `INSERT INTO rules (id, name, type, payload, no_resolve, target_group_id, enabled, sort_order, notes, compatibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        rule.name ?? null,
        rule.type,
        rule.payload ?? '',
        rule.noResolve ? 1 : 0,
        rule.targetGroupId,
        rule.enabled !== false ? 1 : 0,
        rule.order ?? nextOrder,
        rule.notes ?? null,
        jsonStringify(getRuleCompatibility(rule.type)),
        ts,
        ts
      )
      .run();

    const row = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();

    if (row) created.push(mapRule(row));
    nextOrder++;
  }

  return c.json({ success: true, data: created }, 201);
});

// ─── Create rule ──────────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json<Partial<ProxyRule>>();
  if (!body.type || !hasRequiredPayload(body) || !body.targetGroupId) {
    return c.json(
      { success: false, error: 'type, payload, and targetGroupId are required' },
      400
    );
  }
  if (!(await isEnabledTargetGroup(c.env.DB, body.targetGroupId))) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400);
  }

  const id = newId();
  const ts = now();

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM rules'
  ).first<{ max_order: number | null }>();
  const sortOrder = body.order ?? (maxRow?.max_order ?? -1) + 1;

  await c.env.DB.prepare(
    `INSERT INTO rules (id, name, type, payload, no_resolve, target_group_id, enabled, sort_order, notes, compatibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.name ?? null,
      body.type,
      body.payload ?? '',
      body.noResolve ? 1 : 0,
      body.targetGroupId,
      body.enabled !== false ? 1 : 0,
      sortOrder,
      body.notes ?? null,
      jsonStringify(getRuleCompatibility(body.type)),
      ts,
      ts
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapRule(row!) }, 201);
});

// ─── Get rule ─────────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Rule not found' }, 404);
  return c.json({ success: true, data: mapRule(row) });
});

// ─── Update rule ──────────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Rule not found' }, 404);

  const body = await c.req.json<Partial<ProxyRule>>();
  const ts = now();
  if (body.targetGroupId !== undefined && !(await isEnabledTargetGroup(c.env.DB, body.targetGroupId))) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE rules SET
      name = ?, type = ?, payload = ?, no_resolve = ?,
      target_group_id = ?, enabled = ?, sort_order = ?,
      notes = ?, compatibility = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.name !== undefined ? body.name : existing.name,
      body.type ?? existing.type,
      body.payload ?? existing.payload,
      body.noResolve !== undefined ? (body.noResolve ? 1 : 0) : existing.no_resolve,
      body.targetGroupId ?? existing.target_group_id,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      body.order !== undefined ? body.order : existing.sort_order,
      body.notes !== undefined ? body.notes : existing.notes,
      jsonStringify(getRuleCompatibility((body.type ?? existing.type) as ProxyRule['type'])),
      ts,
      id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapRule(updated!) });
});

// ─── Delete rule ──────────────────────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM rules WHERE id = ?').bind(id).first();

  if (!row) return c.json({ success: false, error: 'Rule not found' }, 404);
  await c.env.DB.prepare('DELETE FROM rules WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { id } });
});

export default app;

function hasRequiredPayload(rule: Pick<Partial<ProxyRule>, 'type' | 'payload'>): boolean {
  return rule.type === 'MATCH' || Boolean(rule.payload);
}
