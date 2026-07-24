import { Hono } from 'hono'
import type { Env } from '../types'
import type { AppSettings, AppSettingsPatch, DnsMode, ExportNodeNamingMode, Language, RoutingPolicyTemplateId, RuleSetConversionPolicy, ThemePreference } from '@uni-conf/types'
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
  const rawBody = await c.req.json<unknown>()
  const validationError = validateSettingsPatch(rawBody)
  if (validationError) return c.json({ success: false, error: validationError }, 400)
  const body = rawBody as AppSettingsPatch
  const ts = now()
  const update = buildSettingsUpdate(body, ts)
  await c.env.DB.prepare(update.sql).bind(...update.values).run()

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
const RULE_SET_CONVERSION_POLICIES: ReadonlySet<RuleSetConversionPolicy> = new Set(['compatible', 'strict'])
const SETTINGS_PATCH_KEYS: ReadonlySet<string> = new Set([
  'language',
  'theme',
  'routingPolicyTemplate',
  'routingOutletPreferences',
  'dnsMode',
  'exportNodeNamingMode',
  'defaultExportToken',
  'showCompatibilityWarnings',
  'ruleSetConversionPolicy',
  'enableAutoRefresh',
  'autoRefreshInterval',
  'autoNodeGroupsEnabled',
  'autoNodeGroupTypes',
  'autoNodeGroupKeys',
  'autoNodeGroupIncludeFlag',
])

type SettingsSqlValue = string | number | null

export interface SettingsUpdate {
  sql: string
  values: SettingsSqlValue[]
}

export function buildSettingsUpdate(body: AppSettingsPatch, ts: string): SettingsUpdate {
  const assignments: string[] = []
  const values: SettingsSqlValue[] = []
  const set = (column: string, value: SettingsSqlValue) => {
    assignments.push(`${column} = ?`)
    values.push(value)
  }

  if (body.language !== undefined) set('language', body.language)
  if (body.theme !== undefined) set('theme', body.theme)

  if (body.routingPolicyTemplate !== undefined) {
    if (body.dnsMode === undefined) {
      const recommendedDnsMode = ROUTING_POLICY_TEMPLATES.find(
        template => template.id === body.routingPolicyTemplate
      )?.recommendedDnsMode
      if (recommendedDnsMode === undefined) throw new Error('Unknown routing policy template')
      assignments.push('dns_mode = CASE WHEN routing_policy_template <> ? THEN ? ELSE dns_mode END')
      values.push(body.routingPolicyTemplate, recommendedDnsMode)
    }
    set('routing_policy_template', body.routingPolicyTemplate)
  }

  if (body.routingOutletPreferences !== undefined) {
    set(
      'routing_outlet_preferences',
      body.routingOutletPreferences === null ? null : JSON.stringify(body.routingOutletPreferences),
    )
  }
  if (body.dnsMode !== undefined) set('dns_mode', body.dnsMode)
  if (body.exportNodeNamingMode !== undefined) set('export_node_naming_mode', body.exportNodeNamingMode)
  if (body.defaultExportToken !== undefined) {
    set('default_export_token', normalizeDefaultExportToken(body.defaultExportToken) ?? null)
  }
  if (body.showCompatibilityWarnings !== undefined) {
    set('show_compatibility_warnings', body.showCompatibilityWarnings ? 1 : 0)
  }
  if (body.ruleSetConversionPolicy !== undefined) {
    set('rule_set_conversion_policy', body.ruleSetConversionPolicy)
  }
  if (body.enableAutoRefresh !== undefined) set('enable_auto_refresh', body.enableAutoRefresh ? 1 : 0)
  if (body.autoRefreshInterval !== undefined) set('auto_refresh_interval', body.autoRefreshInterval)
  if (body.autoNodeGroupsEnabled !== undefined) {
    set('auto_node_groups_enabled', body.autoNodeGroupsEnabled ? 1 : 0)
  }
  if (body.autoNodeGroupTypes !== undefined) {
    set('auto_node_group_types', JSON.stringify(body.autoNodeGroupTypes))
  }
  if (body.autoNodeGroupKeys !== undefined) {
    set('auto_node_group_keys', body.autoNodeGroupKeys === null ? null : JSON.stringify(body.autoNodeGroupKeys))
  }
  if (body.autoNodeGroupIncludeFlag !== undefined) {
    set('auto_node_group_include_flag', body.autoNodeGroupIncludeFlag ? 1 : 0)
  }

  set('updated_at', ts)
  return {
    sql: `UPDATE app_settings SET ${assignments.join(', ')} WHERE id = 'singleton'`,
    values,
  }
}

export function validateSettingsPatch(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'settings patch must be a JSON object'
  }
  const keys = Object.keys(value)
  if (keys.length === 0) return 'settings patch must include at least one field'
  const unknownKey = keys.find(key => !SETTINGS_PATCH_KEYS.has(key))
  if (unknownKey) return `unknown settings field: ${unknownKey}`
  const body = value as AppSettingsPatch

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
    if (
      body.autoNodeGroupKeys !== null
      && (!Array.isArray(body.autoNodeGroupKeys) || body.autoNodeGroupKeys.some((key) => !isCanonicalAutoNodeGroupKey(key)))
    ) {
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
  if (body.ruleSetConversionPolicy !== undefined && !RULE_SET_CONVERSION_POLICIES.has(body.ruleSetConversionPolicy)) {
    return 'invalid rule set conversion policy'
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
