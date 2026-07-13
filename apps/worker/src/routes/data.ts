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

const MAX_BACKUP_ROWS = 100_000
const BACKUP_VERSION = 2

const TABLE_COLUMNS = {
  sources: ['id', 'name', 'type', 'url', 'format', 'enabled', 'node_count', 'last_updated', 'last_refresh_error', 'update_interval', 'user_agent', 'notes', 'tags', 'source_groups', 'raw_content', 'upload_bytes', 'download_bytes', 'total_bytes', 'expire_time', 'created_at', 'updated_at'],
  nodes: ['id', 'source_id', 'name', 'protocol', 'server', 'port', 'country', 'country_code', 'enabled', 'tags', 'notes', 'raw_config', 'parsed_config', 'is_manual', 'created_at', 'updated_at'],
  collections: ['id', 'name', 'source_ids', 'node_ids', 'filters', 'renames', 'dedup', 'sort', 'sort_country_order', 'enabled', 'notes', 'created_at', 'updated_at'],
  groups: ['id', 'name', 'type', 'collection_ids', 'group_ids', 'builtins', 'test_url', 'interval', 'tolerance', 'lazy', 'enabled', 'sort_order', 'is_builtin', 'created_at', 'updated_at'],
  rules: ['id', 'name', 'type', 'payload', 'no_resolve', 'target_group_id', 'enabled', 'sort_order', 'notes', 'compatibility', 'created_at', 'updated_at'],
  remote_rule_sets: ['id', 'name', 'url', 'format', 'behavior', 'preset_source', 'preset_id', 'target_group_id', 'update_interval', 'enabled', 'sort_order', 'last_updated', 'notes', 'created_at', 'updated_at'],
  export_configs: ['id', 'name', 'format', 'token', 'enabled', 'include_collection_ids', 'include_group_ids', 'include_rule_ids', 'include_remote_set_ids', 'extra_config', 'created_at', 'updated_at'],
  app_settings: ['id', 'language', 'theme', 'routing_policy_template', 'routing_outlet_preferences', 'dns_mode', 'export_node_naming_mode', 'default_export_token', 'show_compatibility_warnings', 'enable_auto_refresh', 'auto_refresh_interval', 'auto_node_groups_enabled', 'auto_node_group_types', 'auto_node_group_keys', 'auto_node_group_include_flag', 'updated_at'],
} as const satisfies Record<TableName, readonly string[]>

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
      version: BACKUP_VERSION,
      containsSensitiveData: true,
      tables: data,
    },
  })
})

app.post('/import', async (c) => {
  const body = await c.req.json<ImportPayload>()
  const validation = validateBackupPayload(body)
  if (!validation.valid) return c.json({ success: false, error: validation.error }, 400)
  const tables = validation.tables

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

app.post('/import/validate', async (c) => {
  const body = await c.req.json<ImportPayload>()
  const validation = validateBackupPayload(body)
  if (!validation.valid) return c.json({ success: false, error: validation.error }, 400)
  return c.json({
    success: true,
    data: {
      version: validation.version,
      totalRows: validation.totalRows,
      tables: Object.fromEntries(TABLES.map((table) => [table, validation.tables[table]?.length ?? 0])),
      containsSensitiveData: true,
    },
  })
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
  | { version?: number; tables?: ExportPayload }
  | { data?: { version?: number; tables?: ExportPayload } }

function extractTables(value: ImportPayload): ExportPayload | undefined {
  if ('data' in value && value.data?.tables) return value.data.tables
  if ('tables' in value && value.tables) return value.tables
  return value as ExportPayload
}

type BackupValidation =
  | { valid: true; tables: ExportPayload; version: number; totalRows: number }
  | { valid: false; error: string }

export function validateBackupPayload(value: unknown): BackupValidation {
  if (!isRecord(value)) return { valid: false, error: 'backup must be a JSON object' }
  const payload = value as ImportPayload
  const tables = extractTables(payload)
  if (!tables || !isRecord(tables)) return { valid: false, error: 'tables object is required' }

  const envelope = isRecord(value.data) ? value.data : value
  const versionValue = envelope.version
  const version = versionValue === undefined ? 1 : versionValue
  if (version !== 1 && version !== BACKUP_VERSION) {
    return { valid: false, error: `unsupported backup version: ${String(version)}` }
  }

  for (const key of Object.keys(tables)) {
    if (!TABLES.includes(key as TableName)) return { valid: false, error: `unknown backup table: ${key}` }
  }

  let totalRows = 0
  for (const table of TABLES) {
    const rows = tables[table]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) return { valid: false, error: `${table} must be an array` }
    totalRows += rows.length
    if (totalRows > MAX_BACKUP_ROWS) {
      return { valid: false, error: `backup exceeds ${MAX_BACKUP_ROWS} rows` }
    }
    const allowed = new Set<string>(TABLE_COLUMNS[table])
    for (const [index, row] of rows.entries()) {
      if (!isRecord(row) || Object.keys(row).length === 0) {
        return { valid: false, error: `${table}[${index}] must be a non-empty object` }
      }
      for (const column of Object.keys(row)) {
        if (!allowed.has(column)) return { valid: false, error: `unknown column ${table}.${column}` }
      }
    }
  }

  const relationError = validateBackupRelations(tables)
  if (relationError) return { valid: false, error: relationError }
  return { valid: true, tables, version, totalRows }
}

function validateBackupRelations(tables: ExportPayload): string | undefined {
  const ids = (table: TableName) => new Set((tables[table] ?? []).map((row) => row.id).filter((id): id is string => typeof id === 'string'))
  const sourceIds = ids('sources')
  const groupIds = ids('groups')
  const exportTokens = new Set((tables.export_configs ?? []).map((row) => row.token).filter((token): token is string => typeof token === 'string'))

  for (const [index, row] of (tables.nodes ?? []).entries()) {
    if (typeof row.source_id !== 'string' || !sourceIds.has(row.source_id)) return `nodes[${index}] references a missing source`
  }
  for (const table of ['rules', 'remote_rule_sets'] as const) {
    for (const [index, row] of (tables[table] ?? []).entries()) {
      if (typeof row.target_group_id !== 'string' || !groupIds.has(row.target_group_id)) return `${table}[${index}] references a missing group`
    }
  }
  for (const [index, row] of (tables.app_settings ?? []).entries()) {
    if (row.default_export_token != null && (typeof row.default_export_token !== 'string' || !exportTokens.has(row.default_export_token))) {
      return `app_settings[${index}] references a missing default export token`
    }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default app
