import { Hono } from 'hono'
import type { Env } from '../types'
import { mapRemoteRuleSet, newId, now } from '../db/helpers'
import type { RemoteRuleSet, RuleSetBehavior, RuleSetFormat } from '@uni-conf/types'
import { DEFAULT_RULE_TARGET_GROUP_ID, isEnabledTargetGroup, listEnabledTargetGroupIds } from '../services/group-targets'
import { ensureZeroSetupDefaults } from '../services/zero-setup'

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now())

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM remote_rule_sets ORDER BY sort_order ASC, created_at ASC'
  ).all<Record<string, unknown>>()

  return c.json({ success: true, data: results.map(mapRemoteRuleSet) })
})

app.post('/', async (c) => {
  const body = await c.req.json<Partial<RemoteRuleSet>>()
  const validation = validateRemoteRuleSetWrite(body, { create: true })
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400)
  }
  const createInput = requireCreateRemoteRuleSet(validation)
  const ts = now()
  await ensureZeroSetupDefaults(c.env.DB, ts)
  if (!(await isEnabledTargetGroup(c.env.DB, createInput.targetGroupId))) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400)
  }

  const id = newId()
  await c.env.DB.prepare(
    `INSERT INTO remote_rule_sets
      (id, name, url, format, behavior, preset_source, preset_id, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      createInput.name,
      createInput.url,
      createInput.format,
      createInput.behavior,
      null,
      null,
      createInput.targetGroupId,
      createInput.updateInterval,
      createInput.enabled ? 1 : 0,
      createInput.sortOrder,
      createInput.lastUpdated ?? null,
      createInput.notes ?? null,
      ts,
      ts
    )
    .run()

  const row = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  return c.json({ success: true, data: mapRemoteRuleSet(row!) }, 201)
})

app.post('/batch', async (c) => {
  const body = await c.req.json<{ sets?: Array<Partial<RemoteRuleSet>> }>()
  const sets = body.sets ?? []
  if (!Array.isArray(sets) || sets.length === 0) {
    return c.json({ success: false, error: 'sets are required' }, 400)
  }

  const ts = now()
  const createdIds: string[] = []
  await ensureZeroSetupDefaults(c.env.DB, ts)
  const enabledTargetGroupIds = await listEnabledTargetGroupIds(c.env.DB)

  for (const [index, set] of sets.entries()) {
    const validation = validateRemoteRuleSetWrite(set, { create: true })
    if (!validation.valid) {
      return c.json({ success: false, error: `invalid remote rule set at index ${index}: ${validation.error}` }, 400)
    }
    const createInput = requireCreateRemoteRuleSet(validation)
    if (!enabledTargetGroupIds.has(createInput.targetGroupId)) {
      return c.json({ success: false, error: `target group is disabled or missing: ${createInput.targetGroupId}` }, 400)
    }
    const id = newId()
    createdIds.push(id)
    await c.env.DB.prepare(
      `INSERT INTO remote_rule_sets
        (id, name, url, format, behavior, preset_source, preset_id, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        createInput.name,
        createInput.url,
        createInput.format,
        createInput.behavior,
        null,
        null,
        createInput.targetGroupId,
        createInput.updateInterval,
        createInput.enabled ? 1 : 0,
        createInput.sortOrder,
        createInput.lastUpdated ?? null,
        createInput.notes ?? null,
        ts,
        ts
      )
      .run()
  }

  if (createdIds.length === 0) {
    return c.json({ success: false, error: 'No valid remote rule sets to create' }, 400)
  }

  const placeholders = createdIds.map(() => '?').join(',')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM remote_rule_sets WHERE id IN (${placeholders}) ORDER BY sort_order ASC, created_at ASC`
  )
    .bind(...createdIds)
    .all<Record<string, unknown>>()

  return c.json({ success: true, data: results.map(mapRemoteRuleSet) }, 201)
})

app.get('/:id', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now())

  const row = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>()

  if (!row) return c.json({ success: false, error: 'Remote rule set not found' }, 404)
  return c.json({ success: true, data: mapRemoteRuleSet(row) })
})

app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  if (!existing) return c.json({ success: false, error: 'Remote rule set not found' }, 404)

  const body = await c.req.json<Partial<RemoteRuleSet>>()
  const ts = now()
  await ensureZeroSetupDefaults(c.env.DB, ts)
  if (isManagedRemoteRuleSet(existing) && !isManagedRemoteRuleSetUpdate(body)) {
    return c.json({ success: false, error: 'built-in remote rule sets can only be enabled or disabled' }, 400)
  }
  const validation = validateRemoteRuleSetWrite(body, { create: false })
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400)
  }
  if (validation.targetGroupId !== undefined && !(await isEnabledTargetGroup(c.env.DB, validation.targetGroupId))) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400)
  }
  await c.env.DB.prepare(
    `UPDATE remote_rule_sets SET
      name = ?, url = ?, format = ?, behavior = ?, preset_source = ?, preset_id = ?, target_group_id = ?, update_interval = ?,
      enabled = ?, sort_order = ?, last_updated = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      validation.name ?? existing.name,
      validation.url ?? existing.url,
      validation.format ?? existing.format,
      validation.behavior ?? existing.behavior,
      existing.preset_source,
      existing.preset_id,
      validation.targetGroupId ?? existing.target_group_id,
      validation.updateInterval ?? existing.update_interval,
      validation.enabled !== undefined ? (validation.enabled ? 1 : 0) : existing.enabled,
      validation.sortOrder ?? existing.sort_order ?? 500,
      validation.lastUpdated !== undefined ? validation.lastUpdated : existing.last_updated,
      validation.notes !== undefined ? validation.notes : existing.notes,
      ts,
      id
    )
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  return c.json({ success: true, data: mapRemoteRuleSet(updated!) })
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id, preset_source, preset_id FROM remote_rule_sets WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  if (!row) return c.json({ success: false, error: 'Remote rule set not found' }, 404)
  if (isManagedRemoteRuleSet(row)) {
    return c.json({ success: false, error: 'built-in remote rule sets can be disabled but not deleted' }, 400)
  }

  await c.env.DB.prepare('DELETE FROM remote_rule_sets WHERE id = ?').bind(id).run()
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
  return keys.length === 1 && keys[0] === 'enabled'
}

const RULE_SET_FORMATS: ReadonlySet<RuleSetFormat> = new Set([
  'clash',
  'mihomo',
  'singbox',
  'surge',
  'loon',
  'shadowrocket',
  'quantumultx',
  'egern',
  'stash',
  'text',
])

const RULE_SET_BEHAVIORS: ReadonlySet<RuleSetBehavior> = new Set(['domain', 'ipcidr', 'classical'])

export function isValidRuleSetFormat(value: unknown): value is RuleSetFormat {
  return RULE_SET_FORMATS.has(value as RuleSetFormat)
}

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
      targetGroupId?: string
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

export function validateRemoteRuleSetWrite(
  body: Partial<RemoteRuleSet>,
  options: { create: boolean }
): RemoteRuleSetWriteValidation {
  const name = normalizeOptionalText(body.name)
  if (options.create && !name) return { valid: false, error: 'name is required' }
  if (body.name !== undefined && !name) return { valid: false, error: 'name is required' }

  const url = body.url !== undefined ? normalizeHttpUrl(body.url) : undefined
  if (options.create && !url) return { valid: false, error: 'url is required' }
  if (body.url !== undefined && !url) return { valid: false, error: 'url must be an http(s) URL' }

  if (options.create && !body.format) return { valid: false, error: 'format is required' }
  if (body.format !== undefined && !isValidRuleSetFormat(body.format)) {
    return { valid: false, error: 'invalid rule set format' }
  }

  if (options.create && !body.behavior) return { valid: false, error: 'behavior is required' }
  if (body.behavior !== undefined && !isValidRuleSetBehavior(body.behavior)) {
    return { valid: false, error: 'invalid rule set behavior' }
  }

  const targetGroupId = normalizeOptionalText(body.targetGroupId)
  if (!options.create && body.targetGroupId !== undefined && !targetGroupId) {
    return { valid: false, error: 'targetGroupId is required' }
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
    targetGroupId: options.create ? targetGroupId ?? DEFAULT_RULE_TARGET_GROUP_ID : targetGroupId,
    updateInterval: options.create ? updateInterval ?? 24 : updateInterval,
    enabled: options.create ? body.enabled !== false : body.enabled,
    sortOrder: options.create ? sortOrder ?? 500 : sortOrder,
    lastUpdated: body.lastUpdated !== undefined ? normalizeNullableText(body.lastUpdated) : undefined,
    notes: body.notes !== undefined ? normalizeNullableText(body.notes) : undefined,
  }
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
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return text
  } catch {
    return undefined
  }
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
