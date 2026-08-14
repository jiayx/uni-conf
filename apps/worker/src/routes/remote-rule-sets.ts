import { Hono } from 'hono'
import type { Env } from '../types'
import { mapRemoteRuleSet, newId, now } from '../db/helpers'
import type { RemoteRuleSet, RemoteRuleSetSourceOverrides, RuleSetBehavior, RuleSetFormat } from '@uni-conf/types'
import {
  FULL_CONFIG_EXPORT_FORMATS,
  isFullConfigExportFormat,
  isRuleSetFormat,
} from '@uni-conf/shared'
import { DEFAULT_RULE_TARGET_GROUP_ID, isEnabledTargetGroup, listEnabledTargetGroupIds } from '../services/group-targets'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import { isSafeRemoteHttpUrl } from '../services/safe-remote-fetch'
import { validateOptionalBooleanFields } from '../services/request-validation'
import { listSourceRemoteRuleSets } from '../services/source-rule-sets'
import { requestWorkspaceId, workspaceEntityId } from '../services/workspaces'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  const workspaceId = requestWorkspaceId(c)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM remote_rule_sets WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(workspaceId).all<Record<string, unknown>>()
  return c.json({ success: true, data: results.map(mapRemoteRuleSet) })
})

app.post('/', async (c) => {
  const workspaceId = requestWorkspaceId(c)
  const body = await c.req.json<Partial<RemoteRuleSet>>()
  const validation = validateRemoteRuleSetWrite(body, { create: true })
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400)
  }
  let createInput = scopeDefaultTarget(requireCreateRemoteRuleSet(validation), workspaceId)
  const ts = now()
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId)
  const resolvedInput = await resolveLinkedSourceRuleSet(c.env.DB, createInput, workspaceId)
  if (!resolvedInput) return c.json({ success: false, error: 'subscription source rule set is missing or unsupported' }, 400)
  createInput = resolvedInput
  if (!(await isEnabledTargetGroup(c.env.DB, createInput.targetGroupId, workspaceId))) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400)
  }

  const id = newId()
  await c.env.DB.prepare(
    `INSERT INTO remote_rule_sets
      (id, name, url, format, behavior, preset_source, preset_id, source_overrides, source_id, source_rule_set_key, source_missing, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      createInput.name,
      createInput.url,
      createInput.format,
      createInput.behavior,
      null,
      null,
      JSON.stringify(createInput.sourceOverrides),
      createInput.sourceId ?? null,
      createInput.sourceRuleSetKey ?? null,
      createInput.targetGroupId,
      createInput.updateInterval,
      createInput.enabled ? 1 : 0,
      createInput.sortOrder,
      createInput.lastUpdated ?? null,
      createInput.notes ?? null,
      ts,
      ts,
      workspaceId
    )
    .run()

  const row = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>()
  return c.json({ success: true, data: mapRemoteRuleSet(row!) }, 201)
})

app.post('/batch', async (c) => {
  const workspaceId = requestWorkspaceId(c)
  const body = await c.req.json<{ sets?: Array<Partial<RemoteRuleSet>> }>()
  const sets = body.sets ?? []
  if (!Array.isArray(sets) || sets.length === 0) {
    return c.json({ success: false, error: 'sets are required' }, 400)
  }

  const ts = now()
  const createdIds: string[] = []
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId)
  const enabledTargetGroupIds = await listEnabledTargetGroupIds(c.env.DB, workspaceId)

  for (const [index, set] of sets.entries()) {
    const validation = validateRemoteRuleSetWrite(set, { create: true })
    if (!validation.valid) {
      return c.json({ success: false, error: `invalid remote rule set at index ${index}: ${validation.error}` }, 400)
    }
    let createInput = scopeDefaultTarget(requireCreateRemoteRuleSet(validation), workspaceId)
    const resolvedInput = await resolveLinkedSourceRuleSet(c.env.DB, createInput, workspaceId)
    if (!resolvedInput) {
      return c.json({ success: false, error: `subscription source rule set is missing or unsupported at index ${index}` }, 400)
    }
    createInput = resolvedInput
    if (!enabledTargetGroupIds.has(createInput.targetGroupId)) {
      return c.json({ success: false, error: `target group is disabled or missing: ${createInput.targetGroupId}` }, 400)
    }
    const id = newId()
    createdIds.push(id)
    await c.env.DB.prepare(
      `INSERT INTO remote_rule_sets
        (id, name, url, format, behavior, preset_source, preset_id, source_overrides, source_id, source_rule_set_key, source_missing, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        createInput.name,
        createInput.url,
        createInput.format,
        createInput.behavior,
        null,
        null,
        JSON.stringify(createInput.sourceOverrides),
        createInput.sourceId ?? null,
        createInput.sourceRuleSetKey ?? null,
        createInput.targetGroupId,
        createInput.updateInterval,
        createInput.enabled ? 1 : 0,
        createInput.sortOrder,
        createInput.lastUpdated ?? null,
        createInput.notes ?? null,
        ts,
        ts,
        workspaceId
      )
      .run()
  }

  if (createdIds.length === 0) {
    return c.json({ success: false, error: 'No valid remote rule sets to create' }, 400)
  }

  const placeholders = createdIds.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM remote_rule_sets WHERE workspace_id = ? AND id IN (${placeholders}) ORDER BY sort_order ASC, created_at ASC`
  )
    .bind(workspaceId, ...createdIds)
    .all<Record<string, unknown>>()

  return c.json({ success: true, data: results.map(mapRemoteRuleSet) }, 201)
})

app.get('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c)
  const row = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ? AND workspace_id = ?')
    .bind(c.req.param('id'), workspaceId)
    .first<Record<string, unknown>>()

  if (!row) return c.json({ success: false, error: 'Remote rule set not found' }, 404)
  return c.json({ success: true, data: mapRemoteRuleSet(row) })
})

app.put('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c)
  const id = c.req.param('id')
  const ts = now()
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId)
  const existing = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>()
  if (!existing) return c.json({ success: false, error: 'Remote rule set not found' }, 404)

  const body = await c.req.json<Partial<RemoteRuleSet>>()
  const managed = isManagedRemoteRuleSet(existing)
  if (managed && !isManagedRemoteRuleSetUpdate(body)) {
    return c.json({ success: false, error: 'built-in remote rule sets only allow enabled state, target override, and target-native source overrides to be changed' }, 400)
  }
  if (!managed && body.targetOverrideGroupId !== undefined) {
    return c.json({ success: false, error: 'target override is only available for built-in remote rule sets' }, 400)
  }
  const validation = validateRemoteRuleSetWrite(body, { create: false })
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400)
  }
  if (validation.targetGroupId !== undefined && !(await isEnabledTargetGroup(c.env.DB, validation.targetGroupId, workspaceId))) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400)
  }
  if (
    typeof validation.targetOverrideGroupId === 'string'
    && !(await isEnabledTargetGroup(c.env.DB, validation.targetOverrideGroupId, workspaceId))
  ) {
    return c.json({ success: false, error: 'target override group is disabled or missing' }, 400)
  }
  const nextEnabled = validation.enabled !== undefined ? validation.enabled : Number(existing.enabled ?? 1) === 1
  const nextDefaultTargetGroupId = validation.targetGroupId ?? String(existing.target_group_id ?? '')
  const nextOverrideTargetGroupId = validation.targetOverrideGroupId !== undefined
    ? validation.targetOverrideGroupId
    : (existing.target_override_group_id as string | null) ?? null
  if (managed && nextOverrideTargetGroupId === nextDefaultTargetGroupId) {
    return c.json({
      success: false,
      error: 'target override must differ from the system default; use null to restore the default',
    }, 400)
  }
  const nextEffectiveTargetGroupId = nextOverrideTargetGroupId ?? nextDefaultTargetGroupId
  if (
    managed
    && validation.enabled === true
    && !(await isEnabledTargetGroup(c.env.DB, nextEffectiveTargetGroupId, workspaceId))
  ) {
    return c.json({
      success: false,
      code: 'managed_rule_set_unused',
      error: 'the current routing plan does not use this managed rule set; adjust the routing plan or change its target',
    }, 409)
  }
  if (
    nextEnabled
    && !(managed && validation.targetOverrideGroupId === null)
    && !(await isEnabledTargetGroup(c.env.DB, nextEffectiveTargetGroupId, workspaceId))
  ) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400)
  }
  const updateStatement = c.env.DB.prepare(
    `UPDATE remote_rule_sets SET
      name = ?, url = ?, format = ?, behavior = ?, preset_source = ?, preset_id = ?, source_overrides = ?, target_group_id = ?, target_override_group_id = ?, update_interval = ?,
      enabled = ?, sort_order = ?, last_updated = ?, notes = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`
  )
    .bind(
      validation.name ?? existing.name,
      validation.url ?? existing.url,
      validation.format ?? existing.format,
      validation.behavior ?? existing.behavior,
      existing.preset_source,
      existing.preset_id,
      validation.sourceOverrides !== undefined
        ? JSON.stringify(validation.sourceOverrides)
        : existing.source_overrides ?? '{}',
      validation.targetGroupId ?? existing.target_group_id,
      validation.targetOverrideGroupId !== undefined
        ? validation.targetOverrideGroupId
        : existing.target_override_group_id ?? null,
      validation.updateInterval ?? existing.update_interval,
      validation.enabled !== undefined ? (validation.enabled ? 1 : 0) : existing.enabled,
      validation.sortOrder ?? existing.sort_order ?? 500,
      validation.lastUpdated !== undefined ? validation.lastUpdated : existing.last_updated,
      validation.notes !== undefined ? validation.notes : existing.notes,
      ts,
      id,
      workspaceId
    )

  await updateStatement.run()

  if (managed && validation.targetOverrideGroupId !== undefined) {
    await ensureZeroSetupDefaults(c.env.DB, now(), workspaceId)
  }
  const updated = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>()
  return c.json({ success: true, data: mapRemoteRuleSet(updated!) })
})

app.delete('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c)
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id, preset_source, preset_id FROM remote_rule_sets WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>()
  if (!row) return c.json({ success: false, error: 'Remote rule set not found' }, 404)
  if (isManagedRemoteRuleSet(row)) {
    return c.json({ success: false, error: 'built-in remote rule sets can be disabled but not deleted' }, 400)
  }

  await c.env.DB.prepare('DELETE FROM remote_rule_sets WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).run()
  await ensureZeroSetupDefaults(c.env.DB, now(), workspaceId)
  return c.json({ success: true, data: { id } })
})

export interface ManagedRemoteRuleSetFields {
  preset_source?: unknown;
  preset_id?: unknown;
}

export function isManagedRemoteRuleSet(row: ManagedRemoteRuleSetFields): boolean {
  return Boolean(row.preset_source && row.preset_id)
}

export function isManagedRemoteRuleSetUpdate(body: Partial<RemoteRuleSet>): boolean {
  const keys = Object.keys(body)
  return keys.length > 0 && keys.every(
    key => key === 'enabled' || key === 'sourceOverrides' || key === 'targetOverrideGroupId'
  )
}

const RULE_SET_BEHAVIORS: ReadonlySet<RuleSetBehavior> = new Set(['domain', 'ipcidr', 'classical'])

export function isValidRuleSetBehavior(value: unknown): value is RuleSetBehavior {
  return RULE_SET_BEHAVIORS.has(value as RuleSetBehavior)
}

type RemoteRuleSetWriteValidation =
  | {
      valid: true
      name?: string
      url?: string
      format?: RuleSetFormat
      behavior?: RuleSetBehavior
      sourceOverrides?: RemoteRuleSetSourceOverrides
      sourceId?: string
      sourceRuleSetKey?: string
      targetGroupId?: string
      targetOverrideGroupId?: string | null
      updateInterval?: number
      enabled?: boolean
      sortOrder?: number
      lastUpdated?: string | null
      notes?: string | null
    }
  | { valid: false; error: string }

type CreateRemoteRuleSetInput = Extract<RemoteRuleSetWriteValidation, { valid: true }> & {
  name: string
  url: string
  format: RuleSetFormat
  behavior: RuleSetBehavior
  sourceOverrides: RemoteRuleSetSourceOverrides
  sourceId?: string
  sourceRuleSetKey?: string
  targetGroupId: string
  updateInterval: number
  enabled: boolean
  sortOrder: number
}

function requireCreateRemoteRuleSet(
  validation: Extract<RemoteRuleSetWriteValidation, { valid: true }>
): CreateRemoteRuleSetInput {
  return validation as CreateRemoteRuleSetInput
}

async function resolveLinkedSourceRuleSet(
  db: D1Database,
  input: CreateRemoteRuleSetInput,
  workspaceId: string,
): Promise<CreateRemoteRuleSetInput | null> {
  if (!input.sourceId || !input.sourceRuleSetKey) return input
  const candidates = await listSourceRemoteRuleSets(db, input.sourceId, workspaceId)
  const candidate = candidates?.find(item => item.key === input.sourceRuleSetKey)
  if (!candidate) return null
  return {
    ...input,
    url: candidate.url,
    format: candidate.format,
    behavior: candidate.behavior,
    updateInterval: candidate.updateInterval,
  }
}

function scopeDefaultTarget(input: CreateRemoteRuleSetInput, workspaceId: string): CreateRemoteRuleSetInput {
  return input.targetGroupId === DEFAULT_RULE_TARGET_GROUP_ID
    ? { ...input, targetGroupId: workspaceEntityId(workspaceId, DEFAULT_RULE_TARGET_GROUP_ID) }
    : input
}

export function validateRemoteRuleSetWrite(
  body: Partial<RemoteRuleSet>,
  options: { create: boolean }
): RemoteRuleSetWriteValidation {
  const booleanError = validateOptionalBooleanFields(body, ['enabled', 'sourceMissing'])
  if (booleanError) return { valid: false, error: booleanError }

  const name = normalizeOptionalText(body.name)
  if (options.create && !name) return { valid: false, error: 'name is required' }
  if (body.name !== undefined && !name) return { valid: false, error: 'name is required' }

  const url = body.url !== undefined ? normalizeHttpUrl(body.url) : undefined
  if (options.create && !url) return { valid: false, error: 'url is required' }
  if (body.url !== undefined && !url) return { valid: false, error: 'url must be a public http(s) URL' }

  if (options.create && !body.format) return { valid: false, error: 'format is required' }
  if (body.format !== undefined && !isRuleSetFormat(body.format)) {
    return { valid: false, error: 'invalid rule set format' }
  }

  if (options.create && !body.behavior) return { valid: false, error: 'behavior is required' }
  if (body.behavior !== undefined && !isValidRuleSetBehavior(body.behavior)) {
    return { valid: false, error: 'invalid rule set behavior' }
  }

  const sourceOverrides = body.sourceOverrides !== undefined
    ? normalizeSourceOverrides(body.sourceOverrides)
    : undefined
  if (sourceOverrides === null) {
    return { valid: false, error: 'sourceOverrides must contain public http(s) URLs for supported target clients' }
  }
  const sourceId = normalizeOptionalText(body.sourceId)
  const sourceRuleSetKey = normalizeOptionalText(body.sourceRuleSetKey)
  if (options.create && Boolean(sourceId) !== Boolean(sourceRuleSetKey)) {
    return { valid: false, error: 'sourceId and sourceRuleSetKey must be provided together' }
  }

  const targetGroupId = normalizeOptionalText(body.targetGroupId)
  if (!options.create && body.targetGroupId !== undefined && !targetGroupId) {
    return { valid: false, error: 'targetGroupId is required' }
  }
  const targetOverrideGroupId = body.targetOverrideGroupId === null
    ? null
    : normalizeOptionalText(body.targetOverrideGroupId)
  if (body.targetOverrideGroupId !== undefined && body.targetOverrideGroupId !== null && !targetOverrideGroupId) {
    return { valid: false, error: 'targetOverrideGroupId must be a group id or null' }
  }
  if (options.create && body.targetOverrideGroupId !== undefined) {
    return { valid: false, error: 'targetOverrideGroupId is not allowed when creating a rule set' }
  }

  const updateInterval = body.updateInterval !== undefined ? normalizePositiveInteger(body.updateInterval) : undefined
  if (body.updateInterval !== undefined && updateInterval === undefined) {
    return { valid: false, error: 'updateInterval must be a positive integer' }
  }
  const sortOrder = body.sortOrder !== undefined ? normalizeInteger(body.sortOrder) : undefined
  if (body.sortOrder !== undefined && sortOrder === undefined) {
    return { valid: false, error: 'sortOrder must be an integer' }
  }

  return {
    valid: true,
    name,
    url,
    format: body.format,
    behavior: body.behavior,
    sourceOverrides: options.create ? sourceOverrides ?? {} : sourceOverrides,
    sourceId: options.create ? sourceId : undefined,
    sourceRuleSetKey: options.create ? sourceRuleSetKey : undefined,
    targetGroupId: options.create ? targetGroupId ?? DEFAULT_RULE_TARGET_GROUP_ID : targetGroupId,
    targetOverrideGroupId: options.create ? undefined : targetOverrideGroupId,
    updateInterval: options.create ? updateInterval ?? 24 : updateInterval,
    enabled: options.create ? body.enabled !== false : body.enabled,
    sortOrder: options.create ? sortOrder ?? 500 : sortOrder,
    lastUpdated: body.lastUpdated !== undefined ? normalizeNullableText(body.lastUpdated) : undefined,
    notes: body.notes !== undefined ? normalizeNullableText(body.notes) : undefined,
  }
}

function normalizeSourceOverrides(value: unknown): RemoteRuleSetSourceOverrides | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length > FULL_CONFIG_EXPORT_FORMATS.length) return null
  const normalized: RemoteRuleSetSourceOverrides = {}
  for (const [target, rawUrl] of entries) {
    if (!isFullConfigExportFormat(target)) return null
    const url = normalizeHttpUrl(rawUrl)
    if (!url) return null
    normalized[target] = url
  }
  return normalized
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text || null
}

function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return isSafeRemoteHttpUrl(text) ? text : undefined
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue <= 0) return undefined
  return numberValue
}

function normalizeInteger(value: unknown): number | undefined {
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue)) return undefined
  return numberValue
}

export default app
