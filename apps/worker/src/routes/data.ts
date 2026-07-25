import { Hono } from 'hono'
import type { Env } from '../types'
import { now } from '../db/helpers'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import { isSafeRemoteHttpUrl } from '../services/safe-remote-fetch'
import { validateGroupReferenceGraph } from '../services/group-reference-graph'
import { FULL_CONFIG_EXPORT_FORMATS, isFullConfigExportFormat } from '@uni-conf/shared'

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
  'source_import_runs',
] as const

const MAX_BACKUP_ROWS = 100_000
const BACKUP_VERSION = 4

const TABLE_COLUMNS = {
  sources: ['id', 'name', 'type', 'url', 'format', 'enabled', 'node_count', 'last_updated', 'last_refresh_error', 'update_interval', 'user_agent', 'notes', 'tags', 'source_groups', 'raw_content', 'upload_bytes', 'download_bytes', 'total_bytes', 'expire_time', 'created_at', 'updated_at'],
  nodes: ['id', 'source_id', 'name', 'protocol', 'server', 'port', 'country', 'country_code', 'enabled', 'tags', 'notes', 'raw_config', 'parsed_config', 'is_manual', 'created_at', 'updated_at'],
  collections: ['id', 'name', 'source_ids', 'node_ids', 'filters', 'renames', 'dedup', 'sort', 'sort_country_order', 'enabled', 'notes', 'created_at', 'updated_at'],
  groups: ['id', 'name', 'type', 'collection_ids', 'group_ids', 'builtins', 'test_url', 'interval', 'tolerance', 'lazy', 'enabled', 'sort_order', 'is_builtin', 'created_at', 'updated_at'],
  rules: ['id', 'name', 'type', 'payload', 'no_resolve', 'target_group_id', 'enabled', 'sort_order', 'notes', 'compatibility', 'created_at', 'updated_at'],
  remote_rule_sets: ['id', 'name', 'url', 'format', 'behavior', 'preset_source', 'preset_id', 'source_overrides', 'target_group_id', 'update_interval', 'enabled', 'sort_order', 'last_updated', 'notes', 'created_at', 'updated_at'],
  export_configs: ['id', 'name', 'format', 'token', 'enabled', 'include_collection_ids', 'include_group_ids', 'include_rule_ids', 'include_remote_set_ids', 'rule_set_conversion_policy', 'extra_config', 'created_at', 'updated_at'],
  app_settings: ['id', 'language', 'theme', 'routing_policy_template', 'routing_outlet_preferences', 'dns_mode', 'export_node_naming_mode', 'default_export_token', 'show_compatibility_warnings', 'rule_set_conversion_policy', 'enable_auto_refresh', 'auto_refresh_interval', 'auto_node_groups_enabled', 'auto_node_group_types', 'auto_node_group_keys', 'auto_node_group_include_flag', 'updated_at'],
  source_import_runs: ['id', 'source_id', 'source_name', 'format', 'node_import_mode', 'status', 'node_count', 'added_count', 'updated_count', 'skipped_existing_count', 'rule_count', 'remote_rule_set_count', 'skipped_rule_count', 'conflict_count', 'refresh_error', 'structured_error', 'structured_changes', 'created_at', 'completed_at', 'undone_at'],
} as const satisfies Record<TableName, readonly string[]>

type TableName = typeof TABLES[number]
type ExportPayload = Record<TableName, Record<string, unknown>[]>

const NON_NULL_COLUMNS = {
  sources: ['id', 'name', 'type', 'format', 'enabled', 'node_count', 'tags', 'source_groups', 'created_at', 'updated_at'],
  nodes: ['id', 'source_id', 'name', 'protocol', 'server', 'port', 'enabled', 'tags', 'raw_config', 'parsed_config', 'is_manual', 'created_at', 'updated_at'],
  collections: ['id', 'name', 'source_ids', 'node_ids', 'filters', 'renames', 'dedup', 'sort', 'enabled', 'created_at', 'updated_at'],
  groups: ['id', 'name', 'type', 'collection_ids', 'group_ids', 'builtins', 'enabled', 'sort_order', 'is_builtin', 'created_at', 'updated_at'],
  rules: ['id', 'type', 'payload', 'no_resolve', 'target_group_id', 'enabled', 'sort_order', 'compatibility', 'created_at', 'updated_at'],
  remote_rule_sets: ['id', 'name', 'url', 'format', 'behavior', 'source_overrides', 'target_group_id', 'update_interval', 'enabled', 'sort_order', 'created_at', 'updated_at'],
  export_configs: ['id', 'name', 'format', 'token', 'enabled', 'include_collection_ids', 'include_group_ids', 'include_rule_ids', 'include_remote_set_ids', 'created_at', 'updated_at'],
  app_settings: ['id', 'language', 'theme', 'routing_policy_template', 'dns_mode', 'export_node_naming_mode', 'show_compatibility_warnings', 'rule_set_conversion_policy', 'enable_auto_refresh', 'auto_refresh_interval', 'auto_node_groups_enabled', 'auto_node_group_types', 'auto_node_group_include_flag', 'updated_at'],
  source_import_runs: ['id', 'source_name', 'format', 'node_import_mode', 'status', 'node_count', 'added_count', 'updated_count', 'skipped_existing_count', 'rule_count', 'remote_rule_set_count', 'skipped_rule_count', 'conflict_count', 'structured_changes', 'created_at'],
} as const satisfies Record<TableName, readonly string[]>

app.get('/export', async (c) => {
  await restoreDefaultData(c.env.DB, now())
  const data: ExportPayload = {
    sources: [],
    nodes: [],
    collections: [],
    groups: [],
    rules: [],
    remote_rule_sets: [],
    export_configs: [],
    app_settings: [],
    source_import_runs: [],
  }
  for (const table of TABLES) {
    const { results } = await c.env.DB.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>()
    data[table] = results
  }

  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')
  c.header('Content-Disposition', `attachment; filename="uni-conf-backup-${new Date().toISOString().slice(0, 10)}.json"`)
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
  const body = await c.req.json<unknown>()
  const validation = validateBackupPayload(body)
  if (!validation.valid) return c.json({ success: false, error: validation.error }, 400)
  const tables = validation.tables

  const stmts: D1PreparedStatement[] = []
  for (const table of [...TABLES].reverse()) {
    stmts.push(c.env.DB.prepare(`DELETE FROM ${table}`))
  }
  for (const table of TABLES) {
    const rows = tables[table]
    for (const row of rows) {
      stmts.push(insertRow(c.env.DB, table, row))
    }
  }

  await c.env.DB.batch(stmts)
  await restoreDefaultData(c.env.DB, now())
  return c.json({ success: true, data: null })
})

app.post('/import/validate', async (c) => {
  const body = await c.req.json<unknown>()
  const validation = validateBackupPayload(body)
  if (!validation.valid) return c.json({ success: false, error: validation.error }, 400)
  return c.json({
    success: true,
    data: {
      version: validation.version,
      totalRows: validation.totalRows,
      tables: Object.fromEntries(TABLES.map((table) => [table, validation.tables[table].length])),
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
    c.env.DB.prepare('DELETE FROM source_import_runs'),
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
        rule_set_conversion_policy = 'compatible',
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

type BackupValidation =
  | { valid: true; tables: ExportPayload; version: number; totalRows: number }
  | { valid: false; error: string }

export function validateBackupPayload(value: unknown): BackupValidation {
  if (!isRecord(value)) return { valid: false, error: 'backup must be a JSON object' }
  const envelope = isRecord(value.data) ? value.data : value
  const versionValue = envelope.version
  if (typeof versionValue !== 'number') {
    return { valid: false, error: `unsupported backup version: ${String(versionValue)}` }
  }
  if (versionValue !== BACKUP_VERSION) {
    return { valid: false, error: `unsupported backup version: ${String(versionValue)}` }
  }
  if (!isRecord(envelope.tables)) return { valid: false, error: 'tables object is required' }
  const tables = envelope.tables

  for (const key of Object.keys(tables)) {
    if (!TABLES.includes(key as TableName)) return { valid: false, error: `unknown backup table: ${key}` }
  }

  let totalRows = 0
  for (const table of TABLES) {
    const rows = tables[table]
    if (!Array.isArray(rows)) return { valid: false, error: `${table} must be an array` }
    totalRows += rows.length
    if (totalRows > MAX_BACKUP_ROWS) {
      return { valid: false, error: `backup exceeds ${MAX_BACKUP_ROWS} rows` }
    }
    const expectedColumns = TABLE_COLUMNS[table]
    const allowed = new Set<string>(expectedColumns)
    for (const [index, row] of rows.entries()) {
      if (!isRecord(row) || Object.keys(row).length === 0) {
        return { valid: false, error: `${table}[${index}] must be a non-empty object` }
      }
      for (const column of Object.keys(row)) {
        if (!allowed.has(column)) return { valid: false, error: `unknown column ${table}.${column}` }
      }
      for (const column of expectedColumns) {
        if (!Object.hasOwn(row, column)) return { valid: false, error: `${table}[${index}].${column} is required` }
      }
      const shapeError = validateBackupRowShape(table, row, index)
      if (shapeError) return { valid: false, error: shapeError }
    }
  }

  const currentTables = tables as ExportPayload
  const relationError = validateBackupRelations(currentTables)
  if (relationError) return { valid: false, error: relationError }
  return { valid: true, tables: currentTables, version: versionValue, totalRows }
}

function validateBackupRowShape(table: TableName, row: Record<string, unknown>, index: number): string | undefined {
  for (const column of NON_NULL_COLUMNS[table]) {
    if (row[column] == null) return `${table}[${index}].${column} must not be null`
  }

  if (table === 'sources' && !['url', 'manual', 'file', 'clipboard'].includes(String(row.type))) {
    return `sources[${index}].type is invalid`
  }
  if (table === 'groups' && !['select', 'url-test', 'fallback', 'load-balance', 'direct', 'reject'].includes(String(row.type))) {
    return `groups[${index}].type is invalid`
  }
  if (table === 'remote_rule_sets') {
    const sourceOverridesError = validateSourceOverridesBackup(row.source_overrides)
    if (sourceOverridesError) return `remote_rule_sets[${index}].source_overrides ${sourceOverridesError}`
  }
  if (
    table === 'export_configs'
    && row.rule_set_conversion_policy !== null
    && row.rule_set_conversion_policy !== 'compatible'
    && row.rule_set_conversion_policy !== 'strict'
  ) {
    return `export_configs[${index}].rule_set_conversion_policy is invalid`
  }
  if (table === 'source_import_runs') {
    if (!['all', 'new-only'].includes(String(row.node_import_mode))) {
      return `source_import_runs[${index}].node_import_mode is invalid`
    }
    if (!['running', 'success', 'partial', 'undone'].includes(String(row.status))) {
      return `source_import_runs[${index}].status is invalid`
    }
  }
  return undefined
}

function validateSourceOverridesBackup(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'must be a JSON object string'
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return 'must contain valid JSON'
  }
  if (!isRecord(parsed) || Object.keys(parsed).length > FULL_CONFIG_EXPORT_FORMATS.length) {
    return 'must contain a supported target-to-URL object'
  }
  for (const [target, url] of Object.entries(parsed)) {
    if (!isFullConfigExportFormat(target) || typeof url !== 'string' || !isSafeRemoteHttpUrl(url)) {
      return 'must contain only supported targets and public http(s) URLs'
    }
  }
  return undefined
}

function validateBackupRelations(tables: ExportPayload): string | undefined {
  const idsByTable = {} as Record<TableName, Set<string>>
  for (const table of TABLES) {
    const ids = new Set<string>()
    for (const [index, row] of tables[table].entries()) {
      if (typeof row.id !== 'string' || !row.id.trim()) return `${table}[${index}].id must be a non-empty string`
      if (ids.has(row.id)) return `${table}[${index}].id duplicates ${row.id}`
      ids.add(row.id)
    }
    idsByTable[table] = ids
  }

  const ids = (table: TableName) => idsByTable[table]
  const sourceIds = ids('sources')
  const nodeIds = ids('nodes')
  const collectionIds = ids('collections')
  const groupIds = ids('groups')
  const ruleIds = ids('rules')
  const remoteSetIds = ids('remote_rule_sets')
  const exportTokens = new Set<string>()

  for (const [index, row] of tables.export_configs.entries()) {
    if (typeof row.token !== 'string' || !row.token.trim()) return `export_configs[${index}].token must be a non-empty string`
    if (exportTokens.has(row.token)) return `export_configs[${index}].token duplicates ${row.token}`
    exportTokens.add(row.token)
  }

  for (const [index, row] of tables.nodes.entries()) {
    if (typeof row.source_id !== 'string' || !sourceIds.has(row.source_id)) return `nodes[${index}] references a missing source`
  }
  for (const [index, row] of tables.source_import_runs.entries()) {
    if (row.source_id != null && (typeof row.source_id !== 'string' || !sourceIds.has(row.source_id))) {
      return `source_import_runs[${index}] references a missing source`
    }
  }

  for (const [index, row] of tables.collections.entries()) {
    const sourceError = validateJsonReferences(row.source_ids, `collections[${index}].source_ids`, sourceIds, 'source')
    if (sourceError) return sourceError
    const nodeError = validateJsonReferences(row.node_ids, `collections[${index}].node_ids`, nodeIds, 'node')
    if (nodeError) return nodeError
  }

  for (const [index, row] of tables.groups.entries()) {
    const collectionError = validateJsonReferences(row.collection_ids, `groups[${index}].collection_ids`, collectionIds, 'collection')
    if (collectionError) return collectionError
    const groupError = validateJsonReferences(row.group_ids, `groups[${index}].group_ids`, groupIds, 'group')
    if (groupError) return groupError
  }
  const groupGraphError = validateGroupReferenceGraph(tables.groups.map(row => ({
    id: String(row.id),
    groupIds: JSON.parse(String(row.group_ids)) as string[],
  })))
  if (groupGraphError) return groupGraphError
  for (const table of ['rules', 'remote_rule_sets'] as const) {
    for (const [index, row] of tables[table].entries()) {
      if (typeof row.target_group_id !== 'string' || !groupIds.has(row.target_group_id)) return `${table}[${index}] references a missing group`
    }
  }
  for (const [index, row] of tables.app_settings.entries()) {
    if (row.id !== 'singleton') return `app_settings[${index}].id must be singleton`
    if (row.default_export_token != null && (typeof row.default_export_token !== 'string' || !exportTokens.has(row.default_export_token))) {
      return `app_settings[${index}] references a missing default export token`
    }
  }

  for (const [index, row] of tables.export_configs.entries()) {
    const references = [
      ['include_collection_ids', collectionIds, 'collection'],
      ['include_group_ids', groupIds, 'group'],
      ['include_rule_ids', ruleIds, 'rule'],
      ['include_remote_set_ids', remoteSetIds, 'remote rule set'],
    ] as const
    for (const [column, allowedIds, label] of references) {
      const error = validateJsonReferences(row[column], `export_configs[${index}].${column}`, allowedIds, label)
      if (error) return error
    }
  }
  return undefined
}

function validateJsonReferences(
  value: unknown,
  path: string,
  allowedIds: ReadonlySet<string>,
  targetLabel: string
): string | undefined {
  if (typeof value !== 'string') return `${path} must be a JSON string array`

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return `${path} must contain valid JSON`
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !item.trim())) {
    return `${path} must be a JSON string array`
  }
  for (const id of parsed) {
    if (!allowedIds.has(id)) return `${path} references a missing ${targetLabel}: ${id}`
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default app
