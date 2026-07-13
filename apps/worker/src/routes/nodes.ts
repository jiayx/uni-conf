import { Hono } from 'hono';
import type { Env } from '../types';
import { jsonParse, jsonStringify, mapNode, newId, now } from '../db/helpers';
import type { ProxyProtocol } from '@uni-conf/types';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import { isUsableProxyProtocol, missingRequiredProtocolFields } from '../services/protocol-validation';
import { parseRawLines } from './sources';
import { buildNodeRecognitionTags, buildStructuredProxyConfig, detectCountry, MAX_NODE_SEARCH_LENGTH } from '@uni-conf/shared';

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
  await ensureZeroSetupDefaults(c.env.DB, now());

  const query = c.req.query();
  const sourceId = query.sourceId;
  const protocol = query.protocol;
  const countryCode = query.countryCode;
  const enabled = query.enabled;
  const search = normalizeNodeSearchQuery(query.search);
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
    conditions.push('instr(lower(name), lower(?)) > 0');
    bindings.push(search);
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

  const nodes = results.map((row) => toNodeSummary(mapNode(row)));

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

export function toNodeSummary(node: ReturnType<typeof mapNode>): ReturnType<typeof mapNode> {
  return {
    ...node,
    rawConfig: {},
    parsedConfig: {
      protocol: node.protocol,
      server: node.server,
      port: node.port,
      tls: node.parsedConfig.tls,
      network: node.parsedConfig.network,
      extra: {},
    },
  };
}

export function normalizeNodeSearchQuery(value: string | undefined): string {
  return (value ?? '').trim().slice(0, MAX_NODE_SEARCH_LENGTH);
}

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
  const missingRequiredFields = missingRequiredProtocolFields(input.protocol, input.parsedConfig, input.rawConfig);
  if (missingRequiredFields.length > 0) {
    return c.json(
      { success: false, error: `missing required protocol fields: ${missingRequiredFields.join(', ')}` },
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
  await ensureManualNodeZeroSetupState(c.env.DB, ts);

  const row = await c.env.DB.prepare('SELECT * FROM nodes WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapNode(row!) }, 201);
});

async function ensureManualNodeZeroSetupState(db: D1Database, ts: string): Promise<void> {
  await ensureZeroSetupDefaults(db, ts);
}

// ─── Get node ─────────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now());

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
  const validation = validateManualNodeUpdate(body);
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }
  const ts = now();
  const nextProtocol = validation.protocol ?? (existing.protocol as ProxyProtocol);
  const nextServer = validation.server ?? String(existing.server);
  const nextPort = validation.port ?? Number(existing.port);
  const nextName = validation.name ?? String(existing.name);
  const detectedCountry = validation.name !== undefined ? detectCountry(nextName) : undefined;
  const existingParsedConfig = normalizeRecordValue(existing.parsed_config) ?? {};
  const nextParsedConfig = withNormalizedNodeCore(
    validation.parsedConfig ?? existingParsedConfig,
    nextProtocol,
    nextServer,
    nextPort
  );
  const nextRawConfig = validation.rawConfig ?? normalizeRecordValue(existing.raw_config) ?? {};
  const missingRequiredFields = missingRequiredProtocolFields(nextProtocol, nextParsedConfig, nextRawConfig);
  if (missingRequiredFields.length > 0) {
    return c.json(
      { success: false, error: `missing required protocol fields: ${missingRequiredFields.join(', ')}` },
      400
    );
  }

  await c.env.DB.prepare(
    `UPDATE nodes SET
      name = ?, protocol = ?, server = ?, port = ?, country = ?, country_code = ?,
      enabled = ?, tags = ?, notes = ?, raw_config = ?, parsed_config = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nextName,
      validation.protocol ?? existing.protocol,
      validation.server ?? existing.server,
      validation.port ?? existing.port,
      validation.country !== undefined ? validation.country : detectedCountry?.country ?? existing.country,
      validation.countryCode !== undefined ? validation.countryCode : detectedCountry?.countryCode ?? existing.country_code,
      validation.enabled !== undefined ? (validation.enabled ? 1 : 0) : existing.enabled,
      validation.tags !== undefined ? jsonStringify(validation.tags) : validation.name !== undefined ? jsonStringify(buildNodeRecognitionTags(nextName)) : existing.tags,
      validation.notes !== undefined ? validation.notes : existing.notes,
      validation.rawConfig !== undefined ? jsonStringify(validation.rawConfig) : existing.raw_config,
      jsonStringify(nextParsedConfig),
      ts,
      id
    )
    .run();

  await ensureZeroSetupDefaults(c.env.DB, ts);

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
  await ensureZeroSetupDefaults(c.env.DB, ts);
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
    const normalizedNameOverride = normalizeNonEmptyText(body.name);
    const name = normalizedNameOverride ?? parsed.name;
    const protocol = body.protocol ?? parsed.protocol;
    const server = normalizeNonEmptyText(body.server) ?? parsed.server;
    const port = body.port !== undefined ? normalizePort(body.port) : parsed.port;
    const detectedCountry = normalizedNameOverride ? detectCountry(name) : null;
    const tags = body.tags !== undefined
      ? normalizeStringList(body.tags)
      : normalizedNameOverride
        ? buildNodeRecognitionTags(name)
        : parsed.tags;
    if (!name || !isUsableProxyProtocol(protocol) || !server || port === null || !tags) return null;

    return {
      sourceId: body.sourceId,
      name,
      protocol,
      server,
      port,
      country: body.country ?? detectedCountry?.country ?? parsed.country,
      countryCode: body.countryCode ?? detectedCountry?.countryCode ?? parsed.countryCode,
      enabled: body.enabled,
      tags,
      notes: body.notes,
      rawConfig: body.rawConfig ?? {
        ...parsed.rawConfig,
        sourceFormat: 'uri',
        uri,
      },
      parsedConfig: body.parsedConfig ?? parsed.parsedConfig as unknown as Record<string, unknown>,
    };
  }

  const name = normalizeNonEmptyText(body.name);
  const server = normalizeNonEmptyText(body.server);
  const port = normalizePort(body.port);
  if (!name || !isUsableProxyProtocol(body.protocol) || !server || port === null) return null;
  const countryInfo = detectCountry(name);

  return {
    sourceId: body.sourceId,
    name,
    protocol: body.protocol,
    server,
    port,
    country: body.country ?? countryInfo?.country,
    countryCode: body.countryCode ?? countryInfo?.countryCode,
    enabled: body.enabled,
    tags: normalizeStringList(body.tags) ?? buildNodeRecognitionTags(name),
    notes: body.notes,
    rawConfig: body.rawConfig,
    parsedConfig: body.parsedConfig ?? buildStructuredProxyConfig(body.protocol, server, port, body.rawConfig) as unknown as Record<string, unknown>,
  };
}

type ManualNodeUpdateValidation =
  | {
      valid: true;
      name?: string;
      protocol?: ProxyProtocol;
      server?: string;
      port?: number;
      country?: string | null;
      countryCode?: string | null;
      enabled?: boolean;
      tags?: string[];
      notes?: string | null;
      rawConfig?: Record<string, unknown>;
      parsedConfig?: Record<string, unknown>;
    }
  | { valid: false; error: string };

export function validateManualNodeUpdate(body: Record<string, unknown>): ManualNodeUpdateValidation {
  const name = body.name !== undefined ? normalizeNonEmptyText(body.name) : undefined;
  if (body.name !== undefined && !name) return { valid: false, error: 'name is required' };

  const server = body.server !== undefined ? normalizeNonEmptyText(body.server) : undefined;
  if (body.server !== undefined && !server) return { valid: false, error: 'server is required' };

  let protocol: ProxyProtocol | undefined;
  if (body.protocol !== undefined) {
    if (!isUsableProxyProtocol(body.protocol)) return { valid: false, error: 'invalid proxy protocol' };
    protocol = body.protocol;
  }

  let port: number | undefined;
  if (body.port !== undefined) {
    const normalizedPort = normalizePort(body.port);
    if (normalizedPort === null) return { valid: false, error: 'port must be an integer between 1 and 65535' };
    port = normalizedPort;
  }

  let tags: string[] | undefined;
  if (body.tags !== undefined) {
    const normalizedTags = normalizeStringList(body.tags);
    if (!normalizedTags) return { valid: false, error: 'tags must be an array of strings' };
    tags = normalizedTags;
  }

  let rawConfig: Record<string, unknown> | undefined;
  if (body.rawConfig !== undefined) {
    const normalizedRawConfig = normalizeRecord(body.rawConfig);
    if (!normalizedRawConfig) return { valid: false, error: 'rawConfig must be an object' };
    rawConfig = normalizedRawConfig;
  }
  let parsedConfig: Record<string, unknown> | undefined;
  if (body.parsedConfig !== undefined) {
    const normalizedParsedConfig = normalizeRecord(body.parsedConfig);
    if (!normalizedParsedConfig) return { valid: false, error: 'parsedConfig must be an object' };
    parsedConfig = normalizedParsedConfig;
  }

  return {
    valid: true,
    name,
    protocol,
    server,
    port,
    country: body.country !== undefined ? normalizeNullableText(body.country) : undefined,
    countryCode: body.countryCode !== undefined ? normalizeNullableText(body.countryCode)?.toUpperCase() ?? null : undefined,
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
    tags,
    notes: body.notes !== undefined ? normalizeNullableText(body.notes) : undefined,
    rawConfig,
    parsedConfig,
  };
}

function normalizeNonEmptyText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function normalizePort(value: unknown): number | null {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function normalizeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const text = item.trim();
    if (text) items.push(text);
  }
  return [...new Set(items)];
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeRecordValue(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') return jsonParse<Record<string, unknown>>(value) ?? null;
  return normalizeRecord(value);
}

function withNormalizedNodeCore(
  config: Record<string, unknown>,
  protocol: ProxyProtocol,
  server: string,
  port: number
): Record<string, unknown> {
  return {
    ...config,
    protocol,
    server,
    port,
  };
}

export default app;
