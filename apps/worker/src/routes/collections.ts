import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonStringify, mapCollection, mapNode, newId, now } from '../db/helpers';
import type { NodeCollection, NodeFilter, NodeRename } from '@uni-conf/types';
import { AUTO_NODE_GROUP_PREFIX, DEFAULT_NODE_POOL_PREFIX } from '@uni-conf/shared';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import { enabledNodeRowsQuery } from '../services/enabled-node-rows';
import { applyCollectionTransforms } from '../services/collection-transforms';

const app = new Hono<{ Bindings: Env }>();
const FILTER_FIELDS = new Set<NodeFilter['field']>(['name', 'server', 'protocol', 'country', 'countryCode', 'tag', 'sourceId']);
const FILTER_OPERATORS = new Set<NodeFilter['operator']>(['contains', 'not_contains', 'regex', 'not_regex', 'equals', 'not_equals', 'in', 'not_in']);
const RENAME_TYPES = new Set<NodeRename['type']>(['replace', 'regex', 'prefix', 'suffix', 'strip_emoji', 'standardize_country', 'auto_number']);
const DEDUP_STRATEGIES = new Set<NodeCollection['dedup']>(['name', 'server_port', 'protocol_server_port', 'full_config']);
const SORT_STRATEGIES = new Set<NodeCollection['sort']>(['country', 'name', 'source', 'protocol', 'manual']);

// ─── List collections ─────────────────────────────────────────────────────────

app.get('/', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now());

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM collections ORDER BY created_at DESC'
  ).all<Record<string, unknown>>();

  return c.json({ success: true, data: results.map(mapCollection) });
});

// ─── Create collection ────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json<Partial<NodeCollection>>();
  const validation = validateCollectionWrite(body, { create: true });
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  const id = newId();
  const ts = now();

  await c.env.DB.prepare(
    `INSERT INTO collections (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      validation.name,
      jsonStringify(validation.sourceIds ?? []),
      jsonStringify(validation.nodeIds ?? []),
      jsonStringify(validation.filters ?? []),
      jsonStringify(validation.renames ?? []),
      validation.dedup,
      validation.sort,
      validation.sortCountryOrder ? jsonStringify(validation.sortCountryOrder) : null,
      validation.enabled ? 1 : 0,
      validation.notes ?? null,
      ts,
      ts
    )
    .run();

  await ensureZeroSetupDefaults(c.env.DB, ts);

  const row = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapCollection(row!) }, 201);
});

// ─── Get collection ───────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now());

  const row = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Collection not found' }, 404);
  return c.json({ success: true, data: mapCollection(row) });
});

// ─── Update collection ────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Collection not found' }, 404);
  if (isManagedNodeCollectionNotes(existing.notes)) {
    return c.json({ success: false, error: 'System node groups are managed automatically' }, 409);
  }

  const body = await c.req.json<Partial<NodeCollection>>();
  const validation = validateCollectionWrite(body, { create: false });
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }
  const ts = now();

  await c.env.DB.prepare(
    `UPDATE collections SET
      name = ?, source_ids = ?, node_ids = ?, filters = ?, renames = ?,
      dedup = ?, sort = ?, sort_country_order = ?, enabled = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      validation.name ?? existing.name,
      validation.sourceIds !== undefined ? jsonStringify(validation.sourceIds) : existing.source_ids,
      validation.nodeIds !== undefined ? jsonStringify(validation.nodeIds) : existing.node_ids,
      validation.filters !== undefined ? jsonStringify(validation.filters) : existing.filters,
      validation.renames !== undefined ? jsonStringify(validation.renames) : existing.renames,
      validation.dedup ?? existing.dedup,
      validation.sort ?? existing.sort,
      validation.sortCountryOrder !== undefined
        ? jsonStringify(validation.sortCountryOrder)
        : existing.sort_country_order,
      validation.enabled !== undefined ? (validation.enabled ? 1 : 0) : existing.enabled,
      validation.notes !== undefined ? validation.notes : existing.notes,
      ts,
      id
    )
    .run();

  await ensureZeroSetupDefaults(c.env.DB, ts);

  const updated = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapCollection(updated!) });
});

// ─── Delete collection ────────────────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id, notes FROM collections WHERE id = ?')
    .bind(id)
    .first<{ id: string; notes: string | null }>();

  if (!row) return c.json({ success: false, error: 'Collection not found' }, 404);
  if (isManagedNodeCollectionNotes(row.notes)) {
    return c.json({ success: false, error: 'System node groups are managed automatically' }, 409);
  }
  await c.env.DB.prepare('DELETE FROM collections WHERE id = ?').bind(id).run();
  await ensureZeroSetupDefaults(c.env.DB, now());
  return c.json({ success: true, data: { id } });
});

// ─── Preview filtered nodes for collection ────────────────────────────────────

app.get('/:id/preview', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now());

  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Collection not found' }, 404);
  const collection = mapCollection(row);

  // Fetch candidate nodes
  let nodeRows: Record<string, unknown>[];

  if (collection.nodeIds.length > 0) {
    // Explicit node selection
    const placeholders = collection.nodeIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      enabledNodeRowsQuery(`n.id IN (${placeholders})`)
    )
      .bind(...collection.nodeIds)
      .all<Record<string, unknown>>();
    nodeRows = results;
  } else if (collection.sourceIds.length > 0) {
    // Filter by source
    const placeholders = collection.sourceIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      enabledNodeRowsQuery(`n.source_id IN (${placeholders})`)
    )
      .bind(...collection.sourceIds)
      .all<Record<string, unknown>>();
    nodeRows = results;
  } else {
    // All enabled nodes
    const { results } = await c.env.DB.prepare(
      enabledNodeRowsQuery()
    ).all<Record<string, unknown>>();
    nodeRows = results;
  }

  const nodes = applyCollectionTransforms(nodeRows.map(mapNode), collection);

  return c.json({
    success: true,
    data: {
      collectionId: id,
      nodes,
      total: nodes.length,
    },
  });
});

type CollectionWriteValidation =
  | {
      valid: true;
      name?: string;
      sourceIds?: string[];
      nodeIds?: string[];
      filters?: NodeFilter[];
      renames?: NodeRename[];
      dedup?: NodeCollection['dedup'];
      sort?: NodeCollection['sort'];
      sortCountryOrder?: string[] | null;
      enabled?: boolean;
      notes?: string | null;
    }
  | { valid: false; error: string };

export function validateCollectionWrite(
  body: Partial<NodeCollection>,
  options: { create: boolean }
): CollectionWriteValidation {
  const name = normalizeOptionalText(body.name);
  if (options.create && !name) return { valid: false, error: 'name is required' };
  if (body.name !== undefined && !name) return { valid: false, error: 'name is required' };

  const sourceIds = normalizeIdList(body.sourceIds, 'sourceIds');
  if (!sourceIds.valid) return sourceIds;
  const nodeIds = normalizeIdList(body.nodeIds, 'nodeIds');
  if (!nodeIds.valid) return nodeIds;
  const sortCountryOrder = normalizeIdList(body.sortCountryOrder, 'sortCountryOrder');
  if (!sortCountryOrder.valid) return sortCountryOrder;

  const filters = normalizeFilters(body.filters);
  if (!filters.valid) return filters;
  const renames = normalizeRenames(body.renames);
  if (!renames.valid) return renames;

  if (body.dedup !== undefined && !DEDUP_STRATEGIES.has(body.dedup)) {
    return { valid: false, error: 'invalid dedup strategy' };
  }
  if (body.sort !== undefined && !SORT_STRATEGIES.has(body.sort)) {
    return { valid: false, error: 'invalid sort strategy' };
  }
  if (body.notes !== undefined && isManagedNodeCollectionNotes(body.notes)) {
    return { valid: false, error: 'system node group marker is reserved' };
  }

  return {
    valid: true,
    name,
    sourceIds: sourceIds.value,
    nodeIds: nodeIds.value,
    filters: filters.value,
    renames: renames.value,
    dedup: options.create ? body.dedup ?? 'name' : body.dedup,
    sort: options.create ? body.sort ?? 'country' : body.sort,
    sortCountryOrder: body.sortCountryOrder !== undefined ? sortCountryOrder.value ?? [] : undefined,
    enabled: options.create ? body.enabled !== false : body.enabled,
    notes: body.notes !== undefined ? normalizeOptionalText(body.notes) ?? null : undefined,
  };
}

export function isManagedAutoNodeCollectionNotes(value: unknown): boolean {
  return typeof value === 'string' && value.trim().startsWith(AUTO_NODE_GROUP_PREFIX);
}

export function isManagedNodeCollectionNotes(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.startsWith(AUTO_NODE_GROUP_PREFIX) || text.startsWith(DEFAULT_NODE_POOL_PREFIX);
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

type FiltersValidation = { valid: true; value?: NodeFilter[] } | { valid: false; error: string };

function normalizeFilters(value: unknown): FiltersValidation {
  if (value === undefined) return { valid: true };
  if (!Array.isArray(value)) return { valid: false, error: 'filters must be an array' };

  const filters: NodeFilter[] = [];
  for (const [index, filter] of value.entries()) {
    if (!filter || typeof filter !== 'object') return { valid: false, error: `invalid filter at index ${index}` };
    const item = filter as Partial<NodeFilter>;
    const id = normalizeOptionalText(item.id) ?? `filter-${index}`;
    if (!FILTER_FIELDS.has(item.field as NodeFilter['field'])) {
      return { valid: false, error: `invalid filter field at index ${index}` };
    }
    if (!FILTER_OPERATORS.has(item.operator as NodeFilter['operator'])) {
      return { valid: false, error: `invalid filter operator at index ${index}` };
    }
    const filterValue = normalizeFilterValue(item.value, item.operator as NodeFilter['operator']);
    if (!filterValue.valid) return { valid: false, error: `${filterValue.error} at index ${index}` };
    if ((item.operator === 'regex' || item.operator === 'not_regex') && !isValidRegex(firstValue(filterValue.value))) {
      return { valid: false, error: `invalid filter regex at index ${index}` };
    }
    filters.push({
      id,
      field: item.field as NodeFilter['field'],
      operator: item.operator as NodeFilter['operator'],
      value: filterValue.value,
      enabled: item.enabled !== false,
    });
  }
  return { valid: true, value: filters };
}

type FilterValueValidation = { valid: true; value: string | string[] } | { valid: false; error: string };

function normalizeFilterValue(value: unknown, operator: NodeFilter['operator']): FilterValueValidation {
  const listOperator = operator === 'in' || operator === 'not_in';
  if (Array.isArray(value)) {
    const items = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
    if (items.length === 0) return { valid: false, error: 'filter value is required' };
    return { valid: true, value: listOperator ? [...new Set(items)] : items[0]! };
  }
  if (typeof value !== 'string' || value.trim() === '') return { valid: false, error: 'filter value is required' };
  if (!listOperator) return { valid: true, value: value.trim() };
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) return { valid: false, error: 'filter value is required' };
  return { valid: true, value: [...new Set(items)] };
}

type RenamesValidation = { valid: true; value?: NodeRename[] } | { valid: false; error: string };

function normalizeRenames(value: unknown): RenamesValidation {
  if (value === undefined) return { valid: true };
  if (!Array.isArray(value)) return { valid: false, error: 'renames must be an array' };

  const renames: NodeRename[] = [];
  for (const [index, rename] of value.entries()) {
    if (!rename || typeof rename !== 'object') return { valid: false, error: `invalid rename at index ${index}` };
    const item = rename as Partial<NodeRename>;
    const type = item.type as NodeRename['type'];
    if (!RENAME_TYPES.has(type)) return { valid: false, error: `invalid rename type at index ${index}` };
    if ((type === 'replace' || type === 'regex') && !normalizeOptionalText(item.pattern)) {
      return { valid: false, error: `rename pattern is required at index ${index}` };
    }
    if (type === 'regex' && !isValidRegex(item.pattern ?? '')) {
      return { valid: false, error: `invalid rename regex at index ${index}` };
    }
    renames.push({
      id: normalizeOptionalText(item.id) ?? `rename-${index}`,
      type,
      pattern: normalizeOptionalText(item.pattern),
      replacement: item.replacement !== undefined ? String(item.replacement) : undefined,
      enabled: item.enabled !== false,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    });
  }
  return { valid: true, value: renames };
}

function firstValue(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value;
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export default app;
