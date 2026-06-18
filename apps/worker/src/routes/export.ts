import { Hono } from 'hono'
import { newId, now, mapExportConfig } from '../db/helpers'
import { generateMihomo } from '../generators/mihomo'
import { generateSingbox } from '../generators/singbox'
import { generateLoon } from '../generators/loon'
import type { Env } from '../types'
import type { ExportConfig, ProxyNode, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types'

export const exportRouter = new Hono<{ Bindings: Env }>()

function generateToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 24; i++) {
    token += chars[Math.floor(Math.random() * chars.length)]
  }
  return token
}

// GET /api/export/configs - list export configs
exportRouter.get('/configs', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM export_configs ORDER BY created_at DESC').all()
  return c.json({ success: true, data: (rows.results ?? []).map(mapExportConfig) })
})

// POST /api/export/configs - create export config
exportRouter.post('/configs', async (c) => {
  const body = await c.req.json<Partial<ExportConfig>>()
  const id = newId()
  const token = generateToken()
  const ts = now()

  await c.env.DB.prepare(
    `INSERT INTO export_configs (id, name, format, token, enabled, include_collection_ids, include_group_ids, include_rule_ids, include_remote_set_ids, extra_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    body.name ?? 'Default Export',
    body.format ?? 'mihomo',
    token,
    JSON.stringify(body.includeCollectionIds ?? []),
    JSON.stringify(body.includeGroupIds ?? []),
    JSON.stringify(body.includeRuleIds ?? []),
    JSON.stringify(body.includeRemoteSetIds ?? []),
    body.extraConfig ? JSON.stringify(body.extraConfig) : null,
    ts, ts
  ).run()

  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) }, 201)
})

// GET /api/export/configs/:id
exportRouter.get('/configs/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(c.req.param('id')).first()
  if (!row) return c.json({ success: false, error: 'Not found' }, 404)
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) })
})

// PUT /api/export/configs/:id
exportRouter.put('/configs/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<Partial<ExportConfig>>()
  const ts = now()

  const existing = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name) }
  if (body.format !== undefined) { fields.push('format = ?'); values.push(body.format) }
  if (body.enabled !== undefined) { fields.push('enabled = ?'); values.push(body.enabled ? 1 : 0) }
  if (body.includeCollectionIds !== undefined) { fields.push('include_collection_ids = ?'); values.push(JSON.stringify(body.includeCollectionIds)) }
  if (body.includeGroupIds !== undefined) { fields.push('include_group_ids = ?'); values.push(JSON.stringify(body.includeGroupIds)) }
  if (body.includeRuleIds !== undefined) { fields.push('include_rule_ids = ?'); values.push(JSON.stringify(body.includeRuleIds)) }
  if (body.includeRemoteSetIds !== undefined) { fields.push('include_remote_set_ids = ?'); values.push(JSON.stringify(body.includeRemoteSetIds)) }
  if (body.extraConfig !== undefined) { fields.push('extra_config = ?'); values.push(JSON.stringify(body.extraConfig)) }

  // Reset token if requested
  let newToken: string | null = null
  if (body.token === 'reset') { newToken = generateToken(); fields.push('token = ?'); values.push(newToken) }

  if (fields.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400)
  fields.push('updated_at = ?'); values.push(ts); values.push(id)

  await c.env.DB.prepare(`UPDATE export_configs SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) })
})

// DELETE /api/export/configs/:id
exportRouter.delete('/configs/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM export_configs WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)
  await c.env.DB.prepare('DELETE FROM export_configs WHERE id = ?').bind(id).run()
  return c.json({ success: true, data: null })
})

// Shared helper: build export data from DB
async function buildExportData(db: D1Database) {
  const nodes = (await db.prepare('SELECT * FROM nodes WHERE enabled = 1').all()).results ?? []
  const groups = (await db.prepare('SELECT * FROM groups WHERE enabled = 1 ORDER BY sort_order ASC').all()).results ?? []
  const rules = (await db.prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY sort_order ASC').all()).results ?? []
  const remoteSets = (await db.prepare('SELECT * FROM remote_rule_sets WHERE enabled = 1').all()).results ?? []
  return { nodes, groups, rules, remoteSets }
}

// GET /api/export/preview/:format
exportRouter.get('/preview/:format', async (c) => {
  const format = c.req.param('format')
  const { nodes, groups, rules, remoteSets } = await buildExportData(c.env.DB)
  let content: string
  let contentType: string

  if (format === 'mihomo' || format === 'clash') {
    content = generateMihomo(nodes as Record<string, unknown>[], groups as Record<string, unknown>[], rules as Record<string, unknown>[], remoteSets as Record<string, unknown>[])
    contentType = 'text/yaml; charset=utf-8'
  } else if (format === 'singbox') {
    content = generateSingbox(nodes as Record<string, unknown>[], groups as Record<string, unknown>[], rules as Record<string, unknown>[], remoteSets as Record<string, unknown>[])
    contentType = 'application/json; charset=utf-8'
  } else if (format === 'loon') {
    content = generateLoon(nodes as Record<string, unknown>[], groups as Record<string, unknown>[], rules as Record<string, unknown>[], remoteSets as Record<string, unknown>[])
    contentType = 'text/plain; charset=utf-8'
  } else {
    return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  }

  return c.json({ success: true, data: { content, contentType, format } })
})

// GET /api/export/download/:format
exportRouter.get('/download/:format', async (c) => {
  const format = c.req.param('format')
  const { nodes, groups, rules, remoteSets } = await buildExportData(c.env.DB)
  let content: string
  let contentType: string
  let filename: string

  if (format === 'mihomo' || format === 'clash') {
    content = generateMihomo(nodes as Record<string, unknown>[], groups as Record<string, unknown>[], rules as Record<string, unknown>[], remoteSets as Record<string, unknown>[])
    contentType = 'text/yaml; charset=utf-8'
    filename = 'mihomo.yaml'
  } else if (format === 'singbox') {
    content = generateSingbox(nodes as Record<string, unknown>[], groups as Record<string, unknown>[], rules as Record<string, unknown>[], remoteSets as Record<string, unknown>[])
    contentType = 'application/json; charset=utf-8'
    filename = 'singbox.json'
  } else if (format === 'loon') {
    content = generateLoon(nodes as Record<string, unknown>[], groups as Record<string, unknown>[], rules as Record<string, unknown>[], remoteSets as Record<string, unknown>[])
    contentType = 'text/plain; charset=utf-8'
    filename = 'loon.conf'
  } else {
    return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  }

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
