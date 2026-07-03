import { Hono } from 'hono'
import type { Env } from '../types'
import type { AppSettings, AppSettingsPatch, DnsMode, ExportNodeNamingMode, Language, RoutingPolicyTemplateId, ThemePreference } from '@uni-conf/types'
import { now } from '../db/helpers'
import { getAppSettings } from '../services/app-settings'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import { DNS_MODE_PRESETS, isAutoNodeGroupType, isCanonicalAutoNodeGroupKey, ROUTING_POLICY_TEMPLATES } from '@uni-conf/shared'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  const ts = now()
  await ensureZeroSetupDefaults(c.env.DB, ts)
  const settings = await getSettings(c.env.DB)
  return c.json({ success: true, data: settings })
})

app.put('/', async (c) => {
  const body = await c.req.json<AppSettingsPatch>()
  const current = await getSettings(c.env.DB)
  const ts = now()
  const validationError = validateSettingsPatch(body)
  if (validationError) return c.json({ success: false, error: validationError }, 400)
  const nextRoutingPolicyTemplate = body.routingPolicyTemplate ?? current.routingPolicyTemplate
  const nextDnsMode = resolveNextDnsMode(current, body)

  await c.env.DB.prepare(
    `UPDATE app_settings SET
      language = ?,
      theme = ?,
      routing_policy_template = ?,
      routing_outlet_preferences = ?,
      dns_mode = ?,
      export_node_naming_mode = ?,
      default_export_token = ?,
      show_compatibility_warnings = ?,
      enable_auto_refresh = ?,
      auto_refresh_interval = ?,
      auto_node_groups_enabled = ?,
      auto_node_group_types = ?,
      auto_node_group_keys = ?,
      auto_node_group_include_flag = ?,
      updated_at = ?
     WHERE id = 'singleton'`
  )
    .bind(
      body.language ?? current.language,
      body.theme ?? current.theme,
      nextRoutingPolicyTemplate,
      body.routingOutletPreferences !== undefined
        ? body.routingOutletPreferences === null
          ? null
          : JSON.stringify(body.routingOutletPreferences)
        : current.routingOutletPreferences !== undefined
          ? JSON.stringify(current.routingOutletPreferences)
          : null,
      nextDnsMode,
      body.exportNodeNamingMode ?? current.exportNodeNamingMode,
      body.defaultExportToken !== undefined
        ? normalizeDefaultExportToken(body.defaultExportToken)
        : current.defaultExportToken ?? null,
      body.showCompatibilityWarnings !== undefined
        ? (body.showCompatibilityWarnings ? 1 : 0)
        : current.showCompatibilityWarnings ? 1 : 0,
      body.enableAutoRefresh !== undefined
        ? (body.enableAutoRefresh ? 1 : 0)
        : current.enableAutoRefresh ? 1 : 0,
      body.autoRefreshInterval ?? current.autoRefreshInterval,
      body.autoNodeGroupsEnabled !== undefined
        ? (body.autoNodeGroupsEnabled ? 1 : 0)
        : current.autoNodeGroupsEnabled ? 1 : 0,
      JSON.stringify(body.autoNodeGroupTypes ?? current.autoNodeGroupTypes),
      body.autoNodeGroupKeys !== undefined
        ? JSON.stringify(body.autoNodeGroupKeys)
        : current.autoNodeGroupKeys !== undefined
          ? JSON.stringify(current.autoNodeGroupKeys)
          : null,
      body.autoNodeGroupIncludeFlag !== undefined
        ? (body.autoNodeGroupIncludeFlag ? 1 : 0)
        : current.autoNodeGroupIncludeFlag ? 1 : 0,
      ts
    )
    .run()

  await ensureZeroSetupDefaults(c.env.DB, ts)

  const settings = await getSettings(c.env.DB)
  return c.json({ success: true, data: settings })
})

async function getSettings(db: D1Database): Promise<AppSettings> {
  return getAppSettings(db)
}

const LANGUAGES: ReadonlySet<Language> = new Set(['zh', 'en'])
const THEMES: ReadonlySet<ThemePreference> = new Set(['system', 'light', 'dark'])
const ROUTING_POLICY_TEMPLATE_IDS: ReadonlySet<RoutingPolicyTemplateId> = new Set(
  ROUTING_POLICY_TEMPLATES.map((template) => template.id as RoutingPolicyTemplateId)
)
const DNS_MODES: ReadonlySet<DnsMode> = new Set(DNS_MODE_PRESETS.map((preset) => preset.id as DnsMode))
const EXPORT_NODE_NAMING_MODES: ReadonlySet<ExportNodeNamingMode> = new Set([
  'original',
  'region_sequence',
  'source_region_sequence',
  'smart',
])

export function validateSettingsPatch(body: AppSettingsPatch): string | null {
  if (body.language !== undefined && !LANGUAGES.has(body.language)) return 'invalid language'
  if (body.theme !== undefined && !THEMES.has(body.theme)) return 'invalid theme'
  if (body.routingPolicyTemplate !== undefined && !ROUTING_POLICY_TEMPLATE_IDS.has(body.routingPolicyTemplate)) {
    return 'invalid routing policy template'
  }
  if (body.routingOutletPreferences !== undefined) {
    if (
      body.routingOutletPreferences !== null
      && (typeof body.routingOutletPreferences !== 'object'
      || Array.isArray(body.routingOutletPreferences)
      || Object.entries(body.routingOutletPreferences).some(([key, value]) => !key.trim() || !isRoutingOutletPreferenceRef(value)))
    ) {
      return 'invalid routing outlet preferences'
    }
  }
  if (body.dnsMode !== undefined && !DNS_MODES.has(body.dnsMode)) return 'invalid DNS mode'
  if (body.exportNodeNamingMode !== undefined && !EXPORT_NODE_NAMING_MODES.has(body.exportNodeNamingMode)) {
    return 'invalid export node naming mode'
  }
  if (body.defaultExportToken !== undefined && normalizeDefaultExportToken(body.defaultExportToken) === undefined) {
    return 'invalid default export token'
  }
  if (body.autoNodeGroupTypes !== undefined) {
    if (!Array.isArray(body.autoNodeGroupTypes) || body.autoNodeGroupTypes.some((type) => !isAutoNodeGroupType(type))) {
      return 'invalid auto node group type'
    }
  }
  if (body.autoNodeGroupKeys !== undefined) {
    if (!Array.isArray(body.autoNodeGroupKeys) || body.autoNodeGroupKeys.some((key) => !isCanonicalAutoNodeGroupKey(key))) {
      return 'invalid auto node group key'
    }
  }
  if (body.autoNodeGroupsEnabled !== undefined && typeof body.autoNodeGroupsEnabled !== 'boolean') {
    return 'invalid auto node groups enabled'
  }
  if (body.autoNodeGroupIncludeFlag !== undefined && typeof body.autoNodeGroupIncludeFlag !== 'boolean') {
    return 'invalid auto node group include flag'
  }
  if (body.showCompatibilityWarnings !== undefined && typeof body.showCompatibilityWarnings !== 'boolean') {
    return 'invalid compatibility warnings setting'
  }
  if (body.enableAutoRefresh !== undefined && typeof body.enableAutoRefresh !== 'boolean') {
    return 'invalid auto refresh setting'
  }
  if (
    body.autoRefreshInterval !== undefined
    && (!Number.isInteger(body.autoRefreshInterval) || body.autoRefreshInterval <= 0)
  ) {
    return 'invalid auto refresh interval'
  }
  return null
}

function normalizeDefaultExportToken(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function resolveNextDnsMode(current: AppSettings, body: AppSettingsPatch): DnsMode {
  if (body.dnsMode !== undefined) return body.dnsMode
  if (body.routingPolicyTemplate === undefined || body.routingPolicyTemplate === current.routingPolicyTemplate) {
    return current.dnsMode
  }
  return ROUTING_POLICY_TEMPLATES.find((template) => template.id === body.routingPolicyTemplate)?.recommendedDnsMode
    ?? current.dnsMode
}

function isRoutingOutletPreferenceRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('group:')) return Boolean(trimmed.slice('group:'.length).trim())
  if (trimmed.startsWith('auto:')) return isCanonicalAutoNodeGroupKey(trimmed.slice('auto:'.length))
  return false
}

export default app
