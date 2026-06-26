import { Hono } from 'hono'
import type { Env } from '../types'
import type { AppSettings, AutoNodeGroupType, DnsMode, ExportNodeNamingMode, Language, RoutingPolicyTemplateId, ThemePreference } from '@uni-conf/types'
import { now } from '../db/helpers'
import { ensureDefaultRemoteRuleSets } from '../services/default-rule-sets'
import { getAppSettings } from '../services/app-settings'
import { ensureDefaultExportConfig } from '../services/default-export-config'
import { syncAutoNodeGroups } from '../services/auto-node-groups'
import { DNS_MODE_PRESETS, ROUTING_POLICY_TEMPLATES } from '@uni-conf/shared'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  const ts = now()
  await ensureDefaultExportConfig(c.env.DB, ts)
  await syncAutoNodeGroups(c.env.DB, ts)
  await ensureDefaultRemoteRuleSets(c.env.DB, ts)
  const settings = await getSettings(c.env.DB)
  return c.json({ success: true, data: settings })
})

app.put('/', async (c) => {
  const body = await c.req.json<Partial<AppSettings>>()
  const current = await getSettings(c.env.DB)
  const ts = now()
  const validationError = validateSettingsPatch(body)
  if (validationError) return c.json({ success: false, error: validationError }, 400)

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
      body.routingPolicyTemplate ?? current.routingPolicyTemplate,
      body.routingOutletPreferences !== undefined
        ? JSON.stringify(body.routingOutletPreferences)
        : current.routingOutletPreferences !== undefined
          ? JSON.stringify(current.routingOutletPreferences)
          : null,
      body.dnsMode ?? current.dnsMode,
      body.exportNodeNamingMode ?? current.exportNodeNamingMode,
      body.defaultExportToken !== undefined
        ? body.defaultExportToken
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

  await syncAutoNodeGroups(c.env.DB, ts)
  await ensureDefaultRemoteRuleSets(c.env.DB, ts)

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
const AUTO_NODE_GROUP_TYPES: ReadonlySet<AutoNodeGroupType> = new Set(['select', 'url-test', 'fallback'])

export function validateSettingsPatch(body: Partial<AppSettings>): string | null {
  if (body.language !== undefined && !LANGUAGES.has(body.language)) return 'invalid language'
  if (body.theme !== undefined && !THEMES.has(body.theme)) return 'invalid theme'
  if (body.routingPolicyTemplate !== undefined && !ROUTING_POLICY_TEMPLATE_IDS.has(body.routingPolicyTemplate)) {
    return 'invalid routing policy template'
  }
  if (body.routingOutletPreferences !== undefined) {
    if (
      !body.routingOutletPreferences
      || typeof body.routingOutletPreferences !== 'object'
      || Array.isArray(body.routingOutletPreferences)
      || Object.entries(body.routingOutletPreferences).some(([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim())
    ) {
      return 'invalid routing outlet preferences'
    }
  }
  if (body.dnsMode !== undefined && !DNS_MODES.has(body.dnsMode)) return 'invalid DNS mode'
  if (body.exportNodeNamingMode !== undefined && !EXPORT_NODE_NAMING_MODES.has(body.exportNodeNamingMode)) {
    return 'invalid export node naming mode'
  }
  if (body.autoNodeGroupTypes !== undefined) {
    if (!Array.isArray(body.autoNodeGroupTypes) || body.autoNodeGroupTypes.some((type) => !AUTO_NODE_GROUP_TYPES.has(type))) {
      return 'invalid auto node group type'
    }
  }
  if (body.autoRefreshInterval !== undefined && (!Number.isFinite(body.autoRefreshInterval) || body.autoRefreshInterval <= 0)) {
    return 'invalid auto refresh interval'
  }
  return null
}

export default app
