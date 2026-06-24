import { Hono } from 'hono'
import type { Env } from '../types'
import { ensureDefaultExportConfig } from '../services/default-export-config'
import { ensureDefaultRemoteRuleSets } from '../services/default-rule-sets'
import { enabledNodeRowsQuery } from '../services/enabled-node-rows'
import { syncAutoNodeGroups } from '../services/auto-node-groups'
import { now } from '../db/helpers'

const app = new Hono<{ Bindings: Env }>()

app.get('/stats', async (c) => {
  const ts = now()
  const defaultExportConfig = await ensureDefaultExportConfig(c.env.DB, ts)
  await syncAutoNodeGroups(c.env.DB, ts)
  await ensureDefaultRemoteRuleSets(c.env.DB, ts)
  const [
    sourceCount,
    nodeCount,
    enabledNodeCount,
    collectionCount,
    groupCount,
    ruleCount,
    exportConfigCount,
    lastRefresh,
  ] = await Promise.all([
    count(c.env.DB, 'sources'),
    count(c.env.DB, 'nodes'),
    countEnabledExportNodes(c.env.DB),
    count(c.env.DB, 'collections'),
    count(c.env.DB, 'groups'),
    count(c.env.DB, 'rules'),
    count(c.env.DB, 'export_configs'),
    c.env.DB.prepare('SELECT MAX(last_updated) as last_refreshed_at FROM sources')
      .first<{ last_refreshed_at: string | null }>(),
  ])

  return c.json({
    success: true,
    data: {
      sourceCount,
      nodeCount,
      enabledNodeCount,
      collectionCount,
      groupCount,
      ruleCount,
      exportConfigCount,
      defaultExportToken: defaultExportConfig.token,
      defaultExportFormat: defaultExportConfig.format,
      lastRefreshedAt: lastRefresh?.last_refreshed_at ?? undefined,
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
