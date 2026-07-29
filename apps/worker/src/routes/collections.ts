import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonStringify, mapCollection, mapGroup, mapNode, newId, now } from '../db/helpers';
import type {
  NodeCollection,
  NodeCollectionSummary,
  NodeFilter,
  NodeRename,
  ProxyGroup,
  ProxyNode,
} from '@uni-conf/types';
import { AUTO_NODE_GROUP_PREFIX, DEFAULT_HEALTH_CHECK, DEFAULT_NODE_POOL_PREFIX } from '@uni-conf/shared';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import { enabledNodeRowsQuery } from '../services/enabled-node-rows';
import { applyCollectionTransforms } from '../services/collection-transforms';
import {
  findGroupDeleteBlockers,
  type GroupDeleteBlocker,
  validateGroupWrite,
} from './groups';
import { validateOptionalBooleanFields } from '../services/request-validation';
import { requestWorkspaceId } from '../services/workspaces';

const app = new Hono<{ Bindings: Env }>();
const FILTER_FIELDS = new Set<NodeFilter['field']>(['name', 'server', 'protocol', 'country', 'countryCode', 'tag', 'sourceId']);
const FILTER_OPERATORS = new Set<NodeFilter['operator']>(['contains', 'not_contains', 'regex', 'not_regex', 'equals', 'not_equals', 'in', 'not_in']);
const RENAME_TYPES = new Set<NodeRename['type']>(['replace', 'regex', 'prefix', 'suffix', 'strip_emoji', 'standardize_country', 'auto_number']);
const DEDUP_STRATEGIES = new Set<NodeCollection['dedup']>(['name', 'server_port', 'protocol_server_port', 'full_config']);
const SORT_STRATEGIES = new Set<NodeCollection['sort']>(['country', 'name', 'source', 'protocol', 'manual']);
const LINKED_GROUP_TYPES = new Set<ProxyGroup['type']>(['select', 'url-test', 'fallback']);

// ─── List collections ─────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM collections WHERE workspace_id = ? ORDER BY created_at DESC'
  ).bind(workspaceId).all<Record<string, unknown>>();
  const collections = results.map(mapCollection);
  const { results: nodeRows } = await c.env.DB.prepare(
    enabledNodeRowsQuery(undefined, workspaceId)
  ).all<Record<string, unknown>>();
  const nodes = nodeRows.map(mapNode);
  const summaries: NodeCollectionSummary[] = collections.map(collection => ({
    ...collection,
    nodeCount: countCollectionNodes(nodes, collection),
  }));

  return c.json({ success: true, data: summaries });
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
  const workspaceId = requestWorkspaceId(c);

  await c.env.DB.prepare(
    `INSERT INTO collections (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      ts,
      workspaceId
    )
    .run();

  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);

  const row = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapCollection(row!) }, 201);
});

// ─── Create a manual node group atomically ───────────────────────────────────

app.post('/with-group', async (c) => {
  const input = validateCollectionWithGroupInput(await c.req.json<unknown>());
  if (!input.valid) {
    return c.json({ success: false, error: input.error }, 400);
  }
  const collectionValidation = validateCollectionWrite(input.collection, { create: true });
  if (!collectionValidation.valid) {
    return c.json({ success: false, error: collectionValidation.error }, 400);
  }

  const collectionId = newId();
  const groupId = newId();
  const groupValidation = validateLinkedGroupWrite(
    collectionValidation.name!,
    collectionId,
    input.groupType,
    collectionValidation.enabled!,
    { create: true },
  );
  if (!groupValidation.valid) {
    return c.json({ success: false, error: groupValidation.error }, 400);
  }

  const ts = now();
  const workspaceId = requestWorkspaceId(c);
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);
  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM groups WHERE workspace_id = ?'
  ).bind(workspaceId).first<{ max_order: number | null }>();
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  await c.env.DB.batch([
    prepareCollectionInsert(c.env.DB, collectionId, collectionValidation, ts, workspaceId),
    c.env.DB.prepare(
      `INSERT INTO groups (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).bind(
      groupId,
      groupValidation.name,
      groupValidation.type,
      jsonStringify(groupValidation.collectionIds ?? []),
      jsonStringify(groupValidation.groupIds ?? []),
      jsonStringify(groupValidation.builtins ?? []),
      groupValidation.testUrl ?? null,
      groupValidation.interval,
      groupValidation.tolerance,
      groupValidation.lazy ? 1 : 0,
      groupValidation.enabled ? 1 : 0,
      sortOrder,
      ts,
      ts,
      workspaceId,
    ),
  ]);

  const [collectionRow, groupRow] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM collections WHERE id = ?').bind(collectionId).first<Record<string, unknown>>(),
    c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first<Record<string, unknown>>(),
  ]);

  return c.json({
    success: true,
    data: {
      collection: mapCollection(collectionRow!),
      group: mapGroup(groupRow!),
    },
  }, 201);
});

// ─── Get collection ───────────────────────────────────────────────────────────

app.get('/:id', async (c) => {

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
  const workspaceId = requestWorkspaceId(c);

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

  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);

  const updated = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapCollection(updated!) });
});

// ─── Update a manual node group atomically ───────────────────────────────────

app.put('/:id/with-group', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Collection not found' }, 404);
  if (isManagedNodeCollectionNotes(existing.notes)) {
    return c.json({ success: false, error: 'System node groups are managed automatically' }, 409);
  }

  const input = validateCollectionWithGroupInput(await c.req.json<unknown>());
  if (!input.valid) {
    return c.json({ success: false, error: input.error }, 400);
  }
  const collectionValidation = validateCollectionWrite(input.collection, { create: false });
  if (!collectionValidation.valid) {
    return c.json({ success: false, error: collectionValidation.error }, 400);
  }

  const effectiveName = collectionValidation.name ?? String(existing.name);
  const effectiveEnabled = collectionValidation.enabled ?? Boolean(existing.enabled);
  const linkedGroup = await findDedicatedLinkedGroup(c.env.DB, id);
  const groupId = linkedGroup ? String(linkedGroup.id) : newId();
  const groupValidation = validateLinkedGroupWrite(
    effectiveName,
    id,
    input.groupType,
    effectiveEnabled,
    { create: !linkedGroup, id: groupId },
  );
  if (!groupValidation.valid) {
    return c.json({ success: false, error: groupValidation.error }, 400);
  }

  const ts = now();
  const workspaceId = requestWorkspaceId(c);
  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);
  const statements = [
    prepareCollectionUpdate(c.env.DB, id, existing, collectionValidation, ts),
  ];

  if (linkedGroup) {
    statements.push(c.env.DB.prepare(
      `UPDATE groups SET name = ?, type = ?, collection_ids = ?, enabled = ?, updated_at = ?
       WHERE id = ? AND is_builtin = 0`
    ).bind(
      groupValidation.name,
      groupValidation.type,
      jsonStringify([id]),
      groupValidation.enabled ? 1 : 0,
      ts,
      groupId,
    ));
  } else {
    const maxRow = await c.env.DB.prepare(
      'SELECT MAX(sort_order) as max_order FROM groups WHERE workspace_id = ?'
    ).bind(workspaceId).first<{ max_order: number | null }>();
    const sortOrder = (maxRow?.max_order ?? -1) + 1;
    statements.push(c.env.DB.prepare(
      `INSERT INTO groups (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).bind(
      groupId,
      groupValidation.name,
      groupValidation.type,
      jsonStringify([id]),
      jsonStringify([]),
      jsonStringify([]),
      DEFAULT_HEALTH_CHECK.testUrl,
      DEFAULT_HEALTH_CHECK.interval,
      DEFAULT_HEALTH_CHECK.tolerance,
      DEFAULT_HEALTH_CHECK.lazy ? 1 : 0,
      groupValidation.enabled ? 1 : 0,
      sortOrder,
      ts,
      ts,
      workspaceId,
    ));
  }

  await c.env.DB.batch(statements);

  const [collectionRow, groupRow] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<Record<string, unknown>>(),
    c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(groupId).first<Record<string, unknown>>(),
  ]);
  return c.json({
    success: true,
    data: {
      collection: mapCollection(collectionRow!),
      group: mapGroup(groupRow!),
    },
  });
});

// ─── Delete collection ────────────────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const workspaceId = requestWorkspaceId(c);
  const row = await c.env.DB.prepare('SELECT id, notes FROM collections WHERE id = ?')
    .bind(id)
    .first<{ id: string; notes: string | null }>();

  if (!row) return c.json({ success: false, error: 'Collection not found' }, 404);
  if (isManagedNodeCollectionNotes(row.notes)) {
    return c.json({ success: false, error: 'System node groups are managed automatically' }, 409);
  }
  const [groupRows, exportRows] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, is_builtin, collection_ids FROM groups WHERE workspace_id = ?')
      .bind(workspaceId).all<{
      id: string;
      name: string;
      is_builtin: number;
      collection_ids: string | null;
    }>(),
    c.env.DB.prepare('SELECT id, name, include_collection_ids FROM export_configs WHERE workspace_id = ?')
      .bind(workspaceId).all<{
      id: string;
      name: string;
      include_collection_ids: string | null;
    }>(),
  ]);
  const referencingGroups = groupRows.results.filter(group => parseStoredIdList(group.collection_ids).includes(id));
  const nonDedicatedGroups = referencingGroups.filter(group => (
    Boolean(group.is_builtin) || parseStoredIdList(group.collection_ids).length !== 1
  ));
  const blockers: GroupDeleteBlocker[] = nonDedicatedGroups.map(group => ({
    error: `node group is referenced by policy group: ${group.name || group.id}`,
    dependency: {
      type: 'policy-group',
      id: group.id,
      name: group.name || group.id,
    },
    remediation: { target: 'groups', id: group.id },
  }));
  const scopedExportConfigs = exportRows.results.filter(
    config => parseStoredIdList(config.include_collection_ids).includes(id)
  );
  for (const exportConfig of scopedExportConfigs) {
    blockers.push({
      error: `node group is included by export profile: ${exportConfig.name || exportConfig.id}`,
      dependency: {
        type: 'export-profile',
        id: exportConfig.id,
        name: exportConfig.name || exportConfig.id,
      },
      remediation: { target: 'export', id: exportConfig.id },
    });
  }
  const dedicatedGroups = referencingGroups.filter(group => !nonDedicatedGroups.includes(group));
  for (const group of dedicatedGroups) {
    const groupBlockers = await findGroupDeleteBlockers(c.env.DB, group.id, workspaceId);
    blockers.push(...groupBlockers.map(blocker => ({
      ...blocker,
      error: `linked policy group cannot be deleted: ${blocker.error}`,
    })));
  }
  if (blockers.length > 0) {
    return c.json({
      success: false,
      error: blockers[0]!.error,
      code: 'resource_in_use',
      details: {
        dependencies: blockers.map(blocker => ({
          ...blocker.dependency,
          remediation: blocker.remediation,
        })),
      },
    }, 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      'DELETE FROM groups WHERE workspace_id = ? AND is_builtin = 0 AND collection_ids = ?'
    ).bind(workspaceId, jsonStringify([id])),
    c.env.DB.prepare('DELETE FROM collections WHERE id = ? AND workspace_id = ?').bind(id, workspaceId),
  ]);
  await ensureZeroSetupDefaults(c.env.DB, now(), workspaceId);
  return c.json({ success: true, data: { id } });
});

// ─── Preview filtered nodes for collection ────────────────────────────────────

app.get('/:id/preview', async (c) => {
  const workspaceId = requestWorkspaceId(c);
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
      enabledNodeRowsQuery(`n.id IN (${placeholders})`, workspaceId)
    )
      .bind(...collection.nodeIds)
      .all<Record<string, unknown>>();
    nodeRows = results;
  } else if (collection.sourceIds.length > 0) {
    // Filter by source
    const placeholders = collection.sourceIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      enabledNodeRowsQuery(`n.source_id IN (${placeholders})`, workspaceId)
    )
      .bind(...collection.sourceIds)
      .all<Record<string, unknown>>();
    nodeRows = results;
  } else {
    // All enabled nodes
    const { results } = await c.env.DB.prepare(
      enabledNodeRowsQuery(undefined, workspaceId)
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

type CollectionWithGroupInputValidation =
  | {
      valid: true;
      collection: Partial<NodeCollection>;
      groupType: Extract<ProxyGroup['type'], 'select' | 'url-test' | 'fallback'>;
    }
  | { valid: false; error: string };

export function validateCollectionWithGroupInput(value: unknown): CollectionWithGroupInputValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: 'body must be an object' };
  }
  const body = value as Record<string, unknown>;
  if (!body.collection || typeof body.collection !== 'object' || Array.isArray(body.collection)) {
    return { valid: false, error: 'collection must be an object' };
  }
  if (!LINKED_GROUP_TYPES.has(body.groupType as ProxyGroup['type'])) {
    return { valid: false, error: 'groupType must be select, url-test, or fallback' };
  }
  return {
    valid: true,
    collection: body.collection as Partial<NodeCollection>,
    groupType: body.groupType as Extract<ProxyGroup['type'], 'select' | 'url-test' | 'fallback'>,
  };
}

export function validateCollectionWrite(
  body: Partial<NodeCollection>,
  options: { create: boolean }
): CollectionWriteValidation {
  const booleanError = validateOptionalBooleanFields(body, ['enabled']);
  if (booleanError) return { valid: false, error: booleanError };

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

function validateLinkedGroupWrite(
  name: string,
  collectionId: string,
  type: Extract<ProxyGroup['type'], 'select' | 'url-test' | 'fallback'>,
  enabled: boolean,
  options: { create: boolean; id?: string },
) {
  return validateGroupWrite({
    name,
    type,
    collectionIds: [collectionId],
    groupIds: [],
    builtins: [],
    testUrl: DEFAULT_HEALTH_CHECK.testUrl,
    interval: DEFAULT_HEALTH_CHECK.interval,
    tolerance: DEFAULT_HEALTH_CHECK.tolerance,
    lazy: DEFAULT_HEALTH_CHECK.lazy,
    enabled,
    isBuiltin: false,
  }, {
    create: options.create,
    id: options.id,
    isBuiltin: false,
  });
}

function prepareCollectionInsert(
  db: D1Database,
  id: string,
  validation: Extract<CollectionWriteValidation, { valid: true }>,
  timestamp: string,
  workspaceId: string,
) {
  return db.prepare(
    `INSERT INTO collections (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
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
    timestamp,
    timestamp,
    workspaceId,
  );
}

function prepareCollectionUpdate(
  db: D1Database,
  id: string,
  existing: Record<string, unknown>,
  validation: Extract<CollectionWriteValidation, { valid: true }>,
  timestamp: string,
) {
  return db.prepare(
    `UPDATE collections SET
      name = ?, source_ids = ?, node_ids = ?, filters = ?, renames = ?,
      dedup = ?, sort = ?, sort_country_order = ?, enabled = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
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
    timestamp,
    id,
  );
}

function parseStoredIdList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function findDedicatedLinkedGroup(
  db: D1Database,
  collectionId: string,
): Promise<Record<string, unknown> | null> {
  return db.prepare(
    'SELECT * FROM groups WHERE is_builtin = 0 AND collection_ids = ? ORDER BY created_at ASC LIMIT 1'
  )
    .bind(jsonStringify([collectionId]))
    .first<Record<string, unknown>>();
}

export function isManagedAutoNodeCollectionNotes(value: unknown): boolean {
  return typeof value === 'string' && value.trim().startsWith(AUTO_NODE_GROUP_PREFIX);
}

export function isManagedNodeCollectionNotes(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.startsWith(AUTO_NODE_GROUP_PREFIX) || text.startsWith(DEFAULT_NODE_POOL_PREFIX);
}

export function countCollectionNodes(nodes: ProxyNode[], collection: NodeCollection): number {
  let candidates = nodes;
  if (collection.nodeIds.length > 0) {
    const nodeIds = new Set(collection.nodeIds);
    candidates = nodes.filter(node => nodeIds.has(node.id));
  } else if (collection.sourceIds.length > 0) {
    const sourceIds = new Set(collection.sourceIds);
    candidates = nodes.filter(node => sourceIds.has(node.sourceId));
  }
  return applyCollectionTransforms(candidates, collection).length;
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
    const booleanError = validateOptionalBooleanFields(item, ['enabled']);
    if (booleanError) return { valid: false, error: `${booleanError} at filter index ${index}` };
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
    const booleanError = validateOptionalBooleanFields(item, ['enabled']);
    if (booleanError) return { valid: false, error: `${booleanError} at rename index ${index}` };
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
