import { Hono } from 'hono'
import type { Env } from '../types'
import { mapRemoteRuleSet, newId, now } from '../db/helpers'
import type { RemoteRuleSet } from '@uni-conf/types'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM remote_rule_sets ORDER BY created_at DESC'
  ).all<Record<string, unknown>>()

  return c.json({ success: true, data: results.map(mapRemoteRuleSet) })
})

app.post('/', async (c) => {
  const body = await c.req.json<Partial<RemoteRuleSet>>()
  if (!body.name || !body.url || !body.format || !body.targetGroupId) {
    return c.json(
      { success: false, error: 'name, url, format, and targetGroupId are required' },
      400
    )
  }

  const id = newId()
  const ts = now()
  await c.env.DB.prepare(
    `INSERT INTO remote_rule_sets
      (id, name, url, format, target_group_id, update_interval, enabled, last_updated, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.name,
      body.url,
      body.format,
      body.targetGroupId,
      body.updateInterval ?? 24,
      body.enabled !== false ? 1 : 0,
      body.lastUpdated ?? null,
      body.notes ?? null,
      ts,
      ts
    )
    .run()

  const row = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  return c.json({ success: true, data: mapRemoteRuleSet(row!) }, 201)
})

app.post('/batch', async (c) => {
  const body = await c.req.json<{ sets?: Array<Partial<RemoteRuleSet>> }>()
  const sets = body.sets ?? []
  if (!Array.isArray(sets) || sets.length === 0) {
    return c.json({ success: false, error: 'sets are required' }, 400)
  }

  const ts = now()
  const createdIds: string[] = []

  for (const set of sets) {
    if (!set.name || !set.url || !set.format || !set.targetGroupId) continue
    const id = newId()
    createdIds.push(id)
    await c.env.DB.prepare(
      `INSERT INTO remote_rule_sets
        (id, name, url, format, target_group_id, update_interval, enabled, last_updated, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        set.name,
        set.url,
        set.format,
        set.targetGroupId,
        set.updateInterval ?? 24,
        set.enabled !== false ? 1 : 0,
        set.lastUpdated ?? null,
        set.notes ?? null,
        ts,
        ts
      )
      .run()
  }

  if (createdIds.length === 0) {
    return c.json({ success: false, error: 'No valid remote rule sets to create' }, 400)
  }

  const placeholders = createdIds.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM remote_rule_sets WHERE id IN (${placeholders}) ORDER BY created_at DESC`
  )
    .bind(...createdIds)
    .all<Record<string, unknown>>()

  return c.json({ success: true, data: results.map(mapRemoteRuleSet) }, 201)
})

app.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>()

  if (!row) return c.json({ success: false, error: 'Remote rule set not found' }, 404)
  return c.json({ success: true, data: mapRemoteRuleSet(row) })
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  if (!existing) return c.json({ success: false, error: 'Remote rule set not found' }, 404)

  const body = await c.req.json<Partial<RemoteRuleSet>>()
  const ts = now()
  await c.env.DB.prepare(
    `UPDATE remote_rule_sets SET
      name = ?, url = ?, format = ?, target_group_id = ?, update_interval = ?,
      enabled = ?, last_updated = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.name ?? existing.name,
      body.url ?? existing.url,
      body.format ?? existing.format,
      body.targetGroupId ?? existing.target_group_id,
      body.updateInterval ?? existing.update_interval,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      body.lastUpdated !== undefined ? body.lastUpdated : existing.last_updated,
      body.notes !== undefined ? body.notes : existing.notes,
      ts,
      id
    )
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  return c.json({ success: true, data: mapRemoteRuleSet(updated!) })
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id FROM remote_rule_sets WHERE id = ?')
    .bind(id)
    .first()
  if (!row) return c.json({ success: false, error: 'Remote rule set not found' }, 404)

  await c.env.DB.prepare('DELETE FROM remote_rule_sets WHERE id = ?').bind(id).run()
  return c.json({ success: true, data: { id } })
})

export default app
