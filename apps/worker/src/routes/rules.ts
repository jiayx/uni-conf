import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonStringify, mapRule, newId, now } from '../db/helpers';
import type { ProxyRule } from '@uni-conf/types';
import {
  getRuleCompatibilityForPayload,
  MAX_RULE_BATCH_SELECTION,
  RULE_COMPATIBILITY,
  validateAndNormalizeRulePayload,
} from '@uni-conf/shared';
import { isEnabledTargetGroup, listEnabledTargetGroupIds, normalizeRuleTargetGroupId } from '../services/group-targets';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import { validateOptionalBooleanFields } from '../services/request-validation';
import { requestWorkspaceId } from '../services/workspaces';

const app = new Hono<{ Bindings: Env }>();
const RULE_BATCH_SQL_CHUNK_SIZE = 90;

// ─── List rules ───────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM rules WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(workspaceId).all<Record<string, unknown>>();

  return c.json({ success: true, data: results.map(mapRule) });
});

// ─── Reorder rules ────────────────────────────────────────────────────────────

app.post('/reorder', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const validation = validateRuleReorderInput(await c.req.json<unknown>());
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  const { results: currentRows } = await c.env.DB.prepare(
    'SELECT id FROM rules WHERE workspace_id = ?'
  ).bind(workspaceId).all<{ id: string }>();
  const currentIds = new Set(currentRows.map(row => row.id));
  if (
    validation.ids.length !== currentRows.length
    || validation.ids.some(id => !currentIds.has(id))
  ) {
    return c.json({
      success: false,
      error: 'ids must be an exact permutation of all current rule ids',
    }, 409);
  }

  if (validation.ids.length === 0) {
    return c.json({ success: true, data: [] });
  }

  const ts = now();
  const stmts = validation.ids.map((id, index) =>
    c.env.DB.prepare(
      'UPDATE rules SET sort_order = ?, updated_at = ? WHERE id = ? AND workspace_id = ?'
    ).bind(index, ts, id, workspaceId)
  );

  await c.env.DB.batch(stmts);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM rules WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).bind(workspaceId).all<Record<string, unknown>>();

  return c.json({ success: true, data: results.map(mapRule) });
});

// ─── Batch create rules ───────────────────────────────────────────────────────

app.post('/batch', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const validation = validateRuleBatchCreateInput(await c.req.json<unknown>());
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  for (const [index, rule] of validation.rules.entries()) {
    const error = validateRuleInput(rule);
    if (error) {
      return c.json({ success: false, error: `invalid rule at index ${index}: ${error}` }, 400);
    }
  }

  const ts = now();
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM rules WHERE workspace_id = ?'
  ).bind(workspaceId).first<{ max_order: number | null }>();
  let nextOrder = (maxRow?.max_order ?? -1) + 1;
  const enabledTargetGroupIds = await listEnabledTargetGroupIds(c.env.DB, workspaceId);
  const prepared: Array<{
    id: string;
    rule: Partial<ProxyRule> & Pick<ProxyRule, 'type'>;
    targetGroupId: string;
    sortOrder: number;
    compatibility: ProxyRule['compatibility'];
  }> = [];

  for (const rule of validation.rules) {
    const targetGroupId = normalizeRuleTargetGroupId(rule.targetGroupId, workspaceId);
    if (!enabledTargetGroupIds.has(targetGroupId)) {
      return c.json({ success: false, error: `target group is disabled or missing: ${targetGroupId}` }, 400);
    }
    const normalizedPayload = validateAndNormalizeRulePayload(rule.type!, rule.payload);
    if (!normalizedPayload.valid) {
      return c.json({ success: false, error: normalizedPayload.message }, 400);
    }
    prepared.push({
      id: newId(),
      rule: {
        ...rule,
        payload: normalizedPayload.payload,
      } as Partial<ProxyRule> & Pick<ProxyRule, 'type'>,
      targetGroupId,
      sortOrder: typeof rule.order === 'number' ? rule.order : nextOrder,
      compatibility: getRuleCompatibilityForPayload(rule.type!, normalizedPayload.payload),
    });
    nextOrder++;
  }

  const statements = prepared.map(({ id, rule, targetGroupId, sortOrder, compatibility }) =>
    c.env.DB.prepare(
      `INSERT INTO rules (id, name, type, payload, no_resolve, target_group_id, enabled, sort_order, notes, compatibility, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        normalizeNullableRuleText(rule.name),
        rule.type,
        rule.payload ?? '',
        rule.noResolve ? 1 : 0,
        targetGroupId,
        rule.enabled !== false ? 1 : 0,
        sortOrder,
        normalizeNullableRuleText(rule.notes),
        jsonStringify(compatibility),
        ts,
        ts,
        workspaceId
      )
  );
  await c.env.DB.batch(statements);

  const created: ProxyRule[] = prepared.map(({ id, rule, targetGroupId, sortOrder, compatibility }) => ({
    id,
    ...(normalizeNullableRuleText(rule.name) ? { name: normalizeNullableRuleText(rule.name)! } : {}),
    type: rule.type,
    payload: rule.payload ?? '',
    noResolve: Boolean(rule.noResolve),
    targetGroupId,
    enabled: rule.enabled !== false,
    order: sortOrder,
    ...(normalizeNullableRuleText(rule.notes) ? { notes: normalizeNullableRuleText(rule.notes)! } : {}),
    compatibility,
    createdAt: ts,
    updatedAt: ts,
  }));

  return c.json({ success: true, data: created }, 201);
});

// ─── Batch enable / disable rules ─────────────────────────────────────────────

app.put('/batch-enabled', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const validation = validateRuleBatchEnabledInput(await c.req.json<unknown>());
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  const existingIds = new Set<string>();
  for (const ids of chunkValues(validation.ids, RULE_BATCH_SQL_CHUNK_SIZE)) {
    const placeholders = ids.map(() => '?').join(', ');
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM rules WHERE workspace_id = ? AND id IN (${placeholders})`
    )
      .bind(workspaceId, ...ids)
      .all<{ id: string }>();
    for (const row of results) existingIds.add(row.id);
  }
  const missingIds = validation.ids.filter(id => !existingIds.has(id));
  if (missingIds.length > 0) {
    return c.json({
      success: false,
      error: `rules not found: ${missingIds.slice(0, 10).join(', ')}`,
    }, 404);
  }

  const ts = now();
  const statements = chunkValues(validation.ids, RULE_BATCH_SQL_CHUNK_SIZE).map(ids => {
    const placeholders = ids.map(() => '?').join(', ');
    return c.env.DB.prepare(
      `UPDATE rules SET enabled = ?, updated_at = ? WHERE workspace_id = ? AND id IN (${placeholders})`
    ).bind(validation.enabled ? 1 : 0, ts, workspaceId, ...ids);
  });
  await c.env.DB.batch(statements);
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);

  return c.json({
    success: true,
    data: {
      ids: validation.ids,
      enabled: validation.enabled,
      updatedCount: validation.ids.length,
    },
  });
});

// ─── Create rule ──────────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const body = await c.req.json<Partial<ProxyRule>>();
  const error = validateRuleInput(body);
  if (error) {
    return c.json({ success: false, error }, 400);
  }
  const ruleType = body.type as ProxyRule['type'];
  const targetGroupId = normalizeRuleTargetGroupId(body.targetGroupId, workspaceId);
  const normalizedPayload = validateAndNormalizeRulePayload(ruleType, body.payload);
  if (!normalizedPayload.valid) {
    return c.json({ success: false, error: normalizedPayload.message }, 400);
  }
  const payload = normalizedPayload.payload;
  const ts = now();
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);
  if (!(await isEnabledTargetGroup(c.env.DB, targetGroupId, workspaceId))) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400);
  }

  const id = newId();

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM rules WHERE workspace_id = ?'
  ).bind(workspaceId).first<{ max_order: number | null }>();
  const sortOrder = body.order ?? (maxRow?.max_order ?? -1) + 1;

  await c.env.DB.prepare(
    `INSERT INTO rules (id, name, type, payload, no_resolve, target_group_id, enabled, sort_order, notes, compatibility, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.name ?? null,
      ruleType,
      payload,
      body.noResolve ? 1 : 0,
      targetGroupId,
      body.enabled !== false ? 1 : 0,
      sortOrder,
      body.notes ?? null,
      jsonStringify(getRuleCompatibilityForPayload(ruleType, payload)),
      ts,
      ts,
      workspaceId
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapRule(row!) }, 201);
});

// ─── Get rule ─────────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const row = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ? AND workspace_id = ?')
    .bind(c.req.param('id'), workspaceId)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Rule not found' }, 404);
  return c.json({ success: true, data: mapRule(row) });
});

// ─── Update rule ──────────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Rule not found' }, 404);

  const body = await c.req.json<Partial<ProxyRule>>();
  const booleanError = validateOptionalBooleanFields(body, ['noResolve', 'enabled']);
  if (booleanError) return c.json({ success: false, error: booleanError }, 400);
  const ts = now();
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);
  const nextType = (body.type ?? existing.type) as ProxyRule['type'];
  const nextPayload = (body.payload ?? existing.payload) as string;
  if (!isValidRuleType(nextType)) {
    return c.json({ success: false, error: 'invalid rule type' }, 400);
  }
  const normalizedPayload = validateAndNormalizeRulePayload(nextType, nextPayload);
  if (!normalizedPayload.valid) {
    return c.json({ success: false, error: normalizedPayload.message }, 400);
  }
  if (body.targetGroupId !== undefined && !isNonEmptyString(body.targetGroupId)) {
    return c.json({ success: false, error: 'targetGroupId is required' }, 400);
  }
  if (body.targetGroupId !== undefined && !(await isEnabledTargetGroup(c.env.DB, body.targetGroupId, workspaceId))) {
    return c.json({ success: false, error: 'target group is disabled or missing' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE rules SET
      name = ?, type = ?, payload = ?, no_resolve = ?,
      target_group_id = ?, enabled = ?, sort_order = ?,
      notes = ?, compatibility = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`
  )
    .bind(
      body.name !== undefined ? normalizeNullableRuleText(body.name) : existing.name,
      body.type ?? existing.type,
      normalizedPayload.payload,
      body.noResolve !== undefined ? (body.noResolve ? 1 : 0) : existing.no_resolve,
      body.targetGroupId ?? existing.target_group_id,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      body.order !== undefined ? body.order : existing.sort_order,
      body.notes !== undefined ? normalizeNullableRuleText(body.notes) : existing.notes,
      jsonStringify(getRuleCompatibilityForPayload(nextType, normalizedPayload.payload)),
      ts,
      id,
      workspaceId
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapRule(updated!) });
});

// ─── Delete rule ──────────────────────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM rules WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).first();

  if (!row) return c.json({ success: false, error: 'Rule not found' }, 404);
  await c.env.DB.prepare('DELETE FROM rules WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).run();
  await ensureZeroSetupDefaults(c.env.DB, now(), workspaceId);
  return c.json({ success: true, data: { id } });
});

export default app;

const RULE_TYPES: ReadonlySet<ProxyRule['type']> = new Set(
  (Object.keys(RULE_COMPATIBILITY) as ProxyRule['type'][]).filter(type => type !== 'MATCH')
);

export function isValidRuleType(value: unknown): value is ProxyRule['type'] {
  return RULE_TYPES.has(value as ProxyRule['type']);
}

export function validateRuleInput(rule: Partial<ProxyRule>): string | null {
  const booleanError = validateOptionalBooleanFields(rule, ['noResolve', 'enabled']);
  if (booleanError) return booleanError;
  if (!isValidRuleType(rule.type)) return 'invalid rule type';
  const validation = validateAndNormalizeRulePayload(rule.type, rule.payload);
  return validation.valid ? null : validation.message;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function normalizeNullableRuleText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

type RuleBatchEnabledValidation =
  | { valid: true; ids: string[]; enabled: boolean }
  | { valid: false; error: string };

type RuleReorderValidation =
  | { valid: true; ids: string[] }
  | { valid: false; error: string };

export function validateRuleReorderInput(value: unknown): RuleReorderValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: 'body must be an object' };
  }
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.ids)) {
    return { valid: false, error: 'ids array is required' };
  }
  const ids: string[] = [];
  for (const value of body.ids) {
    if (typeof value !== 'string' || !value.trim()) {
      return { valid: false, error: 'every rule id must be a non-empty string' };
    }
    ids.push(value.trim());
  }
  if (new Set(ids).size !== ids.length) {
    return { valid: false, error: 'rule ids must not contain duplicates' };
  }
  return { valid: true, ids };
}

type RuleBatchCreateValidation =
  | { valid: true; rules: Array<Partial<ProxyRule>> }
  | { valid: false; error: string };

export function validateRuleBatchCreateInput(value: unknown): RuleBatchCreateValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: 'body must be an object' };
  }
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.rules) || body.rules.length === 0 || body.rules.length > MAX_RULE_BATCH_SELECTION) {
    return {
      valid: false,
      error: `rules must contain between 1 and ${MAX_RULE_BATCH_SELECTION} items`,
    };
  }
  for (const [index, rule] of body.rules.entries()) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      return { valid: false, error: `rule at index ${index} must be an object` };
    }
  }
  return { valid: true, rules: body.rules as Array<Partial<ProxyRule>> };
}

export function validateRuleBatchEnabledInput(value: unknown): RuleBatchEnabledValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: 'body must be an object' };
  }
  const body = value as Record<string, unknown>;
  if (typeof body.enabled !== 'boolean') {
    return { valid: false, error: 'enabled must be a boolean' };
  }
  if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_RULE_BATCH_SELECTION) {
    return { valid: false, error: `ids must contain between 1 and ${MAX_RULE_BATCH_SELECTION} rule ids` };
  }
  const ids: string[] = [];
  for (const value of body.ids) {
    if (typeof value !== 'string' || !value.trim()) {
      return { valid: false, error: 'every rule id must be a non-empty string' };
    }
    ids.push(value.trim());
  }
  return { valid: true, ids: [...new Set(ids)], enabled: body.enabled };
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
