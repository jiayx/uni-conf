import type {
  ExportConfig,
  NodeCollection,
  NodeFilter,
  NodeRename,
  ProxySource,
  ProxyGroup,
  ProxyNode,
  ProxyRule,
  RemoteRuleSet,
  ExportNodeNamingMode,
} from '@uni-conf/types'
import {
  jsonParse,
  mapCollection,
  mapExportConfig,
  mapGroup,
  mapNode,
  mapRemoteRuleSet,
  mapRule,
  mapSource,
  now,
} from './db/helpers'
import {
  ALL_NODE_OUTLET_GROUP_IDS,
  applyRoutingPolicyGroupLinks,
} from './services/routing-policy-groups'
import { ensureDefaultRemoteRuleSets } from './services/default-rule-sets'
import { syncAutoNodeGroups } from './services/auto-node-groups'
import { enabledNodeRowsQuery } from './services/enabled-node-rows'
import { getAppSettings } from './services/app-settings'

export interface ExportData {
  config?: ExportConfig
  nodeRows: Record<string, unknown>[]
  groupRows: Record<string, unknown>[]
  ruleRows: Record<string, unknown>[]
  remoteSetRows: Record<string, unknown>[]
  sourceRows: Record<string, unknown>[]
  sources: ProxySource[]
  nodes: ProxyNode[]
  groups: ProxyGroup[]
  rules: ProxyRule[]
  remoteSets: RemoteRuleSet[]
  collectionNodeNames: Record<string, string[]>
}

export async function getExportConfigById(
  db: D1Database,
  id: string
): Promise<ExportConfig | null> {
  const row = await db
    .prepare('SELECT * FROM export_configs WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  return row ? mapExportConfig(row) : null
}

export async function getEnabledExportConfigByToken(
  db: D1Database,
  token: string
): Promise<ExportConfig | null> {
  const row = await db
    .prepare('SELECT * FROM export_configs WHERE token = ? AND enabled = 1')
    .bind(token)
    .first<Record<string, unknown>>()
  return row ? mapExportConfig(row) : null
}

export async function buildExportData(
  db: D1Database,
  config?: ExportConfig
): Promise<ExportData> {
  const ts = now()
  await syncAutoNodeGroups(db, ts)
  await ensureDefaultRemoteRuleSets(db, ts)

  const allNodeRows = await selectRows(db, enabledNodeRowsQuery())
  const collectionRows = await buildCollectionNodeRows(db, allNodeRows)
  const allGroupRows = applyRoutingPolicyGroupLinks(
    await selectRows(db, 'SELECT * FROM groups WHERE enabled = 1 ORDER BY sort_order ASC')
  )
  const groupRows = expandReferencedGroupRows(allGroupRows, config?.includeGroupIds)
  const collectionScopeIds = resolveCollectionScopeIds(config, groupRows)
  const nodeRows = collectionScopeIds.length
    ? mergeCollectionRows(collectionRows, collectionScopeIds)
    : allNodeRows
  const sourceNameById = await buildSourceNameById(db)
  const settings = await getAppSettings(db)
  const exportNodeRows = applyExportNodeNames(
    applyDefaultExportDedup(nodeRows),
    sourceNameById,
    settings.exportNodeNamingMode
  )

  const exportGroupIds = new Set(groupRows.map((row) => String(row.id)))
  const ruleRows = filterRowsByTargetGroup(
    await selectRows(
      db,
      'SELECT * FROM rules WHERE enabled = 1 ORDER BY sort_order ASC',
      config?.includeRuleIds
    ),
    exportGroupIds
  )
  const remoteSetRows = filterRowsByTargetGroup(
    await selectRows(
      db,
      'SELECT * FROM remote_rule_sets WHERE enabled = 1 ORDER BY sort_order ASC, created_at ASC',
      config?.includeRemoteSetIds
    ),
    exportGroupIds
  )
  const sourceRows = await selectRows(
    db,
    "SELECT * FROM sources WHERE enabled = 1 AND type = 'url' ORDER BY created_at ASC"
  )

  return {
    config,
    nodeRows: exportNodeRows,
    groupRows,
    ruleRows,
    remoteSetRows,
    sourceRows,
    sources: sourceRows.map(mapSource),
    nodes: exportNodeRows.map(mapNode),
    groups: groupRows.map(mapGroup),
    rules: ruleRows.map(mapRule),
    remoteSets: remoteSetRows.map(mapRemoteRuleSet),
    collectionNodeNames: buildCollectionNodeNames(collectionRows, exportNodeRows),
  }
}

export function filterRowsByTargetGroup(
  rows: Record<string, unknown>[],
  enabledGroupIds: Set<string>
): Record<string, unknown>[] {
  return rows.filter((row) => enabledGroupIds.has(String(row.target_group_id ?? row.targetGroupId ?? '')))
}

async function selectRows(
  db: D1Database,
  baseSql: string,
  includeIds?: string[]
): Promise<Record<string, unknown>[]> {
  if (!includeIds?.length) {
    const { results } = await db.prepare(baseSql).all<Record<string, unknown>>()
    return results
  }

  const placeholders = includeIds.map(() => '?').join(',')
  const clause = baseSql.includes(' ORDER BY ')
    ? baseSql.replace(' ORDER BY ', ` AND id IN (${placeholders}) ORDER BY `)
    : `${baseSql} AND id IN (${placeholders})`
  const { results } = await db.prepare(clause).bind(...includeIds).all<Record<string, unknown>>()
  return results
}

export function expandReferencedGroupRows(
  groupRows: Record<string, unknown>[],
  includeGroupIds?: string[]
): Record<string, unknown>[] {
  if (!includeGroupIds?.length) return groupRows

  const rowsById = new Map(groupRows.map((row) => [String(row.id), row]))
  const selected = new Set<string>()
  const pending = [...includeGroupIds]

  while (pending.length > 0) {
    const id = pending.shift()
    if (!id || selected.has(id)) continue
    const row = rowsById.get(id)
    if (!row) continue

    selected.add(id)
    for (const childId of parseStringArray(row.group_ids)) {
      if (!selected.has(childId)) pending.push(childId)
    }
  }

  return groupRows.filter((row) => selected.has(String(row.id)))
}

export function resolveCollectionScopeIds(
  config: ExportConfig | undefined,
  groupRows: Record<string, unknown>[]
): string[] {
  if (config && isNodeOnlyExport(config)) return config.includeCollectionIds

  if (containsAllNodeOutletGroup(groupRows)) return []

  const groupCollectionIds = collectGroupCollectionIds(groupRows)
  if (groupCollectionIds.length > 0) return groupCollectionIds

  return config?.includeCollectionIds ?? []
}

function isNodeOnlyExport(config: ExportConfig | undefined): boolean {
  return config?.format === 'nodes_base64' || config?.format === 'nodes_raw'
}

function collectGroupCollectionIds(groupRows: Record<string, unknown>[]): string[] {
  const ids = new Set<string>()
  for (const row of groupRows) {
    for (const id of parseStringArray(row.collection_ids)) {
      ids.add(id)
    }
  }
  return [...ids]
}

function containsAllNodeOutletGroup(groupRows: Record<string, unknown>[]): boolean {
  const allNodeGroupIds = new Set(ALL_NODE_OUTLET_GROUP_IDS)
  return groupRows.some((row) => allNodeGroupIds.has(String(row.id)))
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  return jsonParse<string[]>(value) ?? []
}

async function buildCollectionNodeRows(
  db: D1Database,
  allNodeRows: Record<string, unknown>[]
): Promise<Map<string, Record<string, unknown>[]>> {
  const { results } = await db
    .prepare('SELECT * FROM collections WHERE enabled = 1')
    .all<Record<string, unknown>>()

  const collections = results.map(mapCollection)
  const rowsById = new Map(allNodeRows.map((row) => [String(row.id), row]))
  const collectionRows = new Map<string, Record<string, unknown>[]>()

  for (const collection of collections) {
    const scopedRows = scopeRowsForCollection(allNodeRows, collection)
    const scopedNodes = scopedRows.map(mapNode)
    const filteredNodes = applySort(
      applyDedup(applyFilters(scopedNodes, collection.filters), collection.dedup),
      collection.sort,
      collection.sortCountryOrder
    )
    const renamedNodes = applyRenames(filteredNodes, collection.renames)
    const rows: Record<string, unknown>[] = []

    for (const node of renamedNodes) {
      const row = rowsById.get(node.id)
      if (row) rows.push({ ...row, name: node.name })
    }
    collectionRows.set(collection.id, rows)
  }

  return collectionRows
}

function mergeCollectionRows(
  collectionRows: Map<string, Record<string, unknown>[]>,
  collectionIds: string[]
): Record<string, unknown>[] {
  const selected = new Map<string, Record<string, unknown>>()
  for (const id of collectionIds) {
    const rows = collectionRows.get(id) ?? []
    for (const row of rows) {
      selected.set(String(row.id), row)
    }
  }
  return [...selected.values()]
}

export function buildCollectionNodeNames(
  collectionRows: Map<string, Record<string, unknown>[]>,
  exportedRows: Record<string, unknown>[]
): Record<string, string[]> {
  const exportedIds = new Set(exportedRows.map((row) => String(row.id)))
  const exportedNameById = new Map(exportedRows.map((row) => [String(row.id), String(row.name ?? '')]))
  const result: Record<string, string[]> = {}

  for (const [collectionId, rows] of collectionRows) {
    result[collectionId] = rows
      .filter((row) => exportedIds.has(String(row.id)))
      .map((row) => exportedNameById.get(String(row.id)) ?? '')
      .filter(Boolean)
  }

  return result
}

async function buildSourceNameById(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare('SELECT id, name FROM sources').all<{ id: string; name: string }>()
  return new Map(results.map((row) => [row.id, row.name]))
}

export function applyDefaultExportNodeNames(
  rows: Record<string, unknown>[],
  sourceNameById: Map<string, string>
): Record<string, unknown>[] {
  return applyExportNodeNames(rows, sourceNameById, 'smart')
}

export function applyExportNodeNames(
  rows: Record<string, unknown>[],
  sourceNameById: Map<string, string>,
  mode: ExportNodeNamingMode
): Record<string, unknown>[] {
  if (mode === 'original') return rows

  const counters = new Map<string, number>()
  return rows.map((row) => {
    const region = getExportNodeRegion(row)
    const sourceName = normalizeExportNamePart(
      sourceNameById.get(String(row.source_id ?? '')) ?? String(row.source_id ?? 'Source')
    )
    const key = getExportNodeNameCounterKey(region, sourceName, mode)
    const index = (counters.get(key) ?? 0) + 1
    counters.set(key, index)

    return {
      ...row,
      name: buildExportNodeName(region, sourceName, index, mode),
    }
  })
}

function getExportNodeNameCounterKey(
  region: string,
  sourceName: string,
  mode: ExportNodeNamingMode
): string {
  if (mode === 'region_sequence') return region
  if (mode === 'source_region_sequence') return `${sourceName}\u0000${region}`
  return `${region}\u0000${sourceName}`
}

function buildExportNodeName(
  region: string,
  sourceName: string,
  index: number,
  mode: ExportNodeNamingMode
): string {
  const sequence = index.toString().padStart(2, '0')
  if (mode === 'region_sequence') return `${region} - ${sequence}`
  if (mode === 'source_region_sequence') return `${sourceName} - ${region} - ${sequence}`
  return `${region} - ${sourceName} - ${sequence}`
}

export function applyDefaultExportDedup(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = getExportDedupKey(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getExportDedupKey(row: Record<string, unknown>): string {
  const parsedConfig = typeof row.parsed_config === 'string' && row.parsed_config
    ? row.parsed_config
    : undefined
  if (parsedConfig) return `parsed:${parsedConfig}`

  const rawConfig = typeof row.raw_config === 'string' && row.raw_config
    ? row.raw_config
    : undefined
  if (rawConfig) return `raw:${rawConfig}`

  return [
    row.protocol,
    row.server,
    row.port,
  ].map((value) => String(value ?? '')).join('\u0000')
}

function getExportNodeRegion(row: Record<string, unknown>): string {
  const countryCode = String(row.country_code ?? '').trim().toUpperCase()
  if (countryCode) return countryCode
  const country = String(row.country ?? '').trim()
  if (!country) return 'Other'
  return normalizeExportNamePart(country)
}

function normalizeExportNamePart(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim() || 'Unknown'
}

function scopeRowsForCollection(
  rows: Record<string, unknown>[],
  collection: NodeCollection
): Record<string, unknown>[] {
  if (collection.nodeIds.length > 0) {
    const nodeIds = new Set(collection.nodeIds)
    return rows.filter((row) => nodeIds.has(String(row.id)))
  }
  if (collection.sourceIds.length > 0) {
    const sourceIds = new Set(collection.sourceIds)
    return rows.filter((row) => sourceIds.has(String(row.source_id)))
  }
  return rows
}

function applyFilters(nodes: ProxyNode[], filters: NodeFilter[]): ProxyNode[] {
  const enabledFilters = filters.filter((filter) => filter.enabled)
  if (enabledFilters.length === 0) return nodes
  return nodes.filter((node) => enabledFilters.every((filter) => matchesFilter(node, filter)))
}

function matchesFilter(node: ProxyNode, filter: NodeFilter): boolean {
  const fieldValue = getNodeFieldValue(node, filter.field)
  const filterValue = filter.value
  const firstFilterValue = Array.isArray(filterValue) ? filterValue[0] : filterValue
  if (firstFilterValue === undefined) return true

  switch (filter.operator) {
    case 'contains':
      return stringifyField(fieldValue).toLowerCase().includes(firstFilterValue.toLowerCase())
    case 'not_contains':
      return !stringifyField(fieldValue).toLowerCase().includes(firstFilterValue.toLowerCase())
    case 'equals':
      return stringifyField(fieldValue) === firstFilterValue
    case 'not_equals':
      return stringifyField(fieldValue) !== firstFilterValue
    case 'regex':
      try { return new RegExp(firstFilterValue, 'i').test(stringifyField(fieldValue)) } catch { return false }
    case 'not_regex':
      try { return !new RegExp(firstFilterValue, 'i').test(stringifyField(fieldValue)) } catch { return true }
    case 'in': {
      const items = Array.isArray(filterValue) ? filterValue : [filterValue]
      return Array.isArray(fieldValue)
        ? fieldValue.some((value) => items.includes(value))
        : items.includes(fieldValue)
    }
    case 'not_in': {
      const items = Array.isArray(filterValue) ? filterValue : [filterValue]
      return Array.isArray(fieldValue)
        ? !fieldValue.some((value) => items.includes(value))
        : !items.includes(fieldValue)
    }
    default:
      return true
  }
}

function getNodeFieldValue(node: ProxyNode, field: NodeFilter['field']): string | string[] {
  switch (field) {
    case 'name': return node.name
    case 'server': return node.server
    case 'protocol': return node.protocol
    case 'country': return node.country ?? ''
    case 'countryCode': return node.countryCode ?? ''
    case 'tag': return node.tags
    case 'sourceId': return node.sourceId
    default: return ''
  }
}

function stringifyField(value: string | string[]): string {
  return Array.isArray(value) ? value.join(' ') : value
}

function applyDedup(nodes: ProxyNode[], strategy: NodeCollection['dedup']): ProxyNode[] {
  const seen = new Set<string>()
  return nodes.filter((node) => {
    const key = getDedupKey(node, strategy)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getDedupKey(node: ProxyNode, strategy: NodeCollection['dedup']): string {
  switch (strategy) {
    case 'server_port':
      return `${node.server}:${node.port}`
    case 'protocol_server_port':
      return `${node.protocol}:${node.server}:${node.port}`
    case 'full_config':
      return JSON.stringify(node.parsedConfig)
    case 'name':
    default:
      return node.name
  }
}

function applySort(
  nodes: ProxyNode[],
  strategy: NodeCollection['sort'],
  countryOrder?: string[]
): ProxyNode[] {
  const sorted = [...nodes]
  switch (strategy) {
    case 'country': {
      const order = new Map((countryOrder ?? []).map((code, index) => [code, index]))
      sorted.sort((a, b) => {
        const ai = order.get(a.countryCode ?? '') ?? 999
        const bi = order.get(b.countryCode ?? '') ?? 999
        return ai - bi || (a.countryCode ?? '').localeCompare(b.countryCode ?? '') || a.name.localeCompare(b.name)
      })
      break
    }
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name))
      break
    case 'source':
      sorted.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.name.localeCompare(b.name))
      break
    case 'protocol':
      sorted.sort((a, b) => a.protocol.localeCompare(b.protocol) || a.name.localeCompare(b.name))
      break
    case 'manual':
    default:
      break
  }
  return sorted
}

function applyRenames(nodes: ProxyNode[], renames: NodeRename[]): ProxyNode[] {
  const enabledRenames = renames
    .filter((rename) => rename.enabled)
    .sort((a, b) => a.order - b.order)
  if (enabledRenames.length === 0) return nodes

  return nodes.map((node, index) => ({
    ...node,
    name: enabledRenames.reduce((name, rename) => applyRename(name, rename, index), node.name),
  }))
}

function applyRename(name: string, rename: NodeRename, index: number): string {
  switch (rename.type) {
    case 'replace':
      return rename.pattern ? name.replaceAll(rename.pattern, rename.replacement ?? '') : name
    case 'regex':
      try { return rename.pattern ? name.replace(new RegExp(rename.pattern, 'g'), rename.replacement ?? '') : name } catch { return name }
    case 'prefix':
      return `${rename.replacement ?? ''}${name}`
    case 'suffix':
      return `${name}${rename.replacement ?? ''}`
    case 'strip_emoji':
      return name.replace(/\p{Emoji_Presentation}/gu, '').trim()
    case 'auto_number':
      return `${index + 1}. ${name}`
    case 'standardize_country':
    default:
      return name
  }
}
