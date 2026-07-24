import { Hono } from 'hono'
import type { Env } from '../types'
import { enabledNodeRowsQuery } from '../services/enabled-node-rows'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import { now } from '../db/helpers'

const app = new Hono<{ Bindings: Env }>()

app.get('/stats', async (c) => {
  const ts = now()
  const defaultExportConfig = await ensureZeroSetupDefaults(c.env.DB, ts)
  const [
    sourceCount,
    sourceRefreshFailureCount,
    nodeCount,
    enabledNodeCount,
    collectionCount,
    groupCount,
    ruleCount,
    exportConfigCount,
    lastRefresh,
    ruleSetHealth,
  ] = await Promise.all([
    count(c.env.DB, 'sources'),
    count(c.env.DB, 'sources', "last_refresh_error IS NOT NULL AND TRIM(last_refresh_error) <> ''"),
    count(c.env.DB, 'nodes'),
    countEnabledExportNodes(c.env.DB),
    count(c.env.DB, 'collections'),
    count(c.env.DB, 'groups'),
    count(c.env.DB, 'rules'),
    count(c.env.DB, 'export_configs'),
    c.env.DB.prepare('SELECT MAX(last_updated) as last_refreshed_at FROM sources')
      .first<{ last_refreshed_at: string | null }>(),
    c.env.DB.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN h.remote_rule_set_id IS NULL THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN h.remote_rule_set_id IS NOT NULL AND h.expires_at <= ? THEN 1 ELSE 0 END) AS stale,
        SUM(CASE WHEN h.expires_at > ? AND json_extract(h.result, '$.status') = 'valid' THEN 1 ELSE 0 END) AS valid,
        SUM(CASE WHEN h.expires_at > ? AND json_extract(h.result, '$.status') = 'warning' THEN 1 ELSE 0 END) AS warning,
        SUM(CASE WHEN h.expires_at > ? AND json_extract(h.result, '$.status') = 'invalid' THEN 1 ELSE 0 END) AS invalid,
        MAX(h.checked_at) AS last_checked_at
       FROM remote_rule_sets r
       LEFT JOIN remote_rule_set_source_health h ON h.remote_rule_set_id = r.id
       WHERE r.enabled = 1 AND r.source_overrides IS NOT NULL AND r.source_overrides <> '{}'`
    ).bind(ts, ts, ts, ts).first<{
      total: number | null
      valid: number | null
      warning: number | null
      invalid: number | null
      stale: number | null
      pending: number | null
      last_checked_at: string | null
    }>(),
  ])

  return c.json({
    success: true,
    data: {
      sourceCount,
      sourceRefreshFailureCount,
      nodeCount,
      enabledNodeCount,
      collectionCount,
      groupCount,
      ruleCount,
      exportConfigCount,
      defaultExportToken: defaultExportConfig.token,
      defaultExportFormat: defaultExportConfig.format,
      defaultExportEnabled: defaultExportConfig.enabled,
      lastRefreshedAt: lastRefresh?.last_refreshed_at ?? undefined,
      ruleSetHealth: {
        total: Number(ruleSetHealth?.total ?? 0),
        valid: Number(ruleSetHealth?.valid ?? 0),
        warning: Number(ruleSetHealth?.warning ?? 0),
        invalid: Number(ruleSetHealth?.invalid ?? 0),
        stale: Number(ruleSetHealth?.stale ?? 0),
        pending: Number(ruleSetHealth?.pending ?? 0),
        lastCheckedAt: ruleSetHealth?.last_checked_at ?? undefined,
      },
    },
  })
})

async function count(db: D1Database, table: string, where?: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) as count FROM ${table}${where ? ` WHERE ${where}` : ''}`)
    .first<{ count: number }>()
  return row?.count ?? 0
}

async function countEnabledExportNodes(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) as count FROM (${enabledNodeRowsQuery()}) enabled_nodes`)
    .first<{ count: number }>()
  return row?.count ?? 0
}

export default app
