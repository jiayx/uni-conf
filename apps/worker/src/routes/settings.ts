import { Hono } from 'hono'
import type { Env } from '../types'
import type { AppSettings } from '@uni-conf/types'
import { now } from '../db/helpers'
import { syncRoutingPolicyGroups } from '../services/routing-policy-groups'
import { ensureDefaultRemoteRuleSets } from '../services/default-rule-sets'
import { getAppSettings } from '../services/app-settings'
import { ensureDefaultExportConfig } from '../services/default-export-config'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  await ensureDefaultExportConfig(c.env.DB, now())
  const settings = await getSettings(c.env.DB)
  return c.json({ success: true, data: settings })
})

app.put('/', async (c) => {
  const body = await c.req.json<Partial<AppSettings>>()
  const current = await getSettings(c.env.DB)
  const ts = now()
  await c.env.DB.prepare(
    `UPDATE app_settings SET
      language = ?,
      theme = ?,
      routing_policy_template = ?,
      dns_mode = ?,
      export_node_naming_mode = ?,
      default_export_token = ?,
      show_compatibility_warnings = ?,
      enable_auto_refresh = ?,
      auto_refresh_interval = ?,
      updated_at = ?
     WHERE id = 'singleton'`
  )
    .bind(
      body.language ?? current.language,
      body.theme ?? current.theme,
      body.routingPolicyTemplate ?? current.routingPolicyTemplate,
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
      ts
    )
    .run()

  await syncRoutingPolicyGroups(c.env.DB, ts)
  await ensureDefaultRemoteRuleSets(c.env.DB, ts)

  const settings = await getSettings(c.env.DB)
  return c.json({ success: true, data: settings })
})

async function getSettings(db: D1Database): Promise<AppSettings> {
  return getAppSettings(db)
}

export default app
