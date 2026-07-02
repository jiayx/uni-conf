import { Hono } from 'hono';
import { load as parseYAML } from 'js-yaml';
import type { Env } from '../types';
import {
  jsonStringify,
  mapSource,
  newId,
  now,
} from '../db/helpers';
import {
  buildNodeRecognitionTags,
  buildStructuredProxyConfig,
  detectCountry,
  extractSourceNodeGroupMarkerKey,
  getProxyLinkUriScheme,
  isSubscriptionInfoNodeName,
  parseSourceNodeGroupKey,
  SOURCE_FORMATS,
  SOURCE_NODE_GROUP_PREFIX,
} from '@uni-conf/shared';
import { MIHOMO_TYPE_TO_PROTOCOL, SINGBOX_TYPE_TO_PROTOCOL, URI_SCHEME_TO_PROTOCOL } from '@uni-conf/types';
import type { ProxyProtocol, NormalizedProxyConfig, SourceFormat, SourceNodeGroup, SourceRefreshResult, SourceType } from '@uni-conf/types';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import { isUsableProxyProtocol, missingRequiredProtocolFields } from '../services/protocol-validation';

const app = new Hono<{ Bindings: Env }>();

// ─── List all sources ─────────────────────────────────────────────────────────

app.get('/', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now());

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, type, url, format, enabled, node_count, last_updated,
      last_refresh_error,
      update_interval, user_agent, notes, tags, source_groups,
      upload_bytes, download_bytes, total_bytes, expire_time,
      created_at, updated_at
     FROM sources ORDER BY created_at DESC`
  ).all();
  const sources = (results as Record<string, unknown>[]).map(mapSource);
  return c.json({ success: true, data: sources });
});

// ─── Create source ─────────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    type: string;
    url?: string;
    format?: string;
    enabled?: boolean;
    updateInterval?: number;
    userAgent?: string;
    notes?: string;
    tags?: string[];
    refreshAfterCreate?: boolean;
  }>();

  const sourceType = body.type ?? (body.url ? 'url' : undefined);
  if (!sourceType) {
    return c.json({ success: false, error: 'type is required' }, 400);
  }
  if (!isValidSourceType(sourceType)) {
    return c.json({ success: false, error: 'invalid source type' }, 400);
  }
  const format = body.format ?? 'auto';
  if (!isValidSourceFormat(format)) {
    return c.json({ success: false, error: 'invalid source format' }, 400);
  }
  const normalizedUrl = normalizeHttpUrl(body.url);
  if (sourceType === 'url' && !body.url) {
    return c.json({ success: false, error: 'url is required' }, 400);
  }
  if (sourceType === 'url' && !normalizedUrl) {
    return c.json({ success: false, error: 'url must be an http(s) URL' }, 400);
  }
  const sourceFields = validateSourceMutableFields(body);
  if (!sourceFields.valid) {
    return c.json({ success: false, error: sourceFields.error }, 400);
  }

  const id = newId();
  const ts = now();
  const sourceName = resolveSourceNameInput(body.name, normalizedUrl ?? body.url);

  await c.env.DB.prepare(
    `INSERT INTO sources (id, name, type, url, format, enabled, node_count, last_updated, update_interval, user_agent, notes, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      sourceName,
      sourceType,
      normalizedUrl ?? null,
      format,
      body.enabled !== false ? 1 : 0,
      sourceFields.updateInterval ?? 0,
      sourceFields.userAgent ?? null,
      sourceFields.notes ?? null,
      jsonStringify(sourceFields.tags ?? []),
      ts,
      ts
    )
    .run();

  let refresh: SourceRefreshResult | undefined;
  let refreshError: string | undefined;
  const shouldRefreshAfterCreate = body.refreshAfterCreate !== false && sourceType === 'url' && Boolean(body.url);
  if (shouldRefreshAfterCreate) {
    try {
      refresh = await refreshSourceById(c.env.DB, id);
    } catch (err) {
      refreshError = err instanceof Error ? err.message : String(err);
      await recordSourceRefreshError(c.env.DB, id, refreshError);
    }
  }
  await ensureSourceZeroSetupState(c.env.DB, ts);

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: { source: mapSource(row!), refresh, refreshError } }, 201);
});

async function ensureSourceZeroSetupState(db: D1Database, ts: string): Promise<void> {
  await ensureZeroSetupDefaults(db, ts);
}

// ─── Get source ───────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now());

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Source not found' }, 404);
  return c.json({ success: true, data: mapSource(row) });
});

// ─── Update source ────────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Source not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const ts = now();
  const nextType = body.type !== undefined ? String(body.type) : String(existing.type);
  const nextUrl = body.url !== undefined ? normalizeHttpUrl(body.url) ?? String(body.url ?? '').trim() : String(existing.url ?? '');
  const nextFormat = body.format !== undefined ? String(body.format) : String(existing.format ?? 'auto');

  if (!isValidSourceType(nextType)) {
    return c.json({ success: false, error: 'invalid source type' }, 400);
  }
  if (!isValidSourceFormat(nextFormat)) {
    return c.json({ success: false, error: 'invalid source format' }, 400);
  }
  if (nextType === 'url' && !nextUrl) {
    return c.json({ success: false, error: 'url is required' }, 400);
  }
  if (nextType === 'url' && !isHttpUrl(nextUrl)) {
    return c.json({ success: false, error: 'url must be an http(s) URL' }, 400);
  }
  const sourceFields = validateSourceMutableFields(body);
  if (!sourceFields.valid) {
    return c.json({ success: false, error: sourceFields.error }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE sources SET
      name = ?, type = ?, url = ?, format = ?, enabled = ?,
      update_interval = ?, user_agent = ?, notes = ?, tags = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      'name' in body
        ? resolveSourceNameInput(body.name, nextUrl)
        : existing.name,
      nextType,
      nextUrl || null,
      nextFormat,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      sourceFields.updateInterval !== undefined ? sourceFields.updateInterval : existing.update_interval,
      // Allow explicitly setting to null or empty string to clear user_agent
      'userAgent' in body ? sourceFields.userAgent ?? null : existing.user_agent,
      body.notes !== undefined ? sourceFields.notes : existing.notes,
      body.tags !== undefined ? jsonStringify(sourceFields.tags) : existing.tags,
      ts,
      id
    )
    .run();

  await ensureZeroSetupDefaults(c.env.DB, ts);

  const updated = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapSource(updated!) });
});

// ─── Delete source (nodes cascade via FK) ─────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await deleteSourceById(c.env.DB, id);
  if (!deleted) return c.json({ success: false, error: 'Source not found' }, 404);
  return c.json({ success: true, data: { id } });
});

export async function deleteSourceById(db: D1Database, id: string, ts = now()): Promise<boolean> {
  const existing = await db.prepare('SELECT id FROM sources WHERE id = ?')
    .bind(id)
    .first();

  if (!existing) return false;

  await db.prepare('DELETE FROM nodes WHERE source_id = ?').bind(id).run();
  await db.prepare('DELETE FROM sources WHERE id = ?').bind(id).run();
  await ensureZeroSetupDefaults(db, ts);
  return true;
}

// ─── Refresh source ───────────────────────────────────────────────────────────

app.post('/:id/refresh', async (c) => {
  const id = c.req.param('id');
  const ts = now();
  try {
    const result = await refreshSourceById(c.env.DB, id);
    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : `Failed to fetch URL: ${String(err)}`;
    await recordSourceRefreshError(c.env.DB, id, message);
    await ensureZeroSetupDefaults(c.env.DB, ts);
    if (err instanceof SourceRefreshError) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    return c.json(
      { success: false, error: message },
      502
    );
  }
});

export class SourceRefreshError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 422 | 502
  ) {
    super(message);
  }
}

export async function refreshSourceById(db: D1Database, id: string): Promise<SourceRefreshResult> {
  const row = await db.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!row) throw new SourceRefreshError('Source not found', 404);
  if (!row.url) throw new SourceRefreshError('Source has no URL to fetch', 400);

  // Use mainstream client User-Agent to avoid 502 errors from airport servers
  // that check UA for anti-crawler protection.
  const defaultUserAgent = 'clash.meta/v1.19.23';

  let rawContent: string;
  let subscriptionInfo: {
    uploadBytes?: number;
    downloadBytes?: number;
    totalBytes?: number;
    expireTime?: number;
  };

  try {
    const response = await fetch(row.url as string, {
      headers: {
        'User-Agent': (row.user_agent as string | null) ?? defaultUserAgent,
        Accept: '*/*',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    subscriptionInfo = parseSubscriptionUserInfo(response.headers.get('subscription-userinfo'));
    rawContent = await response.text();
  } catch (err) {
    throw new SourceRefreshError(`Failed to fetch URL: ${String(err)}`, 502);
  }
  await cacheFetchedSourceContent(db, id, rawContent, subscriptionInfo, now());

  // Detect format and parse nodes
  const sourceFormat = isValidSourceFormat(row.format) ? row.format : 'auto';
  const { nodes: rawParsedNodes, groups: rawParsedGroups, format } = detectAndParse(rawContent, sourceFormat);
  const { nodes: parsedNodes, groups: parsedGroups, excludedCount } = filterUsableParsedContent(
    rawParsedNodes,
    rawParsedGroups
  );
  if (parsedNodes.length === 0) {
    throw new SourceRefreshError(
      `No usable proxy nodes parsed from source content (detected format: ${format}, excluded: ${excludedCount})`,
      422
    );
  }

  // Load existing nodes for this source to compute diff
  const { results: existingRows } = await db.prepare(
    'SELECT id, name, server, port, protocol, country, country_code, tags, raw_config, parsed_config FROM nodes WHERE source_id = ? AND is_manual = 0'
  )
    .bind(id)
    .all<{
      id: string;
      name: string;
      server: string;
      port: number;
      protocol: string;
      country: string | null;
      country_code: string | null;
      tags: string | null;
      raw_config: string | null;
      parsed_config: string | null;
    }>();

  const existingByKey = new Map(existingRows.map((r) => [nodeIdentityKey(r), r]));
  const existingByUniqueName = uniqueRowsByName(existingRows);
  const parsedNameCounts = countByName(parsedNodes);

  const addedNodes: typeof parsedNodes = [];
  const updatedNodes: Array<{ id: string; node: ParsedNodeRaw }> = [];
  const matchedExistingIds = new Set<string>();
  const seenKeys = new Set<string>();

  for (const node of parsedNodes) {
    const key = nodeIdentityKey(node);
    if (seenKeys.has(key)) continue;

    const existing = existingByKey.get(key)
      ?? (parsedNameCounts.get(node.name) === 1 ? existingByUniqueName.get(node.name) : undefined);
    if (existing) {
      if (shouldUpdateNode(existing, node)) {
        updatedNodes.push({ id: existing.id, node });
      }
      matchedExistingIds.add(existing.id);
    } else {
      addedNodes.push(node);
    }
    seenKeys.add(key);
  }

  // Identify nodes to remove (were from this source, not in new set)
  const toRemove = existingRows.filter(
    (r) => !matchedExistingIds.has(r.id)
  );

  const ts = now();

  // Insert added nodes
  for (const node of addedNodes) {
    const nodeId = newId();
    await db.prepare(
      `INSERT INTO nodes (id, source_id, name, protocol, server, port, country, country_code, enabled, tags, notes, raw_config, parsed_config, is_manual, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, 0, ?, ?)`
    )
      .bind(
        nodeId,
        id,
        node.name,
        node.protocol,
        node.server,
        node.port,
        node.country ?? null,
        node.countryCode ?? null,
        jsonStringify(node.tags),
        jsonStringify(node.rawConfig),
        jsonStringify(node.parsedConfig),
        ts,
        ts
      )
      .run();
  }

  // Update existing nodes when their stable subscription identity still matches.
  for (const item of updatedNodes) {
    await db.prepare(
      `UPDATE nodes SET
        name = ?, protocol = ?, server = ?, port = ?, country = ?, country_code = ?, tags = ?, raw_config = ?, parsed_config = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        item.node.name,
        item.node.protocol,
        item.node.server,
        item.node.port,
        item.node.country ?? null,
        item.node.countryCode ?? null,
        jsonStringify(item.node.tags),
        jsonStringify(item.node.rawConfig),
        jsonStringify(item.node.parsedConfig),
        ts,
        item.id
      )
      .run();
  }

  // Delete removed nodes
  for (const rem of toRemove) {
    await db.prepare('DELETE FROM nodes WHERE id = ?').bind(rem.id).run();
  }

  // Update source node_count, last_updated, and subscription info
  const { results: countResult } = await db.prepare(
    'SELECT COUNT(*) as cnt FROM nodes WHERE source_id = ?'
  )
    .bind(id)
    .all<{ cnt: number }>();

  const nodeCount = countResult[0]?.cnt ?? parsedNodes.length;

  await db.prepare(
    `UPDATE sources SET
      node_count = ?,
      last_updated = ?,
      upload_bytes = ?,
      download_bytes = ?,
      total_bytes = ?,
      expire_time = ?,
      source_groups = ?,
      raw_content = ?,
      last_refresh_error = NULL,
      updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nodeCount,
      ts,
      subscriptionInfo.uploadBytes ?? null,
      subscriptionInfo.downloadBytes ?? null,
      subscriptionInfo.totalBytes ?? null,
      subscriptionInfo.expireTime ?? null,
      jsonStringify(parsedGroups),
      rawContent,
      ts,
      id
    )
    .run();

  await syncImportedSourceNodeGroups(db, id, parsedGroups, ts);
  await ensureZeroSetupDefaults(db, ts);

  return {
    sourceId: id,
    success: true,
    nodeCount,
    addedCount: addedNodes.length,
    updatedCount: updatedNodes.length,
    removedCount: toRemove.length,
    excludedCount,
    sourceGroupCount: parsedGroups.length,
    format,
  };
}

async function syncImportedSourceNodeGroups(
  db: D1Database,
  sourceId: string,
  groups: SourceNodeGroup[],
  ts: string
): Promise<void> {
  const { results: collections } = await db.prepare(
    'SELECT id, node_ids, notes FROM collections WHERE notes LIKE ?'
  )
    .bind(`${SOURCE_NODE_GROUP_PREFIX} ${sourceId}:%`)
    .all<{ id: string; node_ids: string | null; notes: string | null }>();
  if (collections.length === 0) return;

  const { results: nodeRows } = await db.prepare(
    'SELECT id, name FROM nodes WHERE source_id = ? AND is_manual = 0'
  )
    .bind(sourceId)
    .all<{ id: string; name: string }>();
  const nodeIdByName = new Map(nodeRows.map((row) => [row.name, row.id]));
  const groupByName = new Map(groups.map((group) => [group.name, group]));
  const statements: D1PreparedStatement[] = [];

  for (const collection of collections) {
    const key = extractSourceNodeGroupMarkerKey(collection.notes);
    const marker = key ? parseSourceNodeGroupKey(key) : null;
    if (!marker || marker.sourceId !== sourceId) continue;

    const group = groupByName.get(marker.groupName);
    const nodeIds = group
      ? group.memberNames
        .map((name) => nodeIdByName.get(name))
        .filter((id): id is string => Boolean(id))
      : [];
    const nextNodeIds = jsonStringify([...new Set(nodeIds)]);
    if ((collection.node_ids ?? '[]') === nextNodeIds) continue;

    statements.push(
      db.prepare('UPDATE collections SET node_ids = ?, updated_at = ? WHERE id = ?')
        .bind(nextNodeIds, ts, collection.id)
    );
  }

  if (statements.length > 0) await db.batch(statements);
}

export async function recordSourceRefreshError(db: D1Database, id: string, error: string): Promise<void> {
  await db.prepare('UPDATE sources SET last_refresh_error = ?, updated_at = ? WHERE id = ?')
    .bind(error, now(), id)
    .run();
}

async function cacheFetchedSourceContent(
  db: D1Database,
  id: string,
  rawContent: string,
  subscriptionInfo: {
    uploadBytes?: number;
    downloadBytes?: number;
    totalBytes?: number;
    expireTime?: number;
  },
  ts: string
): Promise<void> {
  await db.prepare(
    `UPDATE sources SET
      raw_content = ?,
      upload_bytes = ?,
      download_bytes = ?,
      total_bytes = ?,
      expire_time = ?,
      updated_at = ?
     WHERE id = ?`
  )
    .bind(
      rawContent,
      subscriptionInfo.uploadBytes ?? null,
      subscriptionInfo.downloadBytes ?? null,
      subscriptionInfo.totalBytes ?? null,
      subscriptionInfo.expireTime ?? null,
      ts,
      id
    )
    .run();
}

export function deriveSourceName(url: string | undefined): string {
  const value = url?.trim();
  if (!value) return '订阅源';

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, '');
    return host || '订阅源';
  } catch {
    return value.length > 32 ? `${value.slice(0, 32)}...` : value;
  }
}

export function resolveSourceNameInput(name: unknown, url: string | undefined): string {
  return typeof name === 'string' && name.trim() ? name.trim() : deriveSourceName(url);
}

const SOURCE_TYPES: ReadonlySet<SourceType> = new Set(['url', 'manual', 'file', 'clipboard']);
const SOURCE_FORMAT_SET: ReadonlySet<SourceFormat> = new Set(SOURCE_FORMATS);

export function isValidSourceType(value: unknown): value is SourceType {
  return SOURCE_TYPES.has(value as SourceType);
}

export function isValidSourceFormat(value: unknown): value is SourceFormat {
  return SOURCE_FORMAT_SET.has(value as SourceFormat);
}

export function isHttpUrl(value: unknown): boolean {
  return Boolean(normalizeHttpUrl(value));
}

function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const text = value.trim();
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}

type SourceMutableFieldsValidation =
  | {
      valid: true;
      updateInterval?: number;
      userAgent?: string | null;
      notes?: string | null;
      tags?: string[];
    }
  | { valid: false; error: string };

export function validateSourceMutableFields(body: {
  updateInterval?: unknown;
  userAgent?: unknown;
  notes?: unknown;
  tags?: unknown;
}): SourceMutableFieldsValidation {
  const updateInterval = body.updateInterval !== undefined ? normalizeNonNegativeInteger(body.updateInterval) : undefined;
  if (body.updateInterval !== undefined && updateInterval === undefined) {
    return { valid: false, error: 'updateInterval must be a non-negative integer' };
  }

  let tags: string[] | undefined;
  if (body.tags !== undefined) {
    const normalizedTags = normalizeStringList(body.tags);
    if (!normalizedTags) return { valid: false, error: 'tags must be an array of strings' };
    tags = normalizedTags;
  }

  return {
    valid: true,
    updateInterval,
    userAgent: body.userAgent !== undefined ? normalizeNullableText(body.userAgent) : undefined,
    notes: body.notes !== undefined ? normalizeNullableText(body.notes) : undefined,
    tags,
  };
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) return undefined;
  return numberValue;
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
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

function parseSubscriptionUserInfo(header: string | null): {
  uploadBytes?: number;
  downloadBytes?: number;
  totalBytes?: number;
  expireTime?: number;
} {
  const info: {
    uploadBytes?: number;
    downloadBytes?: number;
    totalBytes?: number;
    expireTime?: number;
  } = {};
  if (!header) return info;

  const parts = header.split(';').map(p => p.trim());
  for (const part of parts) {
    const [key, value] = part.split('=').map(s => s.trim());
    if (!key || !value) continue;

    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) continue;
    if (key === 'upload') info.uploadBytes = numValue;
    else if (key === 'download') info.downloadBytes = numValue;
    else if (key === 'total') info.totalBytes = numValue;
    else if (key === 'expire') info.expireTime = numValue;
  }

  return info;
}

// ─── Format detection & parsing ───────────────────────────────────────────────

export interface ParsedNodeRaw {
  name: string;
  protocol: ProxyProtocol;
  server: string;
  port: number;
  country?: string;
  countryCode?: string;
  rawConfig: Record<string, unknown>;
  parsedConfig: NormalizedProxyConfig;
  tags: string[];
}

function shouldKeepParsedNode(node: ParsedNodeRaw): boolean {
  return isUsableProxyProtocol(node.protocol)
    && !isSubscriptionInfoNodeName(node.name)
    && missingRequiredProtocolFields(node.protocol, node.parsedConfig, node.rawConfig).length === 0;
}

export function filterUsableParsedContent(
  nodes: ParsedNodeRaw[],
  groups: SourceNodeGroup[]
): { nodes: ParsedNodeRaw[]; groups: SourceNodeGroup[]; excludedCount: number } {
  const usableNodes = nodes.filter(shouldKeepParsedNode);
  const excludedNames = new Set(nodes.filter((node) => !shouldKeepParsedNode(node)).map((node) => node.name));
  const usableGroups = groups
    .map((group) => ({
      ...group,
      memberNames: group.memberNames.filter((name) => !excludedNames.has(name) && !isSubscriptionInfoNodeName(name)),
    }))
    .filter((group) => group.memberNames.length > 0);

  return {
    nodes: usableNodes,
    groups: usableGroups,
    excludedCount: nodes.length - usableNodes.length,
  };
}

function countryFields(name: string): Pick<ParsedNodeRaw, 'country' | 'countryCode'> {
  const countryInfo = detectCountry(name);
  return {
    country: countryInfo?.country,
    countryCode: countryInfo?.countryCode,
  };
}

function recognitionTags(name: string): Pick<ParsedNodeRaw, 'tags'> {
  return { tags: buildNodeRecognitionTags(name) };
}

export function detectAndParse(
  raw: string,
  hint: SourceFormat = 'auto'
): { nodes: ParsedNodeRaw[]; groups: SourceNodeGroup[]; format: SourceFormat } {
  const trimmed = raw.trim();

  if (hint !== 'auto') return parseBySourceFormat(trimmed, hint);

  // Try YAML (Clash/Mihomo format)
  if (trimmed.startsWith('proxies:') || trimmed.includes('\nproxies:')) {
    const nodes = parseClashYaml(trimmed);
    const groups = parseClashGroups(trimmed);
    return { nodes, groups, format: 'mihomo' };
  }

  // Try JSON (sing-box format)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const nodes = parseSingboxJson(parsed);
      const groups = parseSingboxGroups(parsed);
      return { nodes, groups, format: 'singbox' };
    } catch {
      // Not valid JSON
    }
  }

  // Try base64
  try {
    const decoded = atob(trimmed.replace(/\s/g, ''));
    const lines = decoded.split('\n').filter((l) => l.trim().length > 0);
    const nodes = parseRawLines(lines);
    if (nodes.length > 0) return { nodes, groups: [], format: 'base64' };
  } catch {
    // Not base64
  }

  // Raw URI lines
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  const nodes = parseRawLines(lines);
  return { nodes, groups: [], format: 'raw' };
}

function parseBySourceFormat(
  trimmed: string,
  format: Exclude<SourceFormat, 'auto'>
): { nodes: ParsedNodeRaw[]; groups: SourceNodeGroup[]; format: SourceFormat } {
  if (format === 'clash' || format === 'mihomo') {
    return {
      nodes: parseClashYaml(trimmed),
      groups: parseClashGroups(trimmed),
      format,
    };
  }

  if (format === 'singbox') {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        nodes: parseSingboxJson(parsed),
        groups: parseSingboxGroups(parsed),
        format,
      };
    } catch {
      return { nodes: [], groups: [], format };
    }
  }

  if (format === 'base64') {
    try {
      const decoded = atob(trimmed.replace(/\s/g, ''));
      return {
        nodes: parseRawLines(decoded.split('\n').filter((line) => line.trim().length > 0)),
        groups: [],
        format,
      };
    } catch {
      return { nodes: [], groups: [], format };
    }
  }

  return {
    nodes: parseRawLines(trimmed.split('\n').filter((line) => line.trim().length > 0)),
    groups: [],
    format,
  };
}

function shouldUpdateNode(
  existing: {
    name: string;
    server: string;
    port: number;
    protocol: string;
    country: string | null;
    country_code: string | null;
    tags: string | null;
    raw_config: string | null;
    parsed_config: string | null;
  },
  next: ParsedNodeRaw
): boolean {
  return existing.name !== next.name ||
    existing.server !== next.server ||
    Number(existing.port) !== next.port ||
    existing.protocol !== next.protocol ||
    (existing.country ?? null) !== (next.country ?? null) ||
    (existing.country_code ?? null) !== (next.countryCode ?? null) ||
    (existing.tags ?? '[]') !== jsonStringify(next.tags) ||
    existing.raw_config !== jsonStringify(next.rawConfig) ||
    existing.parsed_config !== jsonStringify(next.parsedConfig);
}

function nodeIdentityKey(node: { server: string; port: number; name: string }): string {
  return `${node.server}:${node.port}:${node.name}`;
}

function uniqueRowsByName<T extends { name: string }>(rows: T[]): Map<string, T> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  return new Map(rows.filter((row) => counts.get(row.name) === 1).map((row) => [row.name, row]));
}

function countByName(nodes: Array<{ name: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
  return counts;
}

export function parseClashYaml(content: string): ParsedNodeRaw[] {
  // Use full YAML parser for robust handling of all edge cases
  const nodes: ParsedNodeRaw[] = [];

  try {
    const doc = parseYAML(content);
    if (!doc || typeof doc !== 'object') return nodes;

    const proxies = (doc as Record<string, unknown>).proxies;
    if (!Array.isArray(proxies)) return nodes;

    for (const proxy of proxies) {
      if (!proxy || typeof proxy !== 'object') continue;

      const proxyObj = proxy as Record<string, unknown>;
      const name = proxyObj.name;
      const type = proxyObj.type;
      const server = proxyObj.server;
      const port = proxyObj.port;

      // Skip entries missing required fields
      if (!name || !type || !server || !port) continue;

      const nameStr = String(name).trim();
      const typeStr = String(type).trim().toLowerCase();
      const serverStr = String(server).trim();
      const portNum = typeof port === 'number' ? port : parseInt(String(port), 10);

      if (!nameStr || !serverStr || isNaN(portNum)) continue;

      const protocol = clashTypeToProtocol(typeStr);
      const rawConfig = proxyObj;

      nodes.push({
        name: nameStr,
        protocol,
        server: serverStr,
        port: portNum,
        ...countryFields(nameStr),
        ...recognitionTags(nameStr),
        rawConfig,
        parsedConfig: buildParsedConfig(protocol, serverStr, portNum, rawConfig),
      });
    }
  } catch (err) {
    console.error('YAML parse error:', err);
    // Return empty array on parse error
  }

  return nodes;
}

export function parseClashGroups(content: string): SourceNodeGroup[] {
  try {
    const doc = parseYAML(content);
    if (!doc || typeof doc !== 'object') return [];

    const groups = (doc as Record<string, unknown>)['proxy-groups'];
    if (!Array.isArray(groups)) return [];

    return groups
      .map((group) => {
        if (!group || typeof group !== 'object') return null;
        const groupObj = group as Record<string, unknown>;
        const name = String(groupObj.name ?? '').trim();
        if (!name) return null;

        const proxies = Array.isArray(groupObj.proxies) ? groupObj.proxies : [];
        const memberNames = proxies
          .map((item) => String(item ?? '').trim())
          .filter((item) => item && !isMihomoBuiltinPolicyName(item));

        const result: SourceNodeGroup = {
          name,
          type: groupObj.type ? String(groupObj.type) : undefined,
          memberNames,
        };
        return result;
      })
      .filter((group): group is SourceNodeGroup => group !== null && group.memberNames.length > 0);
  } catch {
    return [];
  }
}

function clashTypeToProtocol(type: string): ProxyProtocol {
  return MIHOMO_TYPE_TO_PROTOCOL[type] ?? (type === 'hy2' ? 'hysteria2' : 'unknown');
}

function parseSingboxJson(data: Record<string, unknown>): ParsedNodeRaw[] {
  const nodes: ParsedNodeRaw[] = [];
  const outbounds = data.outbounds as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(outbounds)) return nodes;

  const proxyTypes = new Set([
    'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic',
    'anytls', 'wireguard', 'socks', 'http', 'ssh', 'shadowtls',
  ]);

  for (const ob of outbounds) {
    const type = (ob.type as string | undefined)?.toLowerCase() ?? '';
    if (!proxyTypes.has(type)) continue;

    const name = (ob.tag as string | null) ?? 'Unknown';
    const server = (ob.server as string | null) ?? '';
    const port = (ob.server_port as number | null) ?? 0;
    if (!server || !port) continue;

    const protocol = singboxTypeToProtocol(type);
    nodes.push({
      name,
      protocol,
      server,
      port,
      ...countryFields(name),
      ...recognitionTags(name),
      rawConfig: ob,
      parsedConfig: buildParsedConfig(protocol, server, port, ob),
    });
  }

  return nodes;
}

export function parseSingboxGroups(data: Record<string, unknown>): SourceNodeGroup[] {
  const outbounds = data.outbounds as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(outbounds)) return [];

  const groupTypes = new Set(['selector', 'urltest', 'url-test', 'loadbalance', 'load-balance']);
  return outbounds
    .map((outbound) => {
      const type = String(outbound.type ?? '').toLowerCase();
      if (!groupTypes.has(type)) return null;

      const name = String(outbound.tag ?? '').trim();
      if (!name) return null;

      const members = Array.isArray(outbound.outbounds) ? outbound.outbounds : [];
      const memberNames = members
        .map((item) => String(item ?? '').trim())
        .filter((item) => item && !isSingboxBuiltinOutboundName(item));

      const result: SourceNodeGroup = {
        name,
        type,
        memberNames,
      };
      return result;
    })
    .filter((group): group is SourceNodeGroup => group !== null && group.memberNames.length > 0);
}

function isMihomoBuiltinPolicyName(name: string): boolean {
  return ['DIRECT', 'REJECT'].includes(name.toUpperCase());
}

function isSingboxBuiltinOutboundName(name: string): boolean {
  return ['direct', 'block'].includes(name.toLowerCase());
}

function singboxTypeToProtocol(type: string): ProxyProtocol {
  return SINGBOX_TYPE_TO_PROTOCOL[type] ?? 'unknown';
}

export function parseRawLines(lines: string[]): ParsedNodeRaw[] {
  const nodes: ParsedNodeRaw[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      if (trimmed.startsWith('vmess://')) {
        const node = parseVmessUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('ss://')) {
        const node = parseSsUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('ssr://')) {
        const node = parseSsrUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('trojan://')) {
        const node = parseTrojanUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('vless://')) {
        const node = parseVlessUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) {
        const node = parseHysteria2Uri(trimmed);
        if (node) nodes.push(node);
      } else if (getProxyLinkUriScheme(trimmed) !== null || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const node = parseGenericUrlUri(trimmed);
        if (node) nodes.push(node);
      }
    } catch {
      // Skip malformed URIs
    }
  }

  return nodes;
}

function parseVmessUri(uri: string): ParsedNodeRaw | null {
  const b64 = uri.replace('vmess://', '');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(atob(b64)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const name = (data.ps as string | null) ?? 'VMess';
  const server = (data.add as string | null) ?? '';
  const port = parseInt(String(data.port ?? 0), 10);
  if (!server || !port) return null;

  return {
    name,
    protocol: 'vmess',
    server,
    port,
    ...countryFields(name),
    ...recognitionTags(name),
    rawConfig: data,
    parsedConfig: {
      protocol: 'vmess',
      server,
      port,
      uuid: data.id as string,
      tls: data.tls === 'tls',
      sni: data.sni as string | undefined,
      network: (data.net as string | undefined) as NormalizedProxyConfig['network'],
      wsPath: data.path as string | undefined,
      wsHeaders: getVmessWsHeaders(data),
      extra: data,
    },
  };
}

function parseSsUri(uri: string): ParsedNodeRaw | null {
  // ss://BASE64@host:port#name or ss://BASE64(method:pass@host:port)#name
  const hashIdx = uri.indexOf('#');
  const name = hashIdx >= 0 ? decodeURIComponent(uri.slice(hashIdx + 1)) : 'SS';
  const main = hashIdx >= 0 ? uri.slice(5, hashIdx) : uri.slice(5);

  let server: string;
  let port: number;
  let method: string;
  let password: string;

  if (main.includes('@')) {
    // ss://BASE64(method:pass)@host:port
    const atIdx = main.lastIndexOf('@');
    const credPart = main.slice(0, atIdx);
    const hostPart = main.slice(atIdx + 1);

    let creds: string;
    try {
      creds = atob(credPart);
    } catch {
      creds = credPart;
    }

    const colonIdx = creds.indexOf(':');
    method = creds.slice(0, colonIdx);
    password = creds.slice(colonIdx + 1);

    const lastColon = hostPart.lastIndexOf(':');
    server = hostPart.slice(0, lastColon);
    port = parseInt(hostPart.slice(lastColon + 1), 10);
  } else {
    // ss://BASE64
    let decoded: string;
    try {
      decoded = atob(main);
    } catch {
      return null;
    }
    const atIdx = decoded.lastIndexOf('@');
    const creds = decoded.slice(0, atIdx);
    const hostPart = decoded.slice(atIdx + 1);
    const colonIdx = creds.indexOf(':');
    method = creds.slice(0, colonIdx);
    password = creds.slice(colonIdx + 1);
    const lastColon = hostPart.lastIndexOf(':');
    server = hostPart.slice(0, lastColon);
    port = parseInt(hostPart.slice(lastColon + 1), 10);
  }

  if (!server || !port) return null;

  const rawConfig = { method, password };
  return {
    name,
    protocol: 'ss',
    server,
    port,
    ...countryFields(name),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: {
      protocol: 'ss',
      server,
      port,
      password,
      extra: rawConfig,
    },
  };
}

function parseSsrUri(uri: string): ParsedNodeRaw | null {
  const decoded = decodeBase64Url(uri.slice('ssr://'.length));
  if (!decoded) return null;

  const querySeparator = decoded.indexOf('/?');
  const main = querySeparator >= 0 ? decoded.slice(0, querySeparator) : decoded;
  const query = querySeparator >= 0 ? decoded.slice(querySeparator + 2) : '';
  const [server, portValue, ssrProtocol, method, obfs, passwordValue] = main.split(':');
  const port = parseInt(portValue ?? '', 10);
  const password = decodeBase64Url(passwordValue ?? '');
  if (!server || !port || !ssrProtocol || !method || !obfs || !password) return null;

  const params = new URLSearchParams(query);
  const obfsParam = decodeBase64Url(params.get('obfsparam') ?? '') || undefined;
  const protocolParam = decodeBase64Url(params.get('protoparam') ?? '') || undefined;
  const group = decodeBase64Url(params.get('group') ?? '') || undefined;
  const name = decodeBase64Url(params.get('remarks') ?? '') || 'SSR';
  const rawConfig: Record<string, unknown> = {
    method,
    password,
    protocol: ssrProtocol,
    obfs,
    obfsParam,
    protocolParam,
    group,
  };

  return {
    name,
    protocol: 'ssr',
    server,
    port,
    ...countryFields(name),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: {
      protocol: 'ssr',
      server,
      port,
      password,
      extra: rawConfig,
    },
  };
}

function parseTrojanUri(uri: string): ParsedNodeRaw | null {
  const url = new URL(uri.replace('trojan://', 'https://'));
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : 'Trojan';
  const server = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const password = url.username;

  if (!server || !port) return null;

  const rawConfig: Record<string, unknown> = {
    password,
    sni: url.searchParams.get('sni') ?? undefined,
    skipCertVerify: url.searchParams.get('allowInsecure') === '1',
  };

  return {
    name,
    protocol: 'trojan',
    server,
    port,
    ...countryFields(name),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: {
      protocol: 'trojan',
      server,
      port,
      password,
      tls: true,
      sni: rawConfig.sni as string | undefined,
      skipCertVerify: rawConfig.skipCertVerify as boolean,
      extra: rawConfig,
    },
  };
}

function decodeBase64Url(value: string): string {
  if (!value) return '';
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function parseVlessUri(uri: string): ParsedNodeRaw | null {
  const url = new URL(uri.replace('vless://', 'https://'));
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : 'VLESS';
  const server = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const uuid = url.username;

  if (!server || !port) return null;

  const rawConfig: Record<string, unknown> = {
    uuid,
    flow: url.searchParams.get('flow') ?? undefined,
    security: url.searchParams.get('security') ?? undefined,
    sni: url.searchParams.get('sni') ?? undefined,
    network: url.searchParams.get('type') ?? 'tcp',
    wsPath: url.searchParams.get('path') ?? undefined,
    publicKey: url.searchParams.get('public-key') ?? url.searchParams.get('publicKey') ?? url.searchParams.get('pbk') ?? undefined,
    shortId: url.searchParams.get('short-id') ?? url.searchParams.get('shortId') ?? url.searchParams.get('sid') ?? undefined,
    skipCertVerify: url.searchParams.get('allowInsecure') === '1' ||
      url.searchParams.get('skip-cert-verify') === 'true',
  };

  return {
    name,
    protocol: 'vless',
    server,
    port,
    ...countryFields(name),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: buildParsedConfig('vless', server, port, rawConfig),
  };
}

function parseHysteria2Uri(uri: string): ParsedNodeRaw | null {
  const cleaned = uri.replace('hysteria2://', 'https://').replace('hy2://', 'https://');
  const url = new URL(cleaned);
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : 'Hysteria2';
  const server = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const password = url.username || (url.searchParams.get('auth') ?? '');

  if (!server || !port) return null;

  const rawConfig: Record<string, unknown> = {
    password,
    sni: url.searchParams.get('sni') ?? undefined,
    skipCertVerify: url.searchParams.get('insecure') === '1',
  };

  return {
    name,
    protocol: 'hysteria2',
    server,
    port,
    ...countryFields(name),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: {
      protocol: 'hysteria2',
      server,
      port,
      password,
      tls: true,
      sni: rawConfig.sni as string | undefined,
      skipCertVerify: rawConfig.skipCertVerify as boolean,
      extra: rawConfig,
    },
  };
}

const DEFAULT_PORTS: Partial<Record<ProxyProtocol, number>> = {
  anytls: 443,
  trojan: 443,
  vless: 443,
  hysteria: 443,
  hysteria2: 443,
  tuic: 443,
  naive: 443,
  https: 443,
  http: 80,
  socks5: 1080,
  ssh: 22,
  shadowtls: 443,
  wireguard: 51820,
};

function parseGenericUrlUri(uri: string): ParsedNodeRaw | null {
  const scheme = uri.slice(0, uri.indexOf('://'));
  const protocol = schemeToProtocol(scheme);
  if (!protocol) return null;

  const withoutScheme = uri.slice(scheme.length + 3);
  const hashIdx = withoutScheme.indexOf('#');
  const name = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : protocol.toUpperCase();
  const beforeHash = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;
  const qIdx = beforeHash.indexOf('?');
  const hostAndPath = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
  const slashIdx = hostAndPath.indexOf('/');
  const hostPart = slashIdx >= 0 ? hostAndPath.slice(0, slashIdx) : hostAndPath;
  const uriPath = slashIdx >= 0 ? hostAndPath.slice(slashIdx) : '';
  const query = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : '';
  const params = new URLSearchParams(query);

  const atIdx = hostPart.lastIndexOf('@');
  const userinfo = atIdx >= 0 ? hostPart.slice(0, atIdx) : '';
  const hostPort = atIdx >= 0 ? hostPart.slice(atIdx + 1) : hostPart;

  let server: string;
  let port = DEFAULT_PORTS[protocol] ?? 0;
  if (hostPort.startsWith('[')) {
    const closeBracket = hostPort.indexOf(']');
    server = hostPort.slice(1, closeBracket);
    if (hostPort.length > closeBracket + 1) port = parseInt(hostPort.slice(closeBracket + 2), 10);
  } else {
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx >= 0) {
      server = hostPort.slice(0, colonIdx);
      port = parseInt(hostPort.slice(colonIdx + 1), 10);
    } else {
      server = hostPort;
    }
  }

  if (!server || !port) return null;

  let username: string | undefined;
  let password: string | undefined;
  let uuid: string | undefined;

  if (protocol === 'vless') {
    uuid = decodeURIComponent(userinfo);
  } else if (protocol === 'tuic') {
    const colonIdx = userinfo.indexOf(':');
    uuid = decodeURIComponent(userinfo.slice(0, colonIdx));
    password = decodeURIComponent(userinfo.slice(colonIdx + 1));
  } else if (protocol === 'socks5' || protocol === 'http' || protocol === 'https' || protocol === 'ssh' || protocol === 'naive') {
    if (userinfo.includes(':')) {
      const colonIdx = userinfo.indexOf(':');
      username = decodeURIComponent(userinfo.slice(0, colonIdx));
      password = decodeURIComponent(userinfo.slice(colonIdx + 1));
    } else if (userinfo) {
      username = decodeURIComponent(userinfo);
    }
  } else if (userinfo) {
    password = decodeURIComponent(userinfo);
  }

  const tls =
    protocol === 'https' ||
    protocol === 'hysteria' ||
    protocol === 'hysteria2' ||
    protocol === 'anytls' ||
    protocol === 'shadowtls' ||
    protocol === 'naive' ||
    params.get('security') === 'tls' ||
    params.get('security') === 'reality' ||
    params.get('tls') === '1';
  const skipCertVerify =
    params.get('allowInsecure') === '1' ||
    params.get('allowInsecure') === 'true' ||
    params.get('insecure') === '1' ||
    params.get('insecure') === 'true' ||
    params.get('skip-cert-verify') === 'true';

  const rawConfig: Record<string, unknown> = {};
  params.forEach((value, key) => {
    rawConfig[key] = value;
  });
  Object.assign(rawConfig, {
    username,
    password,
    uuid,
    tls,
    sni: params.get('sni') ?? params.get('peer') ?? params.get('host') ?? undefined,
    skipCertVerify,
    network: params.get('type') ?? params.get('network') ?? 'tcp',
    wsPath: params.get('path') ?? (uriPath && uriPath !== '/' ? uriPath : undefined),
    privateKey: params.get('private-key') ?? params.get('privateKey') ?? password,
    publicKey: params.get('public-key') ?? params.get('publicKey') ?? params.get('peer-public-key') ?? params.get('pbk') ?? undefined,
    shortId: params.get('short-id') ?? params.get('shortId') ?? params.get('sid') ?? undefined,
    presharedKey: params.get('pre-shared-key') ?? params.get('presharedKey') ?? undefined,
    ip: params.get('address') ?? params.get('ip') ?? undefined,
    alpn: params.get('alpn') ?? undefined,
    fingerprint: params.get('fp') ?? params.get('fingerprint') ?? undefined,
  });

  return {
    name,
    protocol,
    server,
    port,
    ...countryFields(name),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: buildParsedConfig(protocol, server, port, rawConfig),
  };
}

function schemeToProtocol(scheme: string): ProxyProtocol | null {
  return URI_SCHEME_TO_PROTOCOL[scheme] ?? null;
}

function buildParsedConfig(
  protocol: ProxyProtocol,
  server: string,
  port: number,
  raw: Record<string, unknown>
): NormalizedProxyConfig {
  return buildStructuredProxyConfig(protocol, server, port, raw);
}

function getVmessWsHeaders(data: Record<string, unknown>): Record<string, string> | undefined {
  const host = (data.host as string | undefined) ?? (data.sni as string | undefined)
  return host ? { Host: host } : undefined
}

export default app;
