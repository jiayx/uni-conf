import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonStringify, mapGroup, newId, now } from '../db/helpers';
import type { ProxyGroup } from '@uni-conf/types';
import { listAutoCollectionKeysById, withOutletRefs } from '../services/routing-policy-groups';
import { FOUNDATION_POLICY_GROUP_NAMES, ROUTING_POLICY_TEMPLATES } from '@uni-conf/shared';
import { ensureZeroSetupDefaults } from '../services/zero-setup';

const app = new Hono<{ Bindings: Env }>();
const GROUP_TYPES = new Set<ProxyGroup['type']>(['select', 'url-test', 'fallback', 'load-balance', 'direct', 'reject']);
const BUILTIN_ONLY_GROUP_TYPES = new Set<ProxyGroup['type']>(['direct', 'reject']);
const BUILTIN_POLICIES = new Set(['DIRECT', 'REJECT']);
const BUILTIN_GROUP_NAMES = new Set<string>([
  ...FOUNDATION_POLICY_GROUP_NAMES,
  ...ROUTING_POLICY_TEMPLATES.flatMap((template) => template.groupNames),
].map((name) => name.toUpperCase()));

// ─── List groups ordered by sort_order ────────────────────────────────────────

app.get('/', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now());

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM groups ORDER BY sort_order ASC, created_at ASC'
  ).all<Record<string, unknown>>();
  const autoCollectionKeysById = await listAutoCollectionKeysById(c.env.DB);

  return c.json({ success: true, data: withOutletRefs(results, autoCollectionKeysById).map(mapGroup) });
});

// ─── Reorder groups ───────────────────────────────────────────────────────────

app.post('/reorder', async (c) => {
  const body = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(body.ids)) {
    return c.json({ success: false, error: 'ids array is required' }, 400);
  }

  const ts = now();
  const stmts = body.ids.map((id, index) =>
    c.env.DB.prepare('UPDATE groups SET sort_order = ?, updated_at = ? WHERE id = ? AND is_builtin = 0').bind(
      index,
      ts,
      id
    )
  );

  await c.env.DB.batch(stmts);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM groups ORDER BY sort_order ASC'
  ).all<Record<string, unknown>>();
  const autoCollectionKeysById = await listAutoCollectionKeysById(c.env.DB);

  return c.json({ success: true, data: withOutletRefs(results, autoCollectionKeysById).map(mapGroup) });
});

// ─── Create group (non-builtin only) ─────────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json<Partial<ProxyGroup>>();
  const validation = validateGroupWrite(body, { create: true, isBuiltin: false });
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  const id = newId();
  const ts = now();

  // Determine sort_order: max + 1
  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM groups'
  ).first<{ max_order: number | null }>();
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  await c.env.DB.prepare(
    `INSERT INTO groups (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      id,
      validation.name,
      validation.type,
      jsonStringify(validation.collectionIds ?? []),
      jsonStringify(validation.groupIds ?? []),
      jsonStringify(validation.builtins ?? []),
      validation.testUrl ?? null,
      validation.interval,
      validation.tolerance,
      validation.lazy ? 1 : 0,
      validation.enabled ? 1 : 0,
      sortOrder,
      ts,
      ts
    )
    .run();

  await ensureZeroSetupDefaults(c.env.DB, ts);

  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapGroup(row!) }, 201);
});

// ─── Get group ────────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now());

  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Group not found' }, 404);
  return c.json({ success: true, data: mapGroup(row) });
});

// ─── Update group ─────────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Group not found' }, 404);
  if (existing.is_builtin) {
    return c.json({ success: false, error: 'Built-in groups are managed by routing templates' }, 403);
  }

  const body = await c.req.json<Partial<ProxyGroup>>();
  const ts = now();
  const validation = validateGroupWrite(body, {
    create: false,
    id,
    isBuiltin: Boolean(existing.is_builtin),
  });
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE groups SET
      name = ?, type = ?, collection_ids = ?, group_ids = ?, builtins = ?,
      test_url = ?, interval = ?, tolerance = ?, lazy = ?,
      enabled = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      validation.name ?? existing.name,
      validation.type ?? existing.type,
      validation.collectionIds !== undefined
        ? jsonStringify(validation.collectionIds)
        : existing.collection_ids,
      validation.groupIds !== undefined ? jsonStringify(validation.groupIds) : existing.group_ids,
      validation.builtins !== undefined ? jsonStringify(validation.builtins) : existing.builtins,
      validation.testUrl !== undefined ? validation.testUrl : existing.test_url,
      validation.interval !== undefined ? validation.interval : existing.interval,
      validation.tolerance !== undefined ? validation.tolerance : existing.tolerance,
      validation.lazy !== undefined ? (validation.lazy ? 1 : 0) : existing.lazy,
      validation.enabled !== undefined ? (validation.enabled ? 1 : 0) : existing.enabled,
      ts,
      id
    )
    .run();

  await ensureZeroSetupDefaults(c.env.DB, ts);

  const updated = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapGroup(updated!) });
});

// ─── Delete group (block builtin) ─────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id, is_builtin FROM groups WHERE id = ?')
    .bind(id)
    .first<{ id: string; is_builtin: number }>();

  if (!row) return c.json({ success: false, error: 'Group not found' }, 404);
  if (row.is_builtin) {
    return c.json({ success: false, error: 'Cannot delete built-in group' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
  await ensureZeroSetupDefaults(c.env.DB, now());
  return c.json({ success: true, data: { id } });
});

export default app;

type GroupWriteValidation =
  | {
      valid: true;
      name?: string;
      type?: ProxyGroup['type'];
      collectionIds?: string[];
      groupIds?: string[];
      builtins?: ProxyGroup['builtins'];
      testUrl?: string | null;
      interval?: number;
      tolerance?: number;
      lazy?: boolean;
      enabled?: boolean;
    }
  | { valid: false; error: string };

export function validateGroupWrite(
  body: Partial<ProxyGroup>,
  options: { create: boolean; id?: string; isBuiltin: boolean }
): GroupWriteValidation {
  const name = normalizeOptionalText(body.name);
  if (options.create && !name) return { valid: false, error: 'name is required' };
  if (body.name !== undefined && !name) return { valid: false, error: 'name is required' };
  if (!options.isBuiltin && name && BUILTIN_GROUP_NAMES.has(name.toUpperCase())) {
    return { valid: false, error: 'custom group name conflicts with a built-in policy group' };
  }

  const type = body.type;
  if (options.create && !type) return { valid: false, error: 'type is required' };
  if (type !== undefined && !isValidGroupType(type)) return { valid: false, error: 'invalid group type' };
  if (!options.isBuiltin && type !== undefined && BUILTIN_ONLY_GROUP_TYPES.has(type)) {
    return { valid: false, error: 'DIRECT and REJECT are built-in foundation outlets' };
  }

  const collectionIds = normalizeIdList(body.collectionIds, 'collectionIds');
  if (!collectionIds.valid) return collectionIds;
  const groupIds = normalizeIdList(body.groupIds, 'groupIds');
  if (!groupIds.valid) return groupIds;
  if (options.id && groupIds.value?.includes(options.id)) {
    return { valid: false, error: 'groupIds cannot include the group itself' };
  }

  const builtins = normalizeBuiltins(body.builtins);
  if (!builtins.valid) return builtins;
  const interval = normalizePositiveNumber(body.interval, 'interval');
  if (!interval.valid) return interval;
  const tolerance = normalizeNonNegativeNumber(body.tolerance, 'tolerance');
  if (!tolerance.valid) return tolerance;

  return {
    valid: true,
    name,
    type,
    collectionIds: collectionIds.value,
    groupIds: groupIds.value,
    builtins: builtins.value,
    testUrl: body.testUrl !== undefined ? normalizeOptionalText(body.testUrl) ?? null : undefined,
    interval: options.create ? interval.value ?? 300 : interval.value,
    tolerance: options.create ? tolerance.value ?? 150 : tolerance.value,
    lazy: options.create ? body.lazy !== false : body.lazy,
    enabled: options.create ? body.enabled !== false : body.enabled,
  };
}

function isValidGroupType(value: unknown): value is ProxyGroup['type'] {
  return GROUP_TYPES.has(value as ProxyGroup['type']);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

type IdListValidation = { valid: true; value?: string[] } | { valid: false; error: string };

function normalizeIdList(value: unknown, field: string): IdListValidation {
  if (value === undefined) return { valid: true };
  if (!Array.isArray(value)) return { valid: false, error: `${field} must be an array` };
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      return { valid: false, error: `${field} must only contain non-empty strings` };
    }
    ids.push(item.trim());
  }
  return { valid: true, value: [...new Set(ids)] };
}

type BuiltinsValidation = { valid: true; value?: ProxyGroup['builtins'] } | { valid: false; error: string };

function normalizeBuiltins(value: unknown): BuiltinsValidation {
  if (value === undefined) return { valid: true };
  if (!Array.isArray(value)) return { valid: false, error: 'builtins must be an array' };
  const builtins: ProxyGroup['builtins'] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !BUILTIN_POLICIES.has(item)) {
      return { valid: false, error: 'builtins must only contain DIRECT or REJECT' };
    }
    builtins.push(item as ProxyGroup['builtins'][number]);
  }
  return { valid: true, value: [...new Set(builtins)] as ProxyGroup['builtins'] };
}

type NumberValidation = { valid: true; value?: number } | { valid: false; error: string };

function normalizePositiveNumber(value: unknown, field: string): NumberValidation {
  if (value === undefined) return { valid: true };
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return { valid: false, error: `${field} must be a positive number` };
  }
  return { valid: true, value: numberValue };
}

function normalizeNonNegativeNumber(value: unknown, field: string): NumberValidation {
  if (value === undefined) return { valid: true };
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return { valid: false, error: `${field} must be a non-negative number` };
  }
  return { valid: true, value: numberValue };
}
