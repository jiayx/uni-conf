import { Hono } from 'hono'
import type { Env } from '../types'
import type { AppSettings, AppSettingsPatch, ExportNodeNamingMode, Language, RoutingPolicyScenarioId, RuleSetConversionPolicy, ThemePreference, UnmatchedTrafficPolicy } from '@uni-conf/types'
import { now } from '../db/helpers'
import { getAppSettings } from '../services/app-settings'
import { syncAutoNodeGroups } from '../services/auto-node-groups'
import { syncRoutingPolicyGroups } from '../services/routing-policy-groups'
import { ensureDefaultRemoteRuleSets } from '../services/default-rule-sets'
import { ALL_ROUTING_POLICY_SCENARIO_IDS, isAutoNodeGroupType, isCanonicalAutoNodeGroupKey } from '@uni-conf/shared'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
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

  const autoGroupsChanged = body.autoNodeGroupsEnabled !== undefined
    || body.autoNodeGroupTypes !== undefined
    || body.autoNodeGroupKeys !== undefined
    || body.autoNodeGroupIncludeFlag !== undefined
  if (autoGroupsChanged) await syncAutoNodeGroups(c.env.DB, ts)
  if (
    autoGroupsChanged
    || body.unmatchedTrafficPolicy !== undefined
    || body.routingPolicyScenarios !== undefined
    || body.routingOutletPreferences !== undefined
  ) {
    await syncRoutingPolicyGroups(c.env.DB, ts)
    const effectiveSettings = await getSettings(c.env.DB)
    await ensureDefaultRemoteRuleSets(c.env.DB, ts, effectiveSettings.unmatchedTrafficPolicy)
  }

  const settings = await getSettings(c.env.DB)
  return c.json({ success: true, data: settings })
})

async function getSettings(db: D1Database): Promise<AppSettings> {
  return getAppSettings(db)
}

const LANGUAGES: ReadonlySet<Language> = new Set(['zh', 'en'])
const THEMES: ReadonlySet<ThemePreference> = new Set(['system', 'light', 'dark'])
const UNMATCHED_TRAFFIC_POLICIES: ReadonlySet<UnmatchedTrafficPolicy> = new Set(['proxy', 'direct'])
const ROUTING_POLICY_SCENARIO_IDS: ReadonlySet<RoutingPolicyScenarioId> = new Set(ALL_ROUTING_POLICY_SCENARIO_IDS)
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
  'unmatchedTrafficPolicy',
  'routingPolicyScenarios',
  'routingOutletPreferences',
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
  if (body.unmatchedTrafficPolicy !== undefined) set('unmatched_traffic_policy', body.unmatchedTrafficPolicy)

  if (body.routingPolicyScenarios !== undefined) {
    set('routing_policy_scenarios', JSON.stringify(body.routingPolicyScenarios))
  }

  if (body.routingOutletPreferences !== undefined) {
    set(
      'routing_outlet_preferences',
      body.routingOutletPreferences === null ? null : JSON.stringify(body.routingOutletPreferences),
    )
  }
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
  if (body.unmatchedTrafficPolicy !== undefined && !UNMATCHED_TRAFFIC_POLICIES.has(body.unmatchedTrafficPolicy)) {
    return 'invalid unmatched traffic policy'
  }
  if (
    body.routingPolicyScenarios !== undefined
    && (
      !Array.isArray(body.routingPolicyScenarios)
      || new Set(body.routingPolicyScenarios).size !== body.routingPolicyScenarios.length
      || body.routingPolicyScenarios.some((scenario) => !ROUTING_POLICY_SCENARIO_IDS.has(scenario))
    )
  ) {
    return 'invalid routing policy scenarios'
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

function isRoutingOutletPreferenceRef(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('group:')) return Boolean(trimmed.slice('group:'.length).trim())
  if (trimmed.startsWith('auto:')) return isCanonicalAutoNodeGroupKey(trimmed.slice('auto:'.length))
  return false
}

export default app
