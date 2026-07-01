import { Hono } from 'hono'
import type { Env } from '../types'
import { now } from '../db/helpers'
import { ensureZeroSetupDefaults } from '../services/zero-setup'

const app = new Hono<{ Bindings: Env }>()

const TABLES = [
  'sources',
  'nodes',
  'collections',
  'groups',
  'rules',
  'remote_rule_sets',
  'export_configs',
  'app_settings',
] as const

type TableName = typeof TABLES[number]
type ExportPayload = Partial<Record<TableName, Record<string, unknown>[]>>

app.get('/export', async (c) => {
  await restoreDefaultData(c.env.DB, now())
  const data: ExportPayload = {}
  for (const table of TABLES) {
    const { results } = await c.env.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>()
    data[table] = results
  }

  return c.json({
    success: true,
    data: {
      exportedAt: new Date().toISOString(),
      version: 1,
      tables: data,
    },
  })
})

app.post('/import', async (c) => {
  const body = await c.req.json<ImportPayload>()
  const tables = extractTables(body)
  if (!tables || typeof tables !== 'object') {
    return c.json({ success: false, error: 'tables object is required' }, 400)
  }

  const stmts: D1PreparedStatement[] = []
  for (const table of [...TABLES].reverse()) {
    stmts.push(c.env.DB.prepare(`DELETE FROM ${table}`))
  }
  for (const table of TABLES) {
    const rows = tables[table]
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      stmts.push(insertRow(c.env.DB, table, row))
    }
  }

  await c.env.DB.batch(stmts)
  await restoreDefaultData(c.env.DB, now())
  return c.json({ success: true, data: null })
})

app.delete('/', async (c) => {
  const ts = now()
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM export_configs'),
    c.env.DB.prepare('DELETE FROM remote_rule_sets'),
    c.env.DB.prepare('DELETE FROM rules'),
    c.env.DB.prepare('DELETE FROM collections'),
    c.env.DB.prepare('DELETE FROM nodes'),
    c.env.DB.prepare('DELETE FROM sources'),
    c.env.DB.prepare('DELETE FROM groups WHERE is_builtin = 0'),
    c.env.DB.prepare(
      `UPDATE app_settings SET
        language = 'zh',
        theme = 'system',
        routing_policy_template = 'common',
        routing_outlet_preferences = NULL,
        dns_mode = 'smart',
        export_node_naming_mode = 'smart',
        default_export_token = NULL,
        show_compatibility_warnings = 1,
        enable_auto_refresh = 1,
        auto_refresh_interval = 1440,
        auto_node_groups_enabled = 1,
        auto_node_group_types = '["url-test"]',
        auto_node_group_keys = NULL,
        auto_node_group_include_flag = 1,
        updated_at = ?
       WHERE id = 'singleton'`
    ).bind(ts),
  ])

  await restoreDefaultData(c.env.DB, ts)

  return c.json({ success: true, data: null })
})

export async function restoreDefaultData(db: D1Database, ts: string): Promise<void> {
  await ensureZeroSetupDefaults(db, ts)
}

function insertRow(db: D1Database, table: TableName, row: Record<string, unknown>): D1PreparedStatement {
  const entries = Object.entries(row)
  if (entries.length === 0) throw new Error(`Cannot import empty row into ${table}`)

  const columns = entries.map(([column]) => column)
  const placeholders = entries.map(() => '?').join(', ')
  return db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
  ).bind(...entries.map(([, value]) => value))
}

type ImportPayload =
  | ExportPayload
  | { tables?: ExportPayload }
  | { data?: { tables?: ExportPayload } }

function extractTables(value: ImportPayload): ExportPayload | undefined {
  if ('data' in value && value.data?.tables) return value.data.tables
  if ('tables' in value && value.tables) return value.tables
  return value as ExportPayload
}

export default app
