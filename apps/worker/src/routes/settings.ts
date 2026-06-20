import { Hono } from 'hono'
import type { Env } from '../types'
import type { AppSettings } from '@uni-conf/types'
import { now } from '../db/helpers'
import { syncRoutingPolicyGroups } from '../services/routing-policy-groups'
import { ensureDefaultRemoteRuleSets } from '../services/default-rule-sets'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
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
  const row = await db.prepare('SELECT * FROM app_settings WHERE id = ?')
    .bind('singleton')
    .first<Record<string, unknown>>()

  if (!row) {
    const ts = now()
    await db.prepare('INSERT INTO app_settings (id, updated_at) VALUES (?, ?)')
      .bind('singleton', ts)
      .run()
    return getSettings(db)
  }

  return {
    language: row.language as AppSettings['language'],
    theme: row.theme as AppSettings['theme'],
    routingPolicyTemplate: (row.routing_policy_template as AppSettings['routingPolicyTemplate'] | null) ?? 'common',
    defaultExportToken: (row.default_export_token as string | null) ?? undefined,
    showCompatibilityWarnings: Boolean(row.show_compatibility_warnings),
    enableAutoRefresh: Boolean(row.enable_auto_refresh),
    autoRefreshInterval: row.auto_refresh_interval as number,
  }
}

export default app
