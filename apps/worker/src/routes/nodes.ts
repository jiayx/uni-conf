import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonStringify, mapNode, newId, now } from '../db/helpers';
import type { ProxyProtocol } from '@uni-conf/types';
import { syncAutoNodeGroups } from '../services/auto-node-groups';
import { parseRawLines } from './sources';

const app = new Hono<{ Bindings: Env }>();

type ManualNodeCreateBody = {
  sourceId?: string;
  uri?: string;
  name?: string;
  protocol?: ProxyProtocol;
  server?: string;
  port?: number;
  country?: string;
  countryCode?: string;
  enabled?: boolean;
  tags?: string[];
  notes?: string;
  rawConfig?: Record<string, unknown>;
  parsedConfig?: Record<string, unknown>;
};

type ResolvedManualNodeInput = Required<Pick<ManualNodeCreateBody, 'name' | 'protocol' | 'server' | 'port'>> &
  Pick<ManualNodeCreateBody, 'sourceId' | 'country' | 'countryCode' | 'enabled' | 'tags' | 'notes' | 'rawConfig' | 'parsedConfig'>;

// ─── List nodes with filtering/pagination ─────────────────────────────────────

app.get('/', async (c) => {
  const query = c.req.query();
  const sourceId = query.sourceId;
  const protocol = query.protocol;
  const countryCode = query.countryCode;
  const enabled = query.enabled;
  const search = query.search;
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize ?? '50', 10)));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (sourceId) {
    conditions.push('source_id = ?');
    bindings.push(sourceId);
  }
  if (protocol) {
    conditions.push('protocol = ?');
    bindings.push(protocol);
  }
  if (countryCode) {
    conditions.push('country_code = ?');
    bindings.push(countryCode);
  }
  if (enabled !== undefined) {
    conditions.push('enabled = ?');
    bindings.push(enabled === 'true' || enabled === '1' ? 1 : 0);
  }
  if (search) {
    conditions.push("name LIKE ?");
    bindings.push(`%${search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM nodes ${where}`
  )
    .bind(...bindings)
    .first<{ total: number }>();

  const total = countRow?.total ?? 0;

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM nodes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...bindings, pageSize, offset)
    .all<Record<string, unknown>>();

  const nodes = results.map(mapNode);

  return c.json({
    success: true,
    data: {
      items: nodes,
      total,
      page,
      pageSize,
    },
  });
});

// ─── Create manual node ───────────────────────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json<ManualNodeCreateBody>();
  const input = resolveManualNodeInput(body);

  if (!input) {
    return c.json(
      { success: false, error: 'valid uri or name, protocol, server, and port are required' },
      400
    );
  }

  const id = newId();
  const ts = now();
  // Use 'manual' pseudo-source if no sourceId given
  const sourceId = input.sourceId ?? 'manual';

  // Ensure manual source exists
  if (sourceId === 'manual') {
    const manualSrc = await c.env.DB.prepare('SELECT id FROM sources WHERE id = ?')
      .bind('manual')
      .first();
    if (!manualSrc) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO sources (id, name, type, url, format, enabled, node_count, last_updated, update_interval, user_agent, notes, tags, created_at, updated_at)
         VALUES ('manual', 'Manual Nodes', 'manual', NULL, 'raw', 1, 0, NULL, 0, NULL, NULL, '[]', ?, ?)`
      )
        .bind(ts, ts)
        .run();
    }
  }

  const rawConfig = input.rawConfig ?? {};
  const parsedConfig = input.parsedConfig ?? {
    protocol: input.protocol,
    server: input.server,
    port: input.port,
    extra: {},
  };

  await c.env.DB.prepare(
    `INSERT INTO nodes (id, source_id, name, protocol, server, port, country, country_code, enabled, tags, notes, raw_config, parsed_config, is_manual, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(
      id,
      sourceId,
      input.name,
      input.protocol,
      input.server,
      input.port,
      input.country ?? null,
      input.countryCode ?? null,
      input.enabled !== false ? 1 : 0,
      jsonStringify(input.tags ?? []),
      input.notes ?? null,
      jsonStringify(rawConfig),
      jsonStringify(parsedConfig),
      ts,
      ts
    )
    .run();

  await updateSourceNodeCount(c.env.DB, sourceId, ts);
  await syncAutoNodeGroups(c.env.DB, ts);

  const row = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapNode(row!) }, 201);
});

// ─── Get node ─────────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Node not found' }, 404);
  return c.json({ success: true, data: mapNode(row) });
});

// ─── Update node ──────────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Node not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const ts = now();

  await c.env.DB.prepare(
    `UPDATE nodes SET
      name = ?, protocol = ?, server = ?, port = ?, country = ?, country_code = ?,
      enabled = ?, tags = ?, notes = ?, raw_config = ?, parsed_config = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.name ?? existing.name,
      body.protocol ?? existing.protocol,
      body.server ?? existing.server,
      body.port ?? existing.port,
      body.country !== undefined ? body.country : existing.country,
      body.countryCode !== undefined ? body.countryCode : existing.country_code,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      body.tags !== undefined ? jsonStringify(body.tags) : existing.tags,
      body.notes !== undefined ? body.notes : existing.notes,
      body.rawConfig !== undefined ? jsonStringify(body.rawConfig) : existing.raw_config,
      body.parsedConfig !== undefined ? jsonStringify(body.parsedConfig) : existing.parsed_config,
      ts,
      id
    )
    .run();

  await syncAutoNodeGroups(c.env.DB, ts);

  const updated = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapNode(updated!) });
});

// ─── Delete node (only manual) ────────────────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT id, source_id, is_manual FROM nodes WHERE id = ?')
    .bind(id)
    .first<{ id: string; source_id: string; is_manual: number }>();

  if (!row) return c.json({ success: false, error: 'Node not found' }, 404);
  if (!row.is_manual) {
    return c.json(
      { success: false, error: 'Cannot delete non-manual node. Disable it or delete source instead.' },
      403
    );
  }

  await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(id).run();
  const ts = now();
  await updateSourceNodeCount(c.env.DB, row.source_id, ts);
  await syncAutoNodeGroups(c.env.DB, ts);
  return c.json({ success: true, data: { id } });
});

async function updateSourceNodeCount(db: D1Database, sourceId: string, ts: string): Promise<void> {
  const row = await db.prepare('SELECT COUNT(*) as count FROM nodes WHERE source_id = ?')
    .bind(sourceId)
    .first<{ count: number }>();
  await db.prepare('UPDATE sources SET node_count = ?, updated_at = ? WHERE id = ?')
    .bind(row?.count ?? 0, ts, sourceId)
    .run();
}

export function resolveManualNodeInput(body: ManualNodeCreateBody): ResolvedManualNodeInput | null {
  const uri = body.uri?.trim();
  if (uri) {
    const parsed = parseRawLines(uri.split(/\r?\n/))[0];
    if (!parsed) return null;

    return {
      sourceId: body.sourceId,
      name: body.name || parsed.name,
      protocol: body.protocol ?? parsed.protocol,
      server: body.server || parsed.server,
      port: body.port || parsed.port,
      country: body.country ?? parsed.country,
      countryCode: body.countryCode ?? parsed.countryCode,
      enabled: body.enabled,
      tags: body.tags,
      notes: body.notes,
      rawConfig: body.rawConfig ?? {
        ...parsed.rawConfig,
        sourceFormat: 'uri',
        uri,
      },
      parsedConfig: body.parsedConfig ?? parsed.parsedConfig as unknown as Record<string, unknown>,
    };
  }

  if (!body.name || !body.protocol || !body.server || !body.port) return null;

  return {
    sourceId: body.sourceId,
    name: body.name,
    protocol: body.protocol,
    server: body.server,
    port: body.port,
    country: body.country,
    countryCode: body.countryCode,
    enabled: body.enabled,
    tags: body.tags,
    notes: body.notes,
    rawConfig: body.rawConfig,
    parsedConfig: body.parsedConfig,
  };
}

export default app;
