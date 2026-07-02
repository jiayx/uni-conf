import { Hono, type Context } from 'hono'
import { mapExportConfig, newId, now } from '../db/helpers'
import { buildExportData, getExportConfigById } from '../export-data'
import { renderExportData } from '../generators/export-renderer'
import { getAppSettings } from '../services/app-settings'
import { ensureDefaultExportConfig, generateExportToken } from '../services/default-export-config'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import { findBlockingExportWarning, resolveExportWarnings, validateRemoteRuleSetReachability } from '../services/export-validation'
import type { Env } from '../types'
import type { ExportConfig, ExportFormat } from '@uni-conf/types'
import { EXPORT_SUBSCRIPTION_FORMATS, getExportSubscriptionFilename } from '@uni-conf/shared'

export const exportRouter = new Hono<{ Bindings: Env }>()

// GET /api/export/configs - list export configs
exportRouter.get('/configs', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now())
  const rows = await c.env.DB.prepare('SELECT * FROM export_configs ORDER BY created_at DESC').all()
  return c.json({ success: true, data: (rows.results ?? []).map(mapExportConfig) })
})

// POST /api/export/configs - create export config
exportRouter.post('/configs', async (c) => {
  const body = await c.req.json<Partial<ExportConfig>>()
  if (body.format !== undefined && !isValidExportFormat(body.format)) {
    return c.json({ success: false, error: 'invalid export format' }, 400)
  }
  const selection = validateExportConfigSelection(body)
  if (!selection.valid) {
    return c.json({ success: false, error: selection.error }, 400)
  }
  const id = newId()
  const token = generateExportToken()
  const ts = now()

  await c.env.DB.prepare(
    `INSERT INTO export_configs (id, name, format, token, enabled, include_collection_ids, include_group_ids, include_rule_ids, include_remote_set_ids, extra_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    resolveExportConfigName(body.name, body.format),
    body.format ?? 'mihomo',
    token,
    JSON.stringify(selection.includeCollectionIds),
    JSON.stringify(selection.includeGroupIds),
    JSON.stringify(selection.includeRuleIds),
    JSON.stringify(selection.includeRemoteSetIds),
    body.extraConfig ? JSON.stringify(body.extraConfig) : null,
    ts, ts
  ).run()

  await ensureZeroSetupDefaults(c.env.DB, ts)

  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) }, 201)
})

export function resolveExportConfigName(name: unknown, format: ExportConfig['format'] | undefined): string {
  if (typeof name === 'string' && name.trim()) return name.trim()
  const labels: Partial<Record<ExportConfig['format'], string>> = {
    mihomo: 'Mihomo',
    clash: 'Clash / OpenClash',
    singbox: 'sing-box',
    loon: 'Loon',
    surge: 'Surge',
    shadowrocket: 'Shadowrocket',
    quantumultx: 'Quantumult X',
    stash: 'Stash',
    egern: 'Egern',
    nodes_base64: '节点订阅 Base64',
    nodes_raw: '节点订阅明文',
  }
  return `默认 ${labels[format ?? 'mihomo'] ?? 'Mihomo'} 配置`
}

export function resolveExportConfigUpdateName(
  name: unknown,
  nextFormat: ExportConfig['format'] | undefined,
  existingFormat: ExportConfig['format']
): string | undefined {
  if (name === undefined) return undefined
  return resolveExportConfigName(name, nextFormat ?? existingFormat)
}

// GET /api/export/configs/:id
exportRouter.get('/configs/:id', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now())
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
  if (body.format !== undefined && !isValidExportFormat(body.format)) {
    return c.json({ success: false, error: 'invalid export format' }, 400)
  }
  const selection = validateExportConfigSelection(body)
  if (!selection.valid) {
    return c.json({ success: false, error: selection.error }, 400)
  }

  const fields: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined) {
    fields.push('name = ?')
    values.push(resolveExportConfigUpdateName(
      body.name,
      body.format,
      existing.format as ExportConfig['format']
    ))
  }
  if (body.format !== undefined) { fields.push('format = ?'); values.push(body.format) }
  if (body.enabled !== undefined) { fields.push('enabled = ?'); values.push(body.enabled ? 1 : 0) }
  if (body.includeCollectionIds !== undefined) { fields.push('include_collection_ids = ?'); values.push(JSON.stringify(selection.includeCollectionIds)) }
  if (body.includeGroupIds !== undefined) { fields.push('include_group_ids = ?'); values.push(JSON.stringify(selection.includeGroupIds)) }
  if (body.includeRuleIds !== undefined) { fields.push('include_rule_ids = ?'); values.push(JSON.stringify(selection.includeRuleIds)) }
  if (body.includeRemoteSetIds !== undefined) { fields.push('include_remote_set_ids = ?'); values.push(JSON.stringify(selection.includeRemoteSetIds)) }
  if (body.extraConfig !== undefined) { fields.push('extra_config = ?'); values.push(JSON.stringify(body.extraConfig)) }

  // Reset token if requested
  if (body.token === 'reset') { fields.push('token = ?'); values.push(generateExportToken()) }

  if (fields.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400)
  fields.push('updated_at = ?'); values.push(ts); values.push(id)

  await c.env.DB.prepare(`UPDATE export_configs SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  await ensureZeroSetupDefaults(c.env.DB, ts)
  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) })
})

// DELETE /api/export/configs/:id
exportRouter.delete('/configs/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM export_configs WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)
  await c.env.DB.prepare('DELETE FROM export_configs WHERE id = ?').bind(id).run()
  await ensureZeroSetupDefaults(c.env.DB, now())
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
  await ensureZeroSetupDefaults(c.env.DB, now())
  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) })
})

// GET /api/export/preview/:format
exportRouter.get('/preview/:format', async (c) => {
  const format = c.req.param('format')
  if (!isValidExportFormat(format)) {
    return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  }
  const config = await resolveConfig(c)
  if (config instanceof Response) return config
  const settings = await getAppSettings(c.env.DB)
  const exportData = await buildExportData(c.env.DB, config, format as ExportFormat)
  const rendered = renderExportData(exportData, format, { dnsMode: settings.dnsMode })
  if (!rendered) {
    return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  }
  const warnings = resolveExportWarnings(exportData, format as ExportFormat, {
    showCompatibilityWarnings: settings.showCompatibilityWarnings,
    dnsMode: settings.dnsMode,
  })
  const remoteRuleSetWarnings = await validateRemoteRuleSetReachability(exportData, format as ExportFormat)

  return c.json({ success: true, data: { ...rendered, format, warnings: [...warnings, ...remoteRuleSetWarnings] } })
})

// GET /api/export/download/:format
exportRouter.get('/download/:format', async (c) => {
  const format = c.req.param('format')
  if (!isValidExportFormat(format)) {
    return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  }
  const config = await resolveConfig(c)
  if (config instanceof Response) return config
  const settings = await getAppSettings(c.env.DB)
  const exportData = await buildExportData(c.env.DB, config, format)
  const blockingWarning = findBlockingExportWarning(exportData, format)
  if (blockingWarning) {
    return c.json({ success: false, error: blockingWarning.message, warnings: [blockingWarning] }, 409)
  }
  const rendered = renderExportData(exportData, format, { dnsMode: settings.dnsMode })
  if (!rendered) {
    return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  }
  const filename = getExportSubscriptionFilename(format)

  return new Response(rendered.content, {
    headers: {
      'Content-Type': rendered.contentType,
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

const EXPORT_FORMATS: ReadonlySet<ExportFormat> = new Set(EXPORT_SUBSCRIPTION_FORMATS as ExportFormat[])

export function isValidExportFormat(value: unknown): value is ExportFormat {
  return EXPORT_FORMATS.has(value as ExportFormat)
}

type ExportSelectionValidation =
  | {
      valid: true
      includeCollectionIds: string[]
      includeGroupIds: string[]
      includeRuleIds: string[]
      includeRemoteSetIds: string[]
    }
  | { valid: false; error: string }

export function validateExportConfigSelection(body: Partial<ExportConfig>): ExportSelectionValidation {
  const includeCollectionIds = normalizeIdList(body.includeCollectionIds, 'includeCollectionIds')
  if (!includeCollectionIds.valid) return includeCollectionIds
  const includeGroupIds = normalizeIdList(body.includeGroupIds, 'includeGroupIds')
  if (!includeGroupIds.valid) return includeGroupIds
  const includeRuleIds = normalizeIdList(body.includeRuleIds, 'includeRuleIds')
  if (!includeRuleIds.valid) return includeRuleIds
  const includeRemoteSetIds = normalizeIdList(body.includeRemoteSetIds, 'includeRemoteSetIds')
  if (!includeRemoteSetIds.valid) return includeRemoteSetIds

  return {
    valid: true,
    includeCollectionIds: includeCollectionIds.value,
    includeGroupIds: includeGroupIds.value,
    includeRuleIds: includeRuleIds.value,
    includeRemoteSetIds: includeRemoteSetIds.value,
  }
}

type IdListValidation = { valid: true; value: string[] } | { valid: false; error: string }

function normalizeIdList(value: unknown, field: string): IdListValidation {
  if (value === undefined) return { valid: true, value: [] }
  if (!Array.isArray(value)) return { valid: false, error: `${field} must be an array` }

  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      return { valid: false, error: `${field} must only contain non-empty strings` }
    }
    ids.push(item.trim())
  }
  return { valid: true, value: [...new Set(ids)] }
}
