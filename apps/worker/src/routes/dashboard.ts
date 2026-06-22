import { Hono } from 'hono'
import type { Env } from '../types'
import { ensureDefaultExportConfig } from '../services/default-export-config'
import { now } from '../db/helpers'

const app = new Hono<{ Bindings: Env }>()

app.get('/stats', async (c) => {
  const defaultExportConfig = await ensureDefaultExportConfig(c.env.DB, now())
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
    count(c.env.DB, 'nodes', 'enabled = 1'),
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

export default app
