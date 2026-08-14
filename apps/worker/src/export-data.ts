import type {
  ExportConfig,
  NodeCollection,
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
} from './db/helpers'
import {
  applyRoutingPolicyGroupLinks,
  listAutoCollectionKeysById,
} from './services/routing-policy-groups'
import { enabledNodeRowsQuery } from './services/enabled-node-rows'
import { getAppSettings } from './services/app-settings'
import { applyCollectionTransforms } from './services/collection-transforms'
import {
  DEFAULT_WORKSPACE_ID,
  workspaceEntityId,
} from './services/workspaces'
import { proxyConnectionFingerprint, sanitizeExportLabel } from '@uni-conf/shared'

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
  id: string,
  workspaceId?: string,
): Promise<ExportConfig | null> {
  const row = await db
    .prepare(`SELECT * FROM export_configs WHERE id = ?${workspaceId ? ' AND workspace_id = ?' : ''}`)
    .bind(...(workspaceId ? [id, workspaceId] : [id]))
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
  config?: ExportConfig,
  requestedFormat?: ExportConfig['format'],
  requestedWorkspaceId?: string,
): Promise<ExportData> {
  const workspaceId = requestedWorkspaceId ?? config?.workspaceId ?? DEFAULT_WORKSPACE_ID
  const settings = await getAppSettings(db, workspaceId)

  const allNodeRows = await selectRows(db, enabledNodeRowsQuery(undefined, workspaceId))
  const collectionRows = await buildCollectionNodeRows(db, allNodeRows, workspaceId)
  const autoCollectionKeysById = await listAutoCollectionKeysById(db, workspaceId)
  const allGroupRows = applyRoutingPolicyGroupLinks(
    await selectRows(db, `SELECT * FROM groups WHERE workspace_id = '${workspaceId}' AND enabled = 1 ORDER BY sort_order ASC`),
    settings.routingOutletPreferences,
    autoCollectionKeysById
  )
  const selectedRuleRows = await selectRows(
    db,
    `SELECT * FROM rules WHERE workspace_id = '${workspaceId}' AND enabled = 1 ORDER BY sort_order ASC`,
    config?.includeRuleIds
  )
  const selectedRemoteSetRows = await selectRows(
    db,
    `SELECT * FROM remote_rule_sets WHERE workspace_id = '${workspaceId}' AND enabled = 1 ORDER BY sort_order ASC, created_at ASC`,
    config?.includeRemoteSetIds
  )
  const finalTargetGroupId = settings.unmatchedTrafficPolicy === 'direct'
    ? workspaceEntityId(workspaceId, 'builtin-direct')
    : workspaceEntityId(workspaceId, 'builtin-proxy')
  const groupRows = resolveExportGroupRows(
    allGroupRows,
    config,
    selectedRuleRows,
    selectedRemoteSetRows,
    finalTargetGroupId,
  )
  const collectionScopeIds = resolveCollectionScopeIds(config, groupRows, requestedFormat)
  const nodeRows = collectionScopeIds.length
    ? mergeCollectionRows(collectionRows, collectionScopeIds)
    : allNodeRows
  const sourceNameById = await buildSourceNameById(db, workspaceId)
  const exportNodeRows = applyExportNodeNames(
    applyDefaultExportDedup(nodeRows),
    sourceNameById,
    settings.exportNodeNamingMode
  )

  const exportGroupIds = new Set(groupRows.map((row) => String(row.id)))
  const configuredRuleRows = filterRowsByTargetGroup(
    selectedRuleRows,
    exportGroupIds
  )
  const ruleRows = [
    ...configuredRuleRows.filter((row) => String(row.type) !== 'MATCH'),
    {
      id: workspaceEntityId(workspaceId, 'builtin-unmatched-traffic'),
      name: 'Unmatched traffic',
      type: 'MATCH',
      payload: '',
      no_resolve: 0,
      target_group_id: finalTargetGroupId,
      enabled: 1,
      sort_order: Number.MAX_SAFE_INTEGER,
      notes: 'Managed by unmatched traffic policy',
      compatibility: '[]',
      created_at: '',
      updated_at: '',
    },
  ]
  const remoteSetRows = filterRowsByTargetGroup(
    selectedRemoteSetRows,
    exportGroupIds
  )
  const sourceRows = await selectRows(
    db,
    `SELECT * FROM sources WHERE workspace_id = '${workspaceId}' AND enabled = 1 AND type = 'url' ORDER BY created_at ASC`
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
  return rows.filter((row) => enabledGroupIds.has(String(
    row.target_override_group_id
    ?? row.target_group_id
    ?? row.targetGroupId
    ?? ''
  )))
}

export function resolveExportGroupRows(
  allGroupRows: Record<string, unknown>[],
  config: ExportConfig | undefined,
  selectedRuleRows: Record<string, unknown>[],
  selectedRemoteSetRows: Record<string, unknown>[],
  finalTargetGroupId: string,
): Record<string, unknown>[] {
  const hasExplicitGroupScope = Boolean(config?.includeGroupIds.length)
  const hasExplicitRuleScope = Boolean(config?.includeRuleIds.length)
  const hasExplicitRemoteSetScope = Boolean(config?.includeRemoteSetIds.length)
  if (!hasExplicitGroupScope && !hasExplicitRuleScope && !hasExplicitRemoteSetScope) return allGroupRows

  const roots = new Set<string>(config?.includeGroupIds ?? [])
  roots.add(finalTargetGroupId)
  if (hasExplicitRuleScope) {
    for (const row of selectedRuleRows) roots.add(targetGroupId(row))
  }
  if (hasExplicitRemoteSetScope) {
    for (const row of selectedRemoteSetRows) roots.add(targetGroupId(row))
  }
  roots.delete('')
  return expandReferencedGroupRows(allGroupRows, [...roots])
}

function targetGroupId(row: Record<string, unknown>): string {
  return String(row.target_override_group_id ?? row.target_group_id ?? row.targetGroupId ?? '')
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
  groupRows: Record<string, unknown>[],
  requestedFormat?: ExportConfig['format']
): string[] {
  if (config && isNodeOnlyExportFormat(requestedFormat ?? config.format)) return config.includeCollectionIds

  const groupCollectionIds = collectGroupCollectionIds(groupRows)
  if (groupCollectionIds.length > 0) return groupCollectionIds

  return config?.includeCollectionIds ?? []
}

function isNodeOnlyExportFormat(format: ExportConfig['format'] | undefined): boolean {
  return format === 'nodes_base64' || format === 'nodes_raw'
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

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  return jsonParse<string[]>(value) ?? []
}

async function buildCollectionNodeRows(
  db: D1Database,
  allNodeRows: Record<string, unknown>[],
  workspaceId: string,
): Promise<Map<string, Record<string, unknown>[]>> {
  const { results } = await db
    .prepare('SELECT * FROM collections WHERE workspace_id = ? AND enabled = 1')
    .bind(workspaceId)
    .all<Record<string, unknown>>()

  const collections = results.map(mapCollection)
  const rowsById = new Map(allNodeRows.map((row) => [String(row.id), row]))
  const collectionRows = new Map<string, Record<string, unknown>[]>()

  for (const collection of collections) {
    const scopedRows = scopeRowsForCollection(allNodeRows, collection)
    const scopedNodes = scopedRows.map(mapNode)
    const transformedNodes = applyCollectionTransforms(scopedNodes, collection)
    const rows: Record<string, unknown>[] = []

    for (const node of transformedNodes) {
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
  const exportedNameByDedupKey = new Map(exportedRows.map((row) => [getExportDedupKey(row), String(row.name ?? '')]))
  const result: Record<string, string[]> = {}

  for (const [collectionId, rows] of collectionRows) {
    const names = new Set<string>()
    for (const row of rows) {
      const id = String(row.id)
      const name = exportedIds.has(id)
        ? exportedNameById.get(id)
        : exportedNameByDedupKey.get(getExportDedupKey(row))
      if (name) names.add(name)
    }
    result[collectionId] = [...names]
  }

  return result
}

async function buildSourceNameById(db: D1Database, workspaceId: string): Promise<Map<string, string>> {
  const { results } = await db.prepare('SELECT id, name FROM sources WHERE workspace_id = ?')
    .bind(workspaceId)
    .all<{ id: string; name: string }>()
  return new Map(results.map((row) => [row.id, row.name]))
}

export function applyExportNodeNames(
  rows: Record<string, unknown>[],
  sourceNameById: Map<string, string>,
  mode: ExportNodeNamingMode
): Record<string, unknown>[] {
  if (mode === 'original') {
    return rows.map((row) => ({ ...row, name: sanitizeExportLabel(row.name) }))
  }

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
  return proxyConnectionFingerprint({
    protocol: String(row.protocol ?? ''),
    server: String(row.server ?? ''),
    port: Number(row.port ?? 0),
    parsedConfig: typeof row.parsed_config === 'string' ? row.parsed_config : null,
    rawConfig: typeof row.raw_config === 'string' ? row.raw_config : null,
  })
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
