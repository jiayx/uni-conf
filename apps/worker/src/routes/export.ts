import { Hono, type Context } from 'hono'
import { mapExportConfig, newId, now } from '../db/helpers'
import { buildExportData, getExportConfigById } from '../export-data'
import { renderExportData } from '../generators/export-renderer'
import { getAppSettings } from '../services/app-settings'
import {
  DEFAULT_EXPORT_CONFIG_ID,
  ensureDefaultExportConfig,
  generateExportToken,
} from '../services/default-export-config'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import { findBlockingExportWarning, resolveExportWarnings } from '../services/export-validation'
import { exportArtifactWarnings, validateRenderedExport } from '../services/export-artifact-validation'
import type { Env } from '../types'
import type { CompatibilityWarning, DnsMode, ExportConfig, ExportFormat, ExportResult } from '@uni-conf/types'
import { buildRuleSetConversionBaseUrl } from './subscription'
import { preflightRuleSetConversions } from '../services/rule-set-conversion'
import { resolveExportRuleSetConversionPolicy } from '../services/export-conversion-policy'
import { validateOptionalBooleanFields } from '../services/request-validation'
import {
  getExportCapabilityProfile,
  getExportClientCapabilities,
  getExportSubscriptionFilename,
  isExportSubscriptionFormat,
  serializeExportCapabilityProfile,
} from '@uni-conf/shared'

export const exportRouter = new Hono<{ Bindings: Env }>()

// GET /api/export/configs - list export configs
exportRouter.get('/configs', async (c) => {
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
  const format = body.format ?? 'mihomo'
  const dnsMode = resolveExportDnsMode(format, body.dnsMode)
  if (body.dnsMode !== undefined && dnsMode === undefined) {
    return c.json({ success: false, error: 'DNS mode is not supported by this export format' }, 400)
  }

  await c.env.DB.prepare(
    `INSERT INTO export_configs (id, name, format, dns_mode, token, enabled, include_collection_ids, include_group_ids, include_rule_ids, include_remote_set_ids, rule_set_conversion_policy, extra_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    resolveExportConfigName(body.name, body.format),
    format,
    dnsMode ?? null,
    token,
    body.enabled !== false ? 1 : 0,
    JSON.stringify(selection.includeCollectionIds),
    JSON.stringify(selection.includeGroupIds),
    JSON.stringify(selection.includeRuleIds),
    JSON.stringify(selection.includeRemoteSetIds),
    selection.ruleSetConversionPolicy ?? null,
    selection.extraConfig ? JSON.stringify(selection.extraConfig) : null,
    ts, ts
  ).run()

  await ensureZeroSetupDefaults(c.env.DB, ts)

  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) }, 201)
})

export function resolveExportConfigName(name: unknown, format: ExportConfig['format'] | undefined): string {
  if (typeof name === 'string' && name.trim()) return name.trim()
  const labels: Partial<Record<ExportConfig['format'], string>> = {
    mihomo: 'Mihomo / Clash / OpenClash',
    clash: 'Clash',
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
  if (
    id === DEFAULT_EXPORT_CONFIG_ID
    && Object.keys(body).some(field => field !== 'enabled' && field !== 'dnsMode')
  ) {
    return c.json({
      success: false,
      error: 'Default export config only allows enabled state and DNS mode updates',
    }, 403)
  }
  if (body.format !== undefined && !isValidExportFormat(body.format)) {
    return c.json({ success: false, error: 'invalid export format' }, 400)
  }
  const selection = validateExportConfigSelection(body)
  if (!selection.valid) {
    return c.json({ success: false, error: selection.error }, 400)
  }
  const existingConfig = mapExportConfig(existing as Record<string, unknown>)
  const nextFormat = body.format ?? existingConfig.format
  const requestedDnsMode = body.dnsMode ?? existingConfig.dnsMode
  let nextDnsMode = resolveExportDnsMode(nextFormat, requestedDnsMode)
  if (body.dnsMode !== undefined && nextDnsMode === undefined) {
    return c.json({ success: false, error: 'DNS mode is not supported by this export format' }, 400)
  }
  if (body.dnsMode === undefined && requestedDnsMode !== undefined && nextDnsMode === undefined) {
    nextDnsMode = resolveExportDnsMode(nextFormat)
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
  if (body.dnsMode !== undefined || body.format !== undefined) {
    fields.push('dns_mode = ?')
    values.push(nextDnsMode ?? null)
  }
  if (body.enabled !== undefined) { fields.push('enabled = ?'); values.push(body.enabled ? 1 : 0) }
  if (body.includeCollectionIds !== undefined) { fields.push('include_collection_ids = ?'); values.push(JSON.stringify(selection.includeCollectionIds)) }
  if (body.includeGroupIds !== undefined) { fields.push('include_group_ids = ?'); values.push(JSON.stringify(selection.includeGroupIds)) }
  if (body.includeRuleIds !== undefined) { fields.push('include_rule_ids = ?'); values.push(JSON.stringify(selection.includeRuleIds)) }
  if (body.includeRemoteSetIds !== undefined) { fields.push('include_remote_set_ids = ?'); values.push(JSON.stringify(selection.includeRemoteSetIds)) }
  if (body.ruleSetConversionPolicy !== undefined) {
    fields.push('rule_set_conversion_policy = ?')
    values.push(selection.ruleSetConversionPolicy ?? null)
  }
  if (body.extraConfig !== undefined) {
    fields.push('extra_config = ?')
    values.push(selection.extraConfig === null ? null : JSON.stringify(selection.extraConfig))
  }

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
  if (id === DEFAULT_EXPORT_CONFIG_ID) {
    return c.json({ success: false, error: 'Default export config is managed internally' }, 403)
  }
  const existing = await c.env.DB.prepare('SELECT id FROM export_configs WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)
  await c.env.DB.prepare('DELETE FROM export_configs WHERE id = ?').bind(id).run()
  await ensureZeroSetupDefaults(c.env.DB, now())
  return c.json({ success: true, data: null })
})

// POST /api/export/configs/:id/reset-token
exportRouter.post('/configs/:id/reset-token', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id, token FROM export_configs WHERE id = ?').bind(id).first<Record<string, unknown>>()
  if (!existing) return c.json({ success: false, error: 'Not found' }, 404)

  const ts = now()
  const nextToken = generateExportToken()
  await c.env.DB.prepare('UPDATE export_configs SET token = ?, updated_at = ? WHERE id = ?')
    .bind(nextToken, ts, id)
    .run()
  await syncDefaultExportTokenAfterReset(c.env.DB, String(existing.token ?? ''), nextToken, ts)
  await ensureZeroSetupDefaults(c.env.DB, ts)
  const row = await c.env.DB.prepare('SELECT * FROM export_configs WHERE id = ?').bind(id).first()
  return c.json({ success: true, data: mapExportConfig(row as Record<string, unknown>) })
})

async function syncDefaultExportTokenAfterReset(
  db: D1Database,
  previousToken: string,
  nextToken: string,
  ts: string
): Promise<void> {
  if (!previousToken) return
  await db.prepare(
    "UPDATE app_settings SET default_export_token = ?, updated_at = ? WHERE id = 'singleton' AND default_export_token = ?"
  )
    .bind(nextToken, ts, previousToken)
    .run()
}

async function inspectExport(
  c: Context<{ Bindings: Env }>,
  format: ExportFormat,
  config: ExportConfig,
): Promise<ExportResult | null> {
  const settings = await getAppSettings(c.env.DB)
  const exportData = await buildExportData(c.env.DB, config, format)
  const conversionPreflight = await preflightRuleSetConversions(exportData, format, {
    kv: c.env.KV,
    policy: resolveExportRuleSetConversionPolicy(config, settings.ruleSetConversionPolicy),
  })
  const rendered = renderExportData(exportData, format, {
    dnsMode: resolveExportDnsMode(format, config.dnsMode),
    ruleSetConversionBaseUrl: buildRuleSetConversionBaseUrl(c.req.url, config.token),
  })
  if (!rendered) return null
  const warnings = resolveExportWarnings(exportData, format, {
    showCompatibilityWarnings: settings.showCompatibilityWarnings,
  })
  const artifactValidation = validateRenderedExport(format, rendered.content)
  const artifactWarnings = exportArtifactWarnings(artifactValidation)
  const graphBlockingWarning = findBlockingExportWarning(exportData, format)
  const blockingWarnings = [
    graphBlockingWarning,
    ...conversionPreflight.blockingWarnings,
    ...artifactWarnings,
  ].filter((warning): warning is CompatibilityWarning => warning !== null)

  return {
    ...rendered,
    format,
    capabilityProfile: getExportCapabilityProfile(format),
    artifactValidation,
    readiness: { ready: blockingWarnings.length === 0, blockingWarnings },
    warnings: [...warnings, ...conversionPreflight.warnings, ...artifactWarnings],
  }
}

// GET /api/export/preview/:format
exportRouter.get('/preview/:format', async (c) => {
  const format = c.req.param('format')
  if (!isValidExportFormat(format)) {
    return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  }
  const config = await resolveConfig(c)
  if (config instanceof Response) return config
  const result = await inspectExport(c, format, config)
  if (!result) return c.json({ success: false, error: `Unsupported format: ${format}` }, 400)
  return c.json({ success: true, data: result })
})

// GET /api/export/download/:format
exportRouter.get('/download/:format', async (c) => {
  const format = c.req.param('format')
  if (!isValidExportFormat(format)) {
    c.header('X-UniConf-Error-Code', 'export_format_invalid')
    return c.json({ success: false, code: 'export_format_invalid', error: `Unsupported format: ${format}` }, 400)
  }
  const config = await resolveConfig(c)
  if (config instanceof Response) return config
  const settings = await getAppSettings(c.env.DB)
  const exportData = await buildExportData(c.env.DB, config, format)
  const blockingWarning = findBlockingExportWarning(exportData, format)
  if (blockingWarning) {
    c.header('X-UniConf-Error-Code', 'export_not_ready')
    return c.json({ success: false, code: 'export_not_ready', error: blockingWarning.message, warnings: [blockingWarning] }, 409)
  }
  const conversionPreflight = await preflightRuleSetConversions(exportData, format, {
    kv: c.env.KV,
    policy: resolveExportRuleSetConversionPolicy(config, settings.ruleSetConversionPolicy),
  })
  if (conversionPreflight.blockingWarning) {
    c.header('X-UniConf-Error-Code', 'conversion_incomplete')
    return c.json({
      success: false,
      code: 'conversion_incomplete',
      error: conversionPreflight.blockingWarning.message,
      warnings: conversionPreflight.warnings,
    }, 409)
  }
  const rendered = renderExportData(exportData, format, {
    dnsMode: resolveExportDnsMode(format, config.dnsMode),
    ruleSetConversionBaseUrl: buildRuleSetConversionBaseUrl(c.req.url, config.token),
  })
  if (!rendered) {
    c.header('X-UniConf-Error-Code', 'export_format_invalid')
    return c.json({ success: false, code: 'export_format_invalid', error: `Unsupported format: ${format}` }, 400)
  }
  const artifactValidation = validateRenderedExport(format, rendered.content)
  if (!artifactValidation.valid) {
    c.header('X-UniConf-Error-Code', 'artifact_invalid')
    return c.json({
      success: false,
      code: 'artifact_invalid',
      error: 'Generated export failed structural validation',
      artifactValidation,
    }, 500)
  }
  const filename = getExportSubscriptionFilename(format)

  return new Response(rendered.content, {
    headers: {
      'Content-Type': rendered.contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-UniConf-Capability-Profile': serializeExportCapabilityProfile(format),
    },
  })
})

async function resolveConfig(c: Context<{ Bindings: Env }>) {
  const configId = c.req.query('configId')
  if (!configId) {
    const config = await ensureDefaultExportConfig(c.env.DB, now())
    if (!config.enabled) return c.json({ success: false, error: 'Export config is disabled' }, 403)
    return config
  }

  const config = await getExportConfigById(c.env.DB, configId)
  if (!config) return c.json({ success: false, error: 'Export config not found' }, 404)
  if (!config.enabled) return c.json({ success: false, error: 'Export config is disabled' }, 403)
  return config
}

export function isValidExportFormat(value: unknown): value is ExportFormat {
  return isExportSubscriptionFormat(value)
}

export function resolveExportDnsMode(
  format: ExportFormat,
  requested?: DnsMode,
): DnsMode | undefined {
  const supported = getExportClientCapabilities(format).managedDnsModes as readonly DnsMode[]
  if (supported.length === 0) return undefined
  if (requested !== undefined) return supported.includes(requested) ? requested : undefined
  return supported.includes('smart') ? 'smart' : supported[0]
}

type ExportSelectionValidation =
  | {
      valid: true
      includeCollectionIds: string[]
      includeGroupIds: string[]
      includeRuleIds: string[]
      includeRemoteSetIds: string[]
      ruleSetConversionPolicy?: ExportConfig['ruleSetConversionPolicy']
      extraConfig?: Record<string, unknown> | null
    }
  | { valid: false; error: string }

export function validateExportConfigSelection(body: Partial<ExportConfig>): ExportSelectionValidation {
  const booleanError = validateOptionalBooleanFields(body, ['enabled'])
  if (booleanError) return { valid: false, error: booleanError }

  const includeCollectionIds = normalizeIdList(body.includeCollectionIds, 'includeCollectionIds')
  if (!includeCollectionIds.valid) return includeCollectionIds
  const includeGroupIds = normalizeIdList(body.includeGroupIds, 'includeGroupIds')
  if (!includeGroupIds.valid) return includeGroupIds
  const includeRuleIds = normalizeIdList(body.includeRuleIds, 'includeRuleIds')
  if (!includeRuleIds.valid) return includeRuleIds
  const includeRemoteSetIds = normalizeIdList(body.includeRemoteSetIds, 'includeRemoteSetIds')
  if (!includeRemoteSetIds.valid) return includeRemoteSetIds
  const extraConfig = normalizeExtraConfig(body.extraConfig)
  if (!extraConfig.valid) return extraConfig
  const ruleSetConversionPolicy = normalizeRuleSetConversionPolicy(body.ruleSetConversionPolicy)
  if (!ruleSetConversionPolicy.valid) return ruleSetConversionPolicy

  return {
    valid: true,
    includeCollectionIds: includeCollectionIds.value,
    includeGroupIds: includeGroupIds.value,
    includeRuleIds: includeRuleIds.value,
    includeRemoteSetIds: includeRemoteSetIds.value,
    ...(ruleSetConversionPolicy.value !== undefined
      ? { ruleSetConversionPolicy: ruleSetConversionPolicy.value }
      : {}),
    ...(extraConfig.value !== undefined ? { extraConfig: extraConfig.value } : {}),
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

type ExtraConfigValidation =
  | { valid: true; value?: Record<string, unknown> | null }
  | { valid: false; error: string }

function normalizeExtraConfig(value: unknown): ExtraConfigValidation {
  if (value === undefined) return { valid: true, value: undefined }
  if (value === null) return { valid: true, value: null }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { valid: true, value: value as Record<string, unknown> }
  }
  return { valid: false, error: 'extraConfig must be an object or null' }
}

type RuleSetConversionPolicyValidation =
  | { valid: true; value?: ExportConfig['ruleSetConversionPolicy'] }
  | { valid: false; error: string }

function normalizeRuleSetConversionPolicy(value: unknown): RuleSetConversionPolicyValidation {
  if (value === undefined) return { valid: true }
  if (value === null || value === 'compatible' || value === 'strict') {
    return { valid: true, value }
  }
  return {
    valid: false,
    error: 'ruleSetConversionPolicy must be compatible, strict, or null',
  }
}
