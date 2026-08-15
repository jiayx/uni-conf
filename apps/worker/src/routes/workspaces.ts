import { Hono } from 'hono'
import type { Workspace } from '@uni-conf/types'
import type { Env } from '../types'
import { mapWorkspace, now } from '../db/helpers'
import { ensureWorkspaceInitialized, workspaceDefaultsKey } from '../services/zero-setup'
import {
  DEFAULT_WORKSPACE_ID,
  normalizeWorkspaceId,
} from '../services/workspaces'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM workspaces ORDER BY is_default DESC, created_at ASC')
    .all<Record<string, unknown>>()
  return c.json({ success: true, data: results.map(mapWorkspace) })
})

app.post('/', async (c) => {
  const body: { name?: unknown } = await c.req.json<{ name?: unknown }>().catch(() => ({}))
  const name = normalizeWorkspaceName(body.name)
  if (!name) return c.json({ success: false, error: '配置空间名称不能为空' }, 400)

  const id = crypto.randomUUID()
  const ts = now()
  await c.env.DB
    .prepare('INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
    .bind(id, name, ts, ts)
    .run()
  await ensureWorkspaceInitialized(c.env.DB, c.env.KV, ts, id)

  const row = await c.env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first<Record<string, unknown>>()
  return c.json({ success: true, data: mapWorkspace(row!) }, 201)
})

app.put('/:id', async (c) => {
  const id = normalizeWorkspaceId(c.req.param('id'))
  if (!id) return c.json({ success: false, error: '配置空间不存在' }, 404)
  const body: Partial<Workspace> = await c.req.json<Partial<Workspace>>().catch(() => ({}))
  const name = normalizeWorkspaceName(body.name)
  if (!name) return c.json({ success: false, error: '配置空间名称不能为空' }, 400)

  const result = await c.env.DB
    .prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, now(), id)
    .run()
  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ success: false, error: '配置空间不存在' }, 404)
  }
  const row = await c.env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first<Record<string, unknown>>()
  return c.json({ success: true, data: mapWorkspace(row!) })
})

app.delete('/:id', async (c) => {
  const id = normalizeWorkspaceId(c.req.param('id'))
  if (!id) return c.json({ success: false, error: '配置空间不存在' }, 404)
  if (id === DEFAULT_WORKSPACE_ID) {
    return c.json({ success: false, error: '默认配置空间不能删除' }, 403)
  }
  const result = await c.env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(id).run()
  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ success: false, error: '配置空间不存在' }, 404)
  }
  await c.env.KV.delete(workspaceDefaultsKey(id))
  return c.json({ success: true, data: null })
})

function normalizeWorkspaceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name && name.length <= 60 ? name : null
}

export default app
