import type {
  ExportConfig,
  NodeCollection,
  NodeFilter,
  NodeRename,
  ProxyGroup,
  ProxyNode,
  ProxyRule,
  RemoteRuleSet,
} from '@uni-conf/types'
import {
  mapCollection,
  mapExportConfig,
  mapGroup,
  mapNode,
  mapRemoteRuleSet,
  mapRule,
} from './db/helpers'

export interface ExportData {
  config?: ExportConfig
  nodeRows: Record<string, unknown>[]
  groupRows: Record<string, unknown>[]
  ruleRows: Record<string, unknown>[]
  remoteSetRows: Record<string, unknown>[]
  nodes: ProxyNode[]
  groups: ProxyGroup[]
  rules: ProxyRule[]
  remoteSets: RemoteRuleSet[]
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
  const allNodeRows = await selectRows(db, 'SELECT * FROM nodes WHERE enabled = 1')
  const nodeRows = config?.includeCollectionIds.length
    ? await buildCollectionNodeRows(db, allNodeRows, config.includeCollectionIds)
    : allNodeRows

  const groupRows = await selectRows(
    db,
    'SELECT * FROM groups WHERE enabled = 1 ORDER BY sort_order ASC',
    config?.includeGroupIds
  )
  const ruleRows = await selectRows(
    db,
    'SELECT * FROM rules WHERE enabled = 1 ORDER BY sort_order ASC',
    config?.includeRuleIds
  )
  const remoteSetRows = await selectRows(
    db,
    'SELECT * FROM remote_rule_sets WHERE enabled = 1',
    config?.includeRemoteSetIds
  )

  return {
    config,
    nodeRows,
    groupRows,
    ruleRows,
    remoteSetRows,
    nodes: nodeRows.map(mapNode),
    groups: groupRows.map(mapGroup),
    rules: ruleRows.map(mapRule),
    remoteSets: remoteSetRows.map(mapRemoteRuleSet),
  }
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

async function buildCollectionNodeRows(
  db: D1Database,
  allNodeRows: Record<string, unknown>[],
  collectionIds: string[]
): Promise<Record<string, unknown>[]> {
  const placeholders = collectionIds.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT * FROM collections WHERE enabled = 1 AND id IN (${placeholders})`)
    .bind(...collectionIds)
    .all<Record<string, unknown>>()

  const collections = results.map(mapCollection)
  const rowsById = new Map(allNodeRows.map((row) => [String(row.id), row]))
  const selected = new Map<string, Record<string, unknown>>()

  for (const collection of collections) {
    const scopedRows = scopeRowsForCollection(allNodeRows, collection)
    const scopedNodes = scopedRows.map(mapNode)
    const filteredNodes = applySort(
      applyDedup(applyFilters(scopedNodes, collection.filters), collection.dedup),
      collection.sort,
      collection.sortCountryOrder
    )
    const renamedNodes = applyRenames(filteredNodes, collection.renames)

    for (const node of renamedNodes) {
      const row = rowsById.get(node.id)
      if (row) selected.set(node.id, { ...row, name: node.name })
    }
  }

  return [...selected.values()]
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
  if (strategy === 'full_config') return nodes

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
