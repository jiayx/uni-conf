import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonStringify, mapGroup, newId, now } from '../db/helpers';
import type { ProxyGroup } from '@uni-conf/types';
import { syncRoutingPolicyGroups } from '../services/routing-policy-groups';

const app = new Hono<{ Bindings: Env }>();
const BUILTIN_ONLY_GROUP_TYPES = new Set(['direct', 'reject']);

// ─── List groups ordered by sort_order ────────────────────────────────────────

app.get('/', async (c) => {
  await syncRoutingPolicyGroups(c.env.DB, now());

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM groups ORDER BY sort_order ASC, created_at ASC'
  ).all<Record<string, unknown>>();

  return c.json({ success: true, data: results.map(mapGroup) });
});

// ─── Reorder groups ───────────────────────────────────────────────────────────

app.post('/reorder', async (c) => {
  const body = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(body.ids)) {
    return c.json({ success: false, error: 'ids array is required' }, 400);
  }

  const ts = now();
  const stmts = body.ids.map((id, index) =>
    c.env.DB.prepare('UPDATE groups SET sort_order = ?, updated_at = ? WHERE id = ?').bind(
      index,
      ts,
      id
    )
  );

  await c.env.DB.batch(stmts);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM groups ORDER BY sort_order ASC'
  ).all<Record<string, unknown>>();

  return c.json({ success: true, data: results.map(mapGroup) });
});

// ─── Create group (non-builtin only) ─────────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json<Partial<ProxyGroup>>();
  if (!body.name || !body.type) {
    return c.json({ success: false, error: 'name and type are required' }, 400);
  }
  if (BUILTIN_ONLY_GROUP_TYPES.has(body.type)) {
    return c.json({ success: false, error: 'DIRECT and REJECT are built-in foundation outlets' }, 400);
  }

  const id = newId();
  const ts = now();

  // Determine sort_order: max + 1
  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM groups'
  ).first<{ max_order: number | null }>();
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  await c.env.DB.prepare(
    `INSERT INTO groups (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      id,
      body.name,
      body.type,
      jsonStringify(body.collectionIds ?? []),
      jsonStringify(body.groupIds ?? []),
      jsonStringify(body.builtins ?? []),
      body.testUrl ?? null,
      body.interval ?? 300,
      body.tolerance ?? 150,
      body.lazy !== false ? 1 : 0,
      body.enabled !== false ? 1 : 0,
      sortOrder,
      ts,
      ts
    )
    .run();

  await syncRoutingPolicyGroups(c.env.DB, ts);

  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapGroup(row!) }, 201);
});

// ─── Get group ────────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Group not found' }, 404);
  return c.json({ success: true, data: mapGroup(row) });
});

// ─── Update group ─────────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Group not found' }, 404);

  const body = await c.req.json<Partial<ProxyGroup>>();
  const ts = now();
  if (!existing.is_builtin && body.type && BUILTIN_ONLY_GROUP_TYPES.has(body.type)) {
    return c.json({ success: false, error: 'DIRECT and REJECT are built-in foundation outlets' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE groups SET
      name = ?, type = ?, collection_ids = ?, group_ids = ?, builtins = ?,
      test_url = ?, interval = ?, tolerance = ?, lazy = ?,
      enabled = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.name ?? existing.name,
      body.type ?? existing.type,
      body.collectionIds !== undefined
        ? jsonStringify(body.collectionIds)
        : existing.collection_ids,
      body.groupIds !== undefined ? jsonStringify(body.groupIds) : existing.group_ids,
      body.builtins !== undefined ? jsonStringify(body.builtins) : existing.builtins,
      body.testUrl !== undefined ? body.testUrl : existing.test_url,
      body.interval !== undefined ? body.interval : existing.interval,
      body.tolerance !== undefined ? body.tolerance : existing.tolerance,
      body.lazy !== undefined ? (body.lazy ? 1 : 0) : existing.lazy,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      ts,
      id
    )
    .run();

  await syncRoutingPolicyGroups(c.env.DB, ts);

  const updated = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapGroup(updated!) });
});

// ─── Delete group (block builtin) ─────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id, is_builtin FROM groups WHERE id = ?')
    .bind(id)
    .first<{ id: string; is_builtin: number }>();

  if (!row) return c.json({ success: false, error: 'Group not found' }, 404);
  if (row.is_builtin) {
    return c.json({ success: false, error: 'Cannot delete built-in group' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
  await syncRoutingPolicyGroups(c.env.DB, now());
  return c.json({ success: true, data: { id } });
});

export default app;
