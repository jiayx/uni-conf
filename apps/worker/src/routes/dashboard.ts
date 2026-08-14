import { Hono } from 'hono'
import type { Env } from '../types'
import { enabledNodeRowsQuery } from '../services/enabled-node-rows'
import { getExportConfigById } from '../export-data'
import { defaultExportConfigId, requestWorkspaceId } from '../services/workspaces'

const app = new Hono<{ Bindings: Env }>()

app.get('/stats', async (c) => {
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
