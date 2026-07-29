import { Hono } from 'hono'
import type { Env } from '../types'
import { enabledNodeRowsQuery } from '../services/enabled-node-rows'
import { now } from '../db/helpers'
import { getExportConfigById } from '../export-data'
import { defaultExportConfigId, requestWorkspaceId } from '../services/workspaces'

const app = new Hono<{ Bindings: Env }>()

app.get('/stats', async (c) => {
  const ts = now()
  const workspaceId = requestWorkspaceId(c)
  const defaultExportConfig = await getExportConfigById(c.env.DB, defaultExportConfigId(workspaceId), workspaceId)
  if (!defaultExportConfig) throw new Error('Default export config is not initialized')
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
    count(c.env.DB, 'sources', workspaceId, "type <> 'manual'"),
    count(c.env.DB, 'sources', workspaceId, "type = 'url' AND last_refresh_error IS NOT NULL AND TRIM(last_refresh_error) <> ''"),
    count(c.env.DB, 'nodes', workspaceId),
    countEnabledExportNodes(c.env.DB, workspaceId),
    count(c.env.DB, 'collections', workspaceId),
    count(c.env.DB, 'groups', workspaceId),
    count(c.env.DB, 'rules', workspaceId),
    count(c.env.DB, 'export_configs', workspaceId),
    c.env.DB.prepare("SELECT MAX(last_updated) as last_refreshed_at FROM sources WHERE workspace_id = ? AND type = 'url'")
      .bind(workspaceId)
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
       WHERE r.workspace_id = ? AND r.enabled = 1 AND r.source_overrides IS NOT NULL AND r.source_overrides <> '{}'`
    ).bind(ts, ts, ts, ts, workspaceId).first<{
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
      defaultExportName: defaultExportConfig.name,
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

async function count(db: D1Database, table: string, workspaceId: string, where?: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) as count FROM ${table} WHERE workspace_id = ?${where ? ` AND ${where}` : ''}`)
    .bind(workspaceId)
    .first<{ count: number }>()
  return row?.count ?? 0
}

async function countEnabledExportNodes(db: D1Database, workspaceId: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) as count FROM (${enabledNodeRowsQuery(undefined, workspaceId)}) enabled_nodes`)
    .first<{ count: number }>()
  return row?.count ?? 0
}

export default app
