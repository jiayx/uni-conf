import { newId } from '../db/helpers'
import type {
  RemoteRuleSet,
  RuleSetCatalogSnapshot,
  UnmatchedTrafficPolicy,
} from '@uni-conf/types'
import { getRuleSetCatalogSnapshot } from './rule-set-catalogs'
import { DEFAULT_WORKSPACE_ID } from './workspaces'

type TargetGroupInfo = { id: string; enabled: boolean }
type TargetGroupIndex = {
  byName: Map<string, TargetGroupInfo>
  byId: Map<string, TargetGroupInfo>
}
type ExistingPreset = {
  id: string
  url: string
  format: RemoteRuleSet['format']
  behavior: RemoteRuleSet['behavior']
  target_group_id: string
  target_override_group_id?: string | null
  enabled: number
  sort_order: number
  notes: string
  source_overrides: RemoteRuleSet['sourceOverrides']
}

const SYSTEM_DISABLED_MISSING_TARGET_NOTE = '[uni-conf:auto-disabled:missing-target]'

export async function ensureDefaultRemoteRuleSets(
  db: D1Database,
  ts: string,
  unmatchedTrafficPolicy: UnmatchedTrafficPolicy = 'proxy',
  snapshot?: RuleSetCatalogSnapshot,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<void> {
  const refreshCanonicalFields = snapshot !== undefined
  const catalogSnapshot = snapshot ?? await getRuleSetCatalogSnapshot()
  const groups = await listTargetGroups(db, workspaceId)
  const existingPresets = await listExistingPresetRows(db, workspaceId)
  const healthInvalidationIds = new Set<string>()
  const statements: D1PreparedStatement[] = []
  const managedPresetKeys = new Set(catalogSnapshot.catalogs.flatMap(catalog =>
    catalog.items
      .filter(item => item.provisioning !== 'optional')
      .map(item => presetKey(catalog.id, item.id))))

  for (const [key, existing] of existingPresets) {
    if (!managedPresetKeys.has(key)) {
      statements.push(db.prepare('DELETE FROM remote_rule_sets WHERE id = ?').bind(existing.id))
    }
  }

  for (const catalog of catalogSnapshot.catalogs) {
    for (const item of catalog.items) {
      const key = presetKey(catalog.id, item.id)
      const existing = existingPresets.get(key)
      if (item.provisioning === 'optional') continue

      const source = item.sources.find(candidate => candidate.default) ?? item.sources[0]
      if (!source || !item.suggestedTarget) continue
      const targetGroup = resolveTargetGroup(groups, item.suggestedTarget)
      const notes = `${catalog.name}:${item.id}`
      if (!targetGroup) {
        const statement = disableExistingPreset(db, existing, notes, ts)
        if (statement) statements.push(statement)
        continue
      }

      const overrideTarget = resolveOverrideTarget(groups, existing)
      const activeForPolicy = item.activeForUnmatchedPolicies?.includes(unmatchedTrafficPolicy) !== false
      const state = resolveManagedPresetState(
        existing,
        existing?.target_override_group_id
          ? overrideTarget?.enabled === true
          : targetGroup.enabled && activeForPolicy,
        notes,
      )
      const sortOrder = item.sortOrder ?? 900
      const catalogSourceOverrides = buildCatalogSourceOverrides(item.sources)
      if (existing) {
        const name = refreshCanonicalFields ? item.name : undefined
        const url = refreshCanonicalFields ? source.url : existing.url
        const format = refreshCanonicalFields ? source.format : existing.format
        const behavior = refreshCanonicalFields ? source.behavior : existing.behavior
        const sourceOverrides = refreshCanonicalFields
          ? mergeCatalogSourceOverrides(existing.source_overrides, catalogSourceOverrides, catalog.repositoryUrl)
          : existing.source_overrides
        if (
          existing.url === url
          && existing.format === format
          && existing.behavior === behavior
          && existing.target_group_id === targetGroup.id
          && existing.enabled === state.enabled
          && existing.sort_order === sortOrder
          && existing.notes === state.notes
          && JSON.stringify(existing.source_overrides) === JSON.stringify(sourceOverrides)
        ) continue
        if (
          existing.url !== url
          || existing.format !== format
          || existing.behavior !== behavior
        ) healthInvalidationIds.add(existing.id)
        statements.push(db
          .prepare('UPDATE remote_rule_sets SET name = COALESCE(?, name), url = ?, format = ?, behavior = ?, source_overrides = ?, target_group_id = ?, enabled = ?, sort_order = ?, notes = ?, updated_at = ? WHERE id = ?')
          .bind(name ?? null, url, format, behavior, JSON.stringify(sourceOverrides), targetGroup.id, state.enabled, sortOrder, state.notes, ts, existing.id))
        continue
      }

      statements.push(db
        .prepare(
          `INSERT INTO remote_rule_sets
            (id, name, url, format, behavior, preset_source, preset_id, source_overrides, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at, workspace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 24, ?, ?, NULL, ?, ?, ?, ?)`,
        )
        .bind(
          newId(),
          item.name,
          source.url,
          source.format,
          source.behavior,
          catalog.id,
          item.id,
          JSON.stringify(catalogSourceOverrides),
          targetGroup.id,
          state.enabled,
          sortOrder,
          state.notes,
          ts,
          ts,
          workspaceId,
        ))
    }
  }

  statements.push(...Array.from(healthInvalidationIds, id => db
    .prepare('DELETE FROM remote_rule_set_source_health WHERE remote_rule_set_id = ?')
    .bind(id)))
  if (statements.length > 0) await db.batch(statements)
}

async function listTargetGroups(db: D1Database, workspaceId: string): Promise<TargetGroupIndex> {
  const { results } = await db
    .prepare('SELECT id, name, enabled FROM groups WHERE workspace_id = ?')
    .bind(workspaceId)
    .all<{ id: string; name: string; enabled: number | boolean | null }>()
  const entries = results.map(group => ({
    id: group.id,
    name: group.name,
    enabled: group.enabled !== 0 && group.enabled !== false,
  }))
  return {
    byName: new Map(entries.map(group => [
      group.name.toUpperCase(),
      { id: group.id, enabled: group.enabled },
    ])),
    byId: new Map(entries.map(group => [
      group.id,
      { id: group.id, enabled: group.enabled },
    ])),
  }
}

async function listExistingPresetRows(db: D1Database, workspaceId: string): Promise<Map<string, ExistingPreset>> {
  const { results } = await db
    .prepare('SELECT id, url, format, behavior, preset_source, preset_id, source_overrides, target_group_id, target_override_group_id, enabled, sort_order, notes FROM remote_rule_sets WHERE workspace_id = ? AND preset_source IS NOT NULL AND preset_id IS NOT NULL')
    .bind(workspaceId)
    .all<Omit<ExistingPreset, 'source_overrides'> & { preset_source: string; preset_id: string; source_overrides: string | null }>()
  return new Map(results.map(row => [
    presetKey(row.preset_source, row.preset_id),
    {
      id: row.id,
      url: row.url,
      format: row.format,
      behavior: row.behavior,
      target_group_id: row.target_group_id,
      target_override_group_id: row.target_override_group_id,
      enabled: row.enabled ?? 1,
      sort_order: row.sort_order ?? 0,
      notes: row.notes ?? '',
      source_overrides: parseSourceOverrides(row.source_overrides),
    },
  ]))
}

function resolveTargetGroup(groups: TargetGroupIndex, groupName: string): TargetGroupInfo | undefined {
  return groups.byName.get(groupName.toUpperCase())
}

function resolveOverrideTarget(
  groups: TargetGroupIndex,
  existing: { target_override_group_id?: string | null } | undefined,
): TargetGroupInfo | undefined {
  return existing?.target_override_group_id
    ? groups.byId.get(existing.target_override_group_id)
    : undefined
}

function disableExistingPreset(
  db: D1Database,
  existing: { id: string; enabled: number; notes: string } | undefined,
  canonicalNotes: string,
  ts: string,
): D1PreparedStatement | null {
  if (!existing || (existing.enabled === 0 && !isSystemDisabledForMissingTarget(existing))) return null
  if (existing.enabled === 0 && existing.notes === withSystemDisabledNote(canonicalNotes)) return null
  return db
    .prepare('UPDATE remote_rule_sets SET enabled = 0, notes = ?, updated_at = ? WHERE id = ?')
    .bind(withSystemDisabledNote(canonicalNotes), ts, existing.id)
}

function resolveManagedPresetState(
  existing: { enabled: number; notes: string } | undefined,
  targetEnabled: boolean,
  canonicalNotes: string,
): { enabled: number; notes: string } {
  if (!targetEnabled) {
    if (existing && existing.enabled === 0 && !isSystemDisabledForMissingTarget(existing)) {
      return { enabled: 0, notes: existing.notes }
    }
    return { enabled: 0, notes: withSystemDisabledNote(canonicalNotes) }
  }
  if (existing && !isSystemDisabledForMissingTarget(existing)) {
    return { enabled: existing.enabled, notes: canonicalNotes }
  }
  return { enabled: 1, notes: canonicalNotes }
}

function isSystemDisabledForMissingTarget(existing: { enabled: number; notes: string }): boolean {
  return existing.enabled === 0 && existing.notes.includes(SYSTEM_DISABLED_MISSING_TARGET_NOTE)
}

function withSystemDisabledNote(notes: string): string {
  if (notes.includes(SYSTEM_DISABLED_MISSING_TARGET_NOTE)) return notes
  return `${notes}\n${SYSTEM_DISABLED_MISSING_TARGET_NOTE}`
}

function presetKey(source: string, id: string): string {
  return `${source}:${id}`
}

function buildCatalogSourceOverrides(
  sources: RuleSetCatalogSnapshot['catalogs'][number]['items'][number]['sources'],
): RemoteRuleSet['sourceOverrides'] {
  return Object.fromEntries(sources
    .filter(source => !source.default)
    .flatMap(source => source.nativeFor.map(target => [target, source.url] as const)))
}

function mergeCatalogSourceOverrides(
  existing: RemoteRuleSet['sourceOverrides'],
  canonical: RemoteRuleSet['sourceOverrides'],
  repositoryUrl: string,
): RemoteRuleSet['sourceOverrides'] {
  const repositoryPath = new URL(repositoryUrl).pathname.replace(/^\/|\.git$/g, '').toLowerCase()
  const merged = { ...canonical }
  for (const [target, url] of Object.entries(existing)) {
    if (!url) continue
    try {
      const parsed = new URL(url)
      const isCatalogSource = parsed.hostname === 'raw.githubusercontent.com'
        && parsed.pathname.toLowerCase().startsWith(`/${repositoryPath}/`)
      if (!isCatalogSource) merged[target as keyof typeof merged] = url
    } catch {
      merged[target as keyof typeof merged] = url
    }
  }
  return merged
}

function parseSourceOverrides(value: string | null): RemoteRuleSet['sourceOverrides'] {
  try {
    const parsed = JSON.parse(value ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as RemoteRuleSet['sourceOverrides']
      : {}
  } catch {
    return {}
  }
}
