import { Hono, type Context } from 'hono'
import { mapExportConfig, newId, now } from '../db/helpers'
import { buildExportData, getExportConfigById } from '../export-data'
import { generateMihomoYaml } from '../generators/mihomo'
import { generateSingboxJson } from '../generators/singbox'
import { generateLoon } from '../generators/loon'
import { generateNodeSubscriptionBase64, generateNodeSubscriptionRaw } from '../generators/node-subscription'
import {
  generateEgern,
  generateQuantumultX,
  generateShadowrocket,
  generateStashYaml,
  generateSurge,
} from '../generators/client-configs'
import { getAppSettings } from '../services/app-settings'
import { ensureDefaultExportConfig, generateExportToken } from '../services/default-export-config'
import { resolveExportWarnings } from '../services/export-validation'
import type { Env } from '../types'
import type { ExportConfig, ExportFormat } from '@uni-conf/types'

export const exportRouter = new Hono<{ Bindings: Env }>()

// GET /api/export/configs - list export configs
exportRouter.get('/configs', async (c) => {
  await ensureDefaultExportConfig(c.env.DB, now())
  const rows = await c.env.DB.prepare('SELECT * FROM export_configs ORDER BY created_at DESC').all()
  return c.json({ success: true, data: (rows.results ?? []).map(mapExportConfig) })
})

// POST /api/export/configs - create export config
exportRouter.post('/configs', async (c) => {
  const body = await c.req.json<Partial<ExportConfig>>()
  const id = newId()
  const token = generateExportToken()
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
  if (body.token === 'reset') { fields.push('token = ?'); values.push(generateExportToken()) }

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

// POST /api/export/configs/:id/reset-token
exportRouter.post('/configs/:id/reset-token', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM export_configs WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  await c.env.DB.prepare('UPDATE export_configs SET token = ?, updated_at = ? WHERE id = ?')
    .bind(generateExportToken(), now(), id)
    .run()
  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) })
})

// GET /api/export/preview/:format
exportRouter.get('/preview/:format', async (c) => {
  const format = c.req.param('format')
  const config = await resolveConfig(c)
  if (config instanceof Response) return config
  const settings = await getAppSettings(c.env.DB)
  const exportData = await buildExportData(c.env.DB, config)
  const { nodes, groups, rules, remoteSets, nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames } = exportData
  const warnings = resolveExportWarnings(exportData, format as ExportFormat, {
    showCompatibilityWarnings: settings.showCompatibilityWarnings,
    dnsMode: settings.dnsMode,
  })
  let content: string
  let contentType: string

  if (format === 'mihomo' || format === 'clash') {
    content = generateMihomoYaml(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'text/yaml; charset=utf-8'
  } else if (format === 'singbox') {
    content = generateSingboxJson(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'application/json; charset=utf-8'
  } else if (format === 'loon') {
    content = generateLoon(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'surge') {
    content = generateSurge(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'shadowrocket') {
    content = generateShadowrocket(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'quantumultx') {
    content = generateQuantumultX(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'stash') {
    content = generateStashYaml(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'text/yaml; charset=utf-8'
  } else if (format === 'egern') {
    content = generateEgern(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/yaml; charset=utf-8'
  } else if (format === 'nodes_base64') {
    content = generateNodeSubscriptionBase64(nodeRows)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'nodes_raw') {
    content = generateNodeSubscriptionRaw(nodeRows)
    contentType = 'text/plain; charset=utf-8'
  } else {
    return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  }

  return c.json({ success: true, data: { content, contentType, format, warnings } })
})

// GET /api/export/download/:format
exportRouter.get('/download/:format', async (c) => {
  const format = c.req.param('format')
  const config = await resolveConfig(c)
  if (config instanceof Response) return config
  const settings = await getAppSettings(c.env.DB)
  const { nodes, groups, rules, remoteSets, nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames } = await buildExportData(c.env.DB, config)
  let content: string
  let contentType: string
  let filename: string

  if (format === 'mihomo' || format === 'clash') {
    content = generateMihomoYaml(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'text/yaml; charset=utf-8'
    filename = 'mihomo.yaml'
  } else if (format === 'singbox') {
    content = generateSingboxJson(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'application/json; charset=utf-8'
    filename = 'singbox.json'
  } else if (format === 'loon') {
    content = generateLoon(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
    filename = 'loon.conf'
  } else if (format === 'surge') {
    content = generateSurge(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
    filename = 'surge.conf'
  } else if (format === 'shadowrocket') {
    content = generateShadowrocket(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
    filename = 'shadowrocket.conf'
  } else if (format === 'quantumultx') {
    content = generateQuantumultX(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
    filename = 'quantumultx.conf'
  } else if (format === 'stash') {
    content = generateStashYaml(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'text/yaml; charset=utf-8'
    filename = 'stash.yaml'
  } else if (format === 'egern') {
    content = generateEgern(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/yaml; charset=utf-8'
    filename = 'egern.yaml'
  } else if (format === 'nodes_base64') {
    content = generateNodeSubscriptionBase64(nodeRows)
    contentType = 'text/plain; charset=utf-8'
    filename = 'nodes.txt'
  } else if (format === 'nodes_raw') {
    content = generateNodeSubscriptionRaw(nodeRows)
    contentType = 'text/plain; charset=utf-8'
    filename = 'nodes-raw.txt'
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

async function resolveConfig(c: Context<{ Bindings: Env }>) {
  const configId = c.req.query('configId')
  if (!configId) return ensureDefaultExportConfig(c.env.DB, now())

  const config = await getExportConfigById(c.env.DB, configId)
  if (!config) return c.json({ success: false, error: 'Export config not found' }, 404)
  if (!config.enabled) return c.json({ success: false, error: 'Export config is disabled' }, 403)
  return config
}
