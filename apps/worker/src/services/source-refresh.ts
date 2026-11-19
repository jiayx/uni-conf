import { newId, now } from '../db/helpers';
import {
  extractSourceNodeGroupMarkerKey,
  parseSourceNodeGroupKey,
  SOURCE_FORMATS,
  MAX_SOURCE_CONTENT_BYTES,
  proxyConnectionFingerprint,
  stableJsonStringify,
} from '@uni-conf/shared';
import type {
  ProxyProtocol,
  NormalizedProxyConfig,
  SourceFormat,
  SourceNodeGroup,
  SourceRefreshResult,
} from '@uni-conf/types';
import type { SourceImportDiffItem } from '@uni-conf/types';
import { ensureZeroSetupDefaults } from './zero-setup';
import { safeRemoteFetch } from './safe-remote-fetch';
import {
  discoverSourceRemoteRuleSets,
  prepareSourceRuleSetUpdates,
  syncSourceLinkedRemoteRuleSets,
} from './source-rule-sets';
import { DEFAULT_WORKSPACE_ID } from './workspaces';
import { type ParsedNodeRaw, filterUsableParsedContent, detectAndParse } from './source-parser';

export class SourceRefreshError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 422 | 502
  ) {
    super(message);
  }
}

export async function refreshSourceById(
  db: D1Database,
  id: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
  options: { reconcileDefaults?: boolean } = {},
): Promise<SourceRefreshResult> {
  const row = await db.prepare('SELECT * FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();

  if (!row) throw new SourceRefreshError('Source not found', 404);
  if (row.type !== 'url') {
    throw new SourceRefreshError('Only URL subscription sources can be refreshed', 400);
  }
  if (!row.url) throw new SourceRefreshError('Source has no URL to fetch', 400);

  const revision = Number(row.refresh_revision);
  try {
    const { rawContent, subscriptionInfo } = await fetchSubscription(String(row.url), row.user_agent as string | null);
    return await applyParsedSourceContent(db, id, rawContent, subscriptionInfo, row.format, {
      reconcileDefaults: options.reconcileDefaults,
      refresh: { revision, url: String(row.url) },
    }, workspaceId);
  } catch (error) {
    if (!(error instanceof SourceRefreshError && error.status === 409)) {
      await db.prepare(
        'UPDATE sources SET last_refresh_error = ?, updated_at = ? WHERE id = ? AND refresh_revision = ?'
      ).bind(error instanceof Error ? error.message : String(error), now(), id, revision).run();
    }
    throw error;
  }
}

async function fetchSubscription(url: string, userAgent: string | null) {
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
    const response = await safeRemoteFetch(fetch, url, {
      headers: {
        'User-Agent': userAgent ?? defaultUserAgent,
        Accept: '*/*',
      },
    }, { timeoutMs: 15_000 });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    subscriptionInfo = parseSubscriptionUserInfo(response.headers.get('subscription-userinfo'));
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_SOURCE_CONTENT_BYTES) {
      throw new SourceRefreshError('Source content exceeds the 4 MiB size limit', 422);
    }
    const limitedContent = await readLimitedSourceContent(response, MAX_SOURCE_CONTENT_BYTES);
    if (limitedContent === null) {
      throw new SourceRefreshError('Source content exceeds the 4 MiB size limit', 422);
    }
    rawContent = limitedContent;
  } catch (err) {
    if (err instanceof SourceRefreshError) throw err;
    throw new SourceRefreshError(`Failed to fetch URL: ${String(err)}`, 502);
  }

  return { rawContent, subscriptionInfo };
}

/**
 * Imports a source from pasted/uploaded config content instead of fetching a URL.
 * Reuses the same parse -> diff -> upsert -> group-sync pipeline as refreshSourceById,
 * so file/clipboard sources behave identically to URL sources once content is available.
 */
export async function importSourceFromContent(
  db: D1Database,
  id: string,
  rawContent: string,
  sourceFormatInput: unknown,
  options: { nodeImportMode?: 'all' | 'new-only'; allowEmptyNewOnly?: boolean } = {},
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<SourceRefreshResult> {
  const ts = now();
  // Preserve the raw content even if parsing below fails to find usable nodes.
  await cacheFetchedSourceContent(db, id, rawContent, {}, ts);
  await syncSourceLinkedRemoteRuleSets(db, id, ts, workspaceId);
  return applyParsedSourceContent(db, id, rawContent, {}, sourceFormatInput, options, workspaceId);
}

async function applyParsedSourceContent(
  db: D1Database,
  id: string,
  rawContent: string,
  subscriptionInfo: {
    uploadBytes?: number;
    downloadBytes?: number;
    totalBytes?: number;
    expireTime?: number;
  },
  sourceFormatInput: unknown,
  options: {
    nodeImportMode?: 'all' | 'new-only';
    allowEmptyNewOnly?: boolean;
    refresh?: { revision: number; url: string };
    reconcileDefaults?: boolean;
  } = {},
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<SourceRefreshResult> {
  // Detect format and parse nodes
  const sourceFormat = isValidSourceFormat(sourceFormatInput) ? sourceFormatInput : 'auto';
  const { nodes: rawParsedNodes, groups: rawParsedGroups, format } = detectAndParse(rawContent, sourceFormat);
  const filteredContent = filterUsableParsedContent(
    rawParsedNodes,
    rawParsedGroups
  );
  let parsedNodes = filteredContent.nodes;
  let parsedGroups = filteredContent.groups;
  const excludedCount = filteredContent.excludedCount;
  let skippedExistingCount = 0;
  if (options.nodeImportMode === 'new-only') {
    const filtered = await filterNewImportNodes(db, id, parsedNodes, workspaceId);
    parsedNodes = filtered.nodes;
    skippedExistingCount = filtered.skippedCount;
    const importedNames = new Set(parsedNodes.map((node) => node.name));
    parsedGroups = parsedGroups
      .map((group) => ({ ...group, memberNames: group.memberNames.filter((name) => importedNames.has(name)) }))
      .filter((group) => group.memberNames.length > 0);
  }
  const canApplyEmptyNewOnly = options.nodeImportMode === 'new-only'
    && options.allowEmptyNewOnly
    && filteredContent.nodes.length > 0;
  if (parsedNodes.length === 0 && !canApplyEmptyNewOnly) {
    throw new SourceRefreshError(
      options.nodeImportMode === 'new-only'
        ? 'No new nodes remain after applying the import mode'
        : `No usable proxy nodes parsed from source content (detected format: ${format}, excluded: ${excludedCount})`,
      422
    );
  }

  // Load existing nodes for this source to compute diff
  const { results: existingRows } = await db.prepare(
    'SELECT id, name, server, port, protocol, country, country_code, tags, raw_config, parsed_config, enabled FROM nodes WHERE source_id = ? AND is_manual = 0'
  )
    .bind(id)
    .all<{
      id: string;
      name: string;
      server: string;
      port: number;
      protocol: string;
      country: string | null;
      enabled: number;
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
  const nodeIdByName = new Map<string, string>();
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
      if (existing.enabled) nodeIdByName.set(node.name, existing.id);
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
  const statements: D1PreparedStatement[] = [];

  if (options.refresh) {
    // The database trigger aborts this entire batch if a competing refresh committed first.
    statements.push(db.prepare('UPDATE sources SET refresh_revision = ? WHERE id = ? AND workspace_id = ?')
      .bind(options.refresh.revision + 1, id, workspaceId));
    const candidates = discoverSourceRemoteRuleSets(rawContent, sourceFormat, options.refresh.url);
    statements.push(...await prepareSourceRuleSetUpdates(db, id, ts, workspaceId, candidates));
  }

  // Insert added nodes
  for (const node of addedNodes) {
    const nodeId = newId();
    nodeIdByName.set(node.name, nodeId);
    statements.push(db.prepare(
      `INSERT INTO nodes (id, source_id, name, protocol, server, port, country, country_code, enabled, tags, notes, raw_config, parsed_config, is_manual, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, 0, ?, ?, ?)`
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
        JSON.stringify(node.tags),
        JSON.stringify(node.rawConfig),
        JSON.stringify(node.parsedConfig),
        ts,
        ts,
        workspaceId
      ));
  }

  // Update existing nodes when their stable subscription identity still matches.
  for (const item of updatedNodes) {
    statements.push(db.prepare(
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
        JSON.stringify(item.node.tags),
        JSON.stringify(item.node.rawConfig),
        JSON.stringify(item.node.parsedConfig),
        ts,
        item.id
      ));
  }

  // Delete removed nodes
  for (const rem of toRemove) {
    statements.push(db.prepare('DELETE FROM nodes WHERE id = ?').bind(rem.id));
  }

  const nodeCount = existingRows.length - toRemove.length + addedNodes.length;

  statements.push(db.prepare(
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
      JSON.stringify(parsedGroups),
      rawContent,
      ts,
      id
    ));

  statements.push(...await prepareSourceGroupUpdates(db, id, parsedGroups, nodeIdByName, ts, workspaceId));
  try {
    await db.batch(statements);
  } catch (error) {
    if (error instanceof Error && error.message.includes('stale source refresh')) {
      throw new SourceRefreshError('Another refresh already updated this source', 409);
    }
    throw error;
  }
  if (options.reconcileDefaults !== false) {
    await ensureZeroSetupDefaults(db, ts, workspaceId);
  }

  return {
    sourceId: id,
    success: true,
    nodeCount,
    addedCount: addedNodes.length,
    updatedCount: updatedNodes.length,
    removedCount: toRemove.length,
    excludedCount,
    skippedExistingCount,
    sourceGroupCount: parsedGroups.length,
    format,
  };
}

async function prepareSourceGroupUpdates(
  db: D1Database,
  sourceId: string,
  groups: SourceNodeGroup[],
  nodeIdByName: Map<string, string>,
  ts: string,
  workspaceId: string
): Promise<D1PreparedStatement[]> {
  const { results: collections } = await db.prepare(
    "SELECT id, node_ids, notes, empty_selection FROM collections WHERE workspace_id = ? AND notes IS NOT NULL AND notes != ''"
  )
    .bind(workspaceId)
    .all<{ id: string; node_ids: string | null; notes: string | null; empty_selection: number }>();
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
    const nextNodeIds = JSON.stringify([...new Set(nodeIds)]);
    if (collection.node_ids === nextNodeIds && Boolean(collection.empty_selection) === (nodeIds.length === 0)) continue;

    statements.push(
      db.prepare('UPDATE collections SET node_ids = ?, updated_at = ?, empty_selection = ? WHERE id = ?')
        .bind(nextNodeIds, ts, nodeIds.length ? 0 : 1, collection.id)
    );
  }

  return statements;
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

export interface NodeDiffRow {
  name: string;
  server: string;
  port: number;
  protocol: string;
  parsed_config?: string | null;
  parsedConfig?: NormalizedProxyConfig;
}

interface NodeDiffIndexes {
  byExact: Map<string, NodeDiffRow[]>;
  byName: Map<string, NodeDiffRow>;
  byEndpoint: Map<string, NodeDiffRow>;
}

export function createNodeDiffIndexes(rows: NodeDiffRow[]): NodeDiffIndexes {
  const indexes: NodeDiffIndexes = {
    byExact: new Map(),
    byName: new Map(),
    byEndpoint: new Map(),
  };
  for (const row of rows) {
    const exactKey = nodeDiffExactKey(row);
    indexes.byExact.set(exactKey, [...(indexes.byExact.get(exactKey) ?? []), row]);
    if (!indexes.byName.has(row.name)) indexes.byName.set(row.name, row);
    const endpoint = nodeDiffEndpointKey(row);
    if (!indexes.byEndpoint.has(endpoint)) indexes.byEndpoint.set(endpoint, row);
  }
  return indexes;
}

export function classifyNodeImport(
  node: NodeDiffRow,
  indexes: NodeDiffIndexes,
  seenIncoming: Map<string, Set<string>>
): Pick<SourceImportDiffItem, 'status' | 'changes'> {
  const exactKey = nodeDiffExactKey(node);
  const fingerprint = nodeDiffConfigFingerprint(node);
  const incomingFingerprints = seenIncoming.get(exactKey) ?? new Set<string>();
  const exactRows = indexes.byExact.get(exactKey) ?? [];
  if (exactRows.some((row) => nodeDiffConfigFingerprint(row) === fingerprint) || incomingFingerprints.has(fingerprint)) {
    incomingFingerprints.add(fingerprint);
    seenIncoming.set(exactKey, incomingFingerprints);
    return { status: 'duplicate', changes: [] };
  }
  const hasIncomingIdentityConflict = incomingFingerprints.size > 0;
  incomingFingerprints.add(fingerprint);
  seenIncoming.set(exactKey, incomingFingerprints);

  if (exactRows.length > 0 || hasIncomingIdentityConflict) {
    return {
      status: 'conflict',
      changes: [{ field: 'configuration', before: 'stored', after: 'imported' }],
    };
  }

  const existing = indexes.byName.get(node.name) ?? indexes.byEndpoint.get(nodeDiffEndpointKey(node));
  if (!existing) return { status: 'new', changes: [] };
  const changes = [
    existing.name !== node.name ? { field: 'name', before: existing.name, after: node.name } : null,
    existing.server !== node.server ? { field: 'server', before: existing.server, after: node.server } : null,
    Number(existing.port) !== node.port ? { field: 'port', before: String(existing.port), after: String(node.port) } : null,
    existing.protocol !== node.protocol ? { field: 'protocol', before: existing.protocol, after: node.protocol } : null,
  ].filter((item): item is { field: string; before: string; after: string } => item !== null);
  return { status: 'conflict', changes };
}

async function filterNewImportNodes(
  db: D1Database,
  sourceId: string,
  nodes: ParsedNodeRaw[],
  workspaceId: string
): Promise<{ nodes: ParsedNodeRaw[]; skippedCount: number }> {
  const { results: existingRows } = await db.prepare(
    'SELECT name, server, port, protocol, parsed_config FROM nodes WHERE workspace_id = ? AND (source_id IS NULL OR source_id != ?)'
  ).bind(workspaceId, sourceId).all<NodeDiffRow>();
  const indexes = createNodeDiffIndexes(existingRows);
  const seenIncoming = new Map<string, Set<string>>();
  const nextNodes = nodes.filter((node) => classifyNodeImport(node, indexes, seenIncoming).status === 'new');
  return { nodes: nextNodes, skippedCount: nodes.length - nextNodes.length };
}

export function nodeDiffExactKey(node: { name: string; server: string; port: number; protocol: string }): string {
  return [node.name, node.server, String(node.port), node.protocol].join('\u0000');
}

function nodeDiffEndpointKey(node: { server: string; port: number }): string {
  return `${node.server}\u0000${node.port}`;
}

function nodeDiffConfigFingerprint(node: NodeDiffRow): string {
  if (node.parsedConfig) return stableJsonString(node.parsedConfig);
  if (!node.parsed_config) return '';
  try {
    return stableJsonString(JSON.parse(node.parsed_config));
  } catch {
    return node.parsed_config;
  }
}

function stableJsonString(value: unknown): string {
  return stableJsonStringify(value);
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function readLimitedSourceContent(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) {
    const text = await response.text();
    return utf8ByteLength(text) <= maxBytes ? text : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
    (existing.tags ?? '[]') !== JSON.stringify(next.tags) ||
    existing.raw_config !== JSON.stringify(next.rawConfig) ||
    existing.parsed_config !== JSON.stringify(next.parsedConfig);
}

function nodeIdentityKey(node: {
  protocol: ProxyProtocol | string;
  server: string;
  port: number;
  parsedConfig?: NormalizedProxyConfig | Record<string, unknown> | string | null;
  parsed_config?: string | null;
  rawConfig?: Record<string, unknown> | string | null;
  raw_config?: string | null;
}): string {
  return proxyConnectionFingerprint({
    protocol: node.protocol,
    server: node.server,
    port: node.port,
    parsedConfig: node.parsedConfig ?? node.parsed_config,
    rawConfig: node.rawConfig ?? node.raw_config,
  });
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

const SOURCE_FORMAT_SET: ReadonlySet<SourceFormat> = new Set(SOURCE_FORMATS);
export function isValidSourceFormat(value: unknown): value is SourceFormat {
  return SOURCE_FORMAT_SET.has(value as SourceFormat);
}
