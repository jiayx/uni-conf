import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonStringify, mapCollection, mapNode, newId, now } from '../db/helpers';
import type { NodeCollection, NodeFilter, NodeRename, ProxyNode } from '@uni-conf/types';
import { syncAutoNodeGroups } from '../services/auto-node-groups';

const app = new Hono<{ Bindings: Env }>();

// ─── List collections ─────────────────────────────────────────────────────────

app.get('/', async (c) => {
  await syncAutoNodeGroups(c.env.DB, now());

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM collections ORDER BY created_at DESC'
  ).all<Record<string, unknown>>();

  return c.json({ success: true, data: results.map(mapCollection) });
});

// ─── Create collection ────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json<Partial<NodeCollection>>();
  if (!body.name) {
    return c.json({ success: false, error: 'name is required' }, 400);
  }

  const id = newId();
  const ts = now();

  await c.env.DB.prepare(
    `INSERT INTO collections (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.name,
      jsonStringify(body.sourceIds ?? []),
      jsonStringify(body.nodeIds ?? []),
      jsonStringify(body.filters ?? []),
      jsonStringify(body.renames ?? []),
      body.dedup ?? 'name',
      body.sort ?? 'country',
      body.sortCountryOrder ? jsonStringify(body.sortCountryOrder) : null,
      body.enabled !== false ? 1 : 0,
      body.notes ?? null,
      ts,
      ts
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapCollection(row!) }, 201);
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

  const body = await c.req.json<Partial<NodeCollection>>();
  const ts = now();

  await c.env.DB.prepare(
    `UPDATE collections SET
      name = ?, source_ids = ?, node_ids = ?, filters = ?, renames = ?,
      dedup = ?, sort = ?, sort_country_order = ?, enabled = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.name ?? existing.name,
      body.sourceIds !== undefined ? jsonStringify(body.sourceIds) : existing.source_ids,
      body.nodeIds !== undefined ? jsonStringify(body.nodeIds) : existing.node_ids,
      body.filters !== undefined ? jsonStringify(body.filters) : existing.filters,
      body.renames !== undefined ? jsonStringify(body.renames) : existing.renames,
      body.dedup ?? existing.dedup,
      body.sort ?? existing.sort,
      body.sortCountryOrder !== undefined
        ? jsonStringify(body.sortCountryOrder)
        : existing.sort_country_order,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      body.notes !== undefined ? body.notes : existing.notes,
      ts,
      id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapCollection(updated!) });
});

// ─── Delete collection ────────────────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id FROM collections WHERE id = ?')
    .bind(id)
    .first();

  if (!row) return c.json({ success: false, error: 'Collection not found' }, 404);
  await c.env.DB.prepare('DELETE FROM collections WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { id } });
});

// ─── Preview filtered nodes for collection ────────────────────────────────────

app.get('/:id/preview', async (c) => {
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
      `SELECT * FROM nodes WHERE id IN (${placeholders}) AND enabled = 1`
    )
      .bind(...collection.nodeIds)
      .all<Record<string, unknown>>();
    nodeRows = results;
  } else if (collection.sourceIds.length > 0) {
    // Filter by source
    const placeholders = collection.sourceIds.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM nodes WHERE source_id IN (${placeholders}) AND enabled = 1`
    )
      .bind(...collection.sourceIds)
      .all<Record<string, unknown>>();
    nodeRows = results;
  } else {
    // All enabled nodes
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM nodes WHERE enabled = 1'
    ).all<Record<string, unknown>>();
    nodeRows = results;
  }

  let nodes = nodeRows.map(mapNode);

  // Apply in-memory filters
  nodes = applyFilters(nodes, collection.filters);

  // Apply renames
  nodes = applyRenames(nodes, collection.renames);

  // Apply dedup
  nodes = applyDedup(nodes, collection.dedup);

  // Apply sort
  nodes = applySort(nodes, collection.sort, collection.sortCountryOrder);

  return c.json({
    success: true,
    data: {
      collectionId: id,
      nodes,
      total: nodes.length,
    },
  });
});

// ─── Filter helpers ───────────────────────────────────────────────────────────

function applyFilters(nodes: ProxyNode[], filters: NodeFilter[]): ProxyNode[] {
  const enabledFilters = filters.filter((f) => f.enabled);
  if (enabledFilters.length === 0) return nodes;

  return nodes.filter((node) =>
    enabledFilters.every((filter) => matchesFilter(node, filter))
  );
}

// ─── Rename helpers ───────────────────────────────────────────────────────────

const EMOJI_RE =
  /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F1E0}-\u{1F1FF}]/gu;

const COUNTRY_STANDARDIZE: Array<[RegExp, string]> = [
  [/🇭🇰|hong\s*kong|hongkong|\bHK\b/gi, '香港'],
  [/🇯🇵|japan|\bJP\b|tokyo/gi, '日本'],
  [/🇺🇸|united\s+states?|usa|\bUS\b|america/gi, '美国'],
  [/🇸🇬|singapore|\bSG\b/gi, '新加坡'],
  [/🇹🇼|taiwan|\bTW\b/gi, '台湾'],
  [/🇰🇷|korea|\bKR\b/gi, '韩国'],
  [/🇬🇧|united\s+kingdom|britain|england|\bGB\b|\bUK\b/gi, '英国'],
  [/🇩🇪|germany|german|\bDE\b/gi, '德国'],
  [/🇫🇷|france|\bFR\b/gi, '法国'],
  [/🇳🇱|netherlands|\bNL\b/gi, '荷兰'],
  [/🇦🇺|australia|\bAU\b/gi, '澳大利亚'],
  [/🇨🇦|canada|\bCA\b/gi, '加拿大'],
];

function applyRename(name: string, rename: NodeRename): string {
  if (!rename.enabled) return name;

  switch (rename.type) {
    case 'replace':
      return rename.pattern ? name.split(rename.pattern).join(rename.replacement ?? '') : name;
    case 'regex': {
      if (!rename.pattern) return name;
      try {
        return name.replace(new RegExp(rename.pattern, 'g'), rename.replacement ?? '');
      } catch {
        return name;
      }
    }
    case 'prefix':
      return (rename.replacement ?? '') + name;
    case 'suffix':
      return name + (rename.replacement ?? '');
    case 'strip_emoji':
      return name.replace(EMOJI_RE, '').trim();
    case 'standardize_country': {
      let result = name;
      for (const [pattern, replacement] of COUNTRY_STANDARDIZE) {
        result = result.replace(pattern, replacement);
      }
      return result.trim();
    }
    case 'auto_number':
    default:
      return name;
  }
}

function applyRenames(nodes: ProxyNode[], renames: NodeRename[]): ProxyNode[] {
  const enabledRenames = [...renames].sort((a, b) => a.order - b.order).filter((r) => r.enabled);
  const hasAutoNumber = enabledRenames.some((r) => r.type === 'auto_number');
  const nonAutoRenames = enabledRenames.filter((r) => r.type !== 'auto_number');

  const renamed = nodes.map((node) => ({
    ...node,
    name: nonAutoRenames.reduce((current, rename) => applyRename(current, rename), node.name),
  }));

  if (!hasAutoNumber) return renamed;

  const nameCount = new Map<string, number>();
  for (const node of renamed) {
    nameCount.set(node.name, (nameCount.get(node.name) ?? 0) + 1);
  }

  const nameIndex = new Map<string, number>();
  return renamed.map((node) => {
    const count = nameCount.get(node.name) ?? 1;
    if (count <= 1) return node;

    const idx = (nameIndex.get(node.name) ?? 0) + 1;
    nameIndex.set(node.name, idx);
    return { ...node, name: `${node.name} ${idx.toString().padStart(2, '0')}` };
  });
}

function getNodeFieldValue(node: ProxyNode, field: NodeFilter['field']): string | string[] {
  switch (field) {
    case 'name': return node.name;
    case 'server': return node.server;
    case 'protocol': return node.protocol;
    case 'country': return node.country ?? '';
    case 'countryCode': return node.countryCode ?? '';
    case 'tag': return node.tags;
    case 'sourceId': return node.sourceId;
    default: return '';
  }
}

function matchesFilter(node: ProxyNode, filter: NodeFilter): boolean {
  const fieldValue = getNodeFieldValue(node, filter.field);
  const filterValue = filter.value;
  const firstFilterValue = Array.isArray(filterValue) ? filterValue[0] : filterValue;
  if (firstFilterValue === undefined) return true;

  switch (filter.operator) {
    case 'contains': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      return val.toLowerCase().includes(pattern.toLowerCase());
    }
    case 'not_contains': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      return !val.toLowerCase().includes(pattern.toLowerCase());
    }
    case 'equals': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      return val === pattern;
    }
    case 'not_equals': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      return val !== pattern;
    }
    case 'regex': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      try { return new RegExp(pattern, 'i').test(val); } catch { return false; }
    }
    case 'not_regex': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      try { return !new RegExp(pattern, 'i').test(val); } catch { return true; }
    }
    case 'in': {
      const items = Array.isArray(filterValue) ? filterValue : [filterValue];
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => items.includes(v));
      }
      return items.includes(fieldValue);
    }
    case 'not_in': {
      const items = Array.isArray(filterValue) ? filterValue : [filterValue];
      if (Array.isArray(fieldValue)) {
        return !fieldValue.some((v) => items.includes(v));
      }
      return !items.includes(fieldValue);
    }
    default:
      return true;
  }
}

function applyDedup(
  nodes: ProxyNode[],
  strategy: NodeCollection['dedup']
): ProxyNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    let key: string;
    switch (strategy) {
      case 'name':
        key = node.name;
        break;
      case 'server_port':
        key = `${node.server}:${node.port}`;
        break;
      case 'protocol_server_port':
        key = `${node.protocol}:${node.server}:${node.port}`;
        break;
      case 'full_config':
        key = JSON.stringify(node.parsedConfig);
        break;
      default:
        key = node.id;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applySort(
  nodes: ProxyNode[],
  strategy: NodeCollection['sort'],
  countryOrder?: string[]
): ProxyNode[] {
  const sorted = [...nodes];
  switch (strategy) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'protocol':
      sorted.sort((a, b) => a.protocol.localeCompare(b.protocol));
      break;
    case 'source':
      sorted.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
      break;
    case 'country': {
      const order = countryOrder ?? [];
      sorted.sort((a, b) => {
        const ai = order.indexOf(a.countryCode ?? '');
        const bi = order.indexOf(b.countryCode ?? '');
        if (ai === -1 && bi === -1) {
          return (a.countryCode ?? '').localeCompare(b.countryCode ?? '');
        }
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      break;
    }
    case 'manual':
    default:
      break;
  }
  return sorted;
}

export default app;
