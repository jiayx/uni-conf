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
  decodeBase64UrlUtf8,
  detectCountry,
  extractSourceNodeGroupMarkerKey,
  getProxyLinkUriScheme,
  isSubscriptionInfoNodeName,
  parseProxyUrlParts,
  parseSourceNodeGroupKey,
  SOURCE_FORMATS,
  getRuleCompatibilityForPayload,
  MAX_SOURCE_CONTENT_BYTES,
  parseSingboxWireGuardEndpoint,
} from '@uni-conf/shared';
import { MIHOMO_TYPE_TO_PROTOCOL, SINGBOX_TYPE_TO_PROTOCOL, URI_SCHEME_TO_PROTOCOL } from '@uni-conf/types';
import type { ProxyProtocol, NormalizedProxyConfig, RuleType, SourceFormat, SourceImportConflictResolution, SourceImportRun, SourceNodeGroup, SourceRefreshResult, SourceStructuredImportSummary, SourceType } from '@uni-conf/types';
import type { SourceImportDiffItem, SourceImportDiffSection, SourceImportPreview } from '@uni-conf/types';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import { isUsableProxyProtocol, missingRequiredProtocolFields } from '../services/protocol-validation';
import { isSafeRemoteHttpUrl, safeRemoteFetch } from '../services/safe-remote-fetch';
import { validateOptionalBooleanFields } from '../services/request-validation';

const app = new Hono<{ Bindings: Env }>();

// ─── List all sources ─────────────────────────────────────────────────────────

app.get('/', async (c) => {

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, type, url, format, enabled, node_count, last_updated,
      last_refresh_error,
      update_interval, user_agent, notes, tags, source_groups,
      upload_bytes, download_bytes, total_bytes, expire_time,
      created_at, updated_at
     FROM sources
     WHERE type <> 'manual'
     ORDER BY created_at DESC`
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
  if (sourceType !== 'url') {
    return c.json({ success: false, error: 'subscription source creation only accepts URL sources' }, 400);
  }
  const booleanError = validateOptionalBooleanFields(body, ['enabled', 'refreshAfterCreate']);
  if (booleanError) return c.json({ success: false, error: booleanError }, 400);
  const format = body.format ?? 'auto';
  if (!isValidSourceFormat(format)) {
    return c.json({ success: false, error: 'invalid source format' }, 400);
  }
  const normalizedUrl = normalizeHttpUrl(body.url);
  if (sourceType === 'url' && !body.url) {
    return c.json({ success: false, error: 'url is required' }, 400);
  }
  if (sourceType === 'url' && !normalizedUrl) {
    return c.json({ success: false, error: 'url must be a public http(s) URL' }, 400);
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

// ─── Import source from pasted/uploaded config content ─────────────────────────
// Reuses the same node/group parsing pipeline as URL subscriptions (Clash/Mihomo
// YAML, sing-box JSON, raw URI lines, Base64) so an existing config can be split
// into a source + nodes + node groups without requiring a reachable URL.

app.post('/import', async (c) => {
  const body = await c.req.json<{
    name?: string;
    content?: string;
    format?: string;
    notes?: string;
    tags?: string[];
    importStructured?: boolean;
    nodeImportMode?: 'all' | 'new-only';
    structuredConflictResolutions?: unknown;
  }>();

  const booleanError = validateOptionalBooleanFields(body, ['importStructured']);
  if (booleanError) return c.json({ success: false, error: booleanError }, 400);
  const rawContent = typeof body.content === 'string' ? body.content : '';
  if (utf8ByteLength(rawContent) > MAX_SOURCE_CONTENT_BYTES) {
    return c.json({ success: false, error: 'source content exceeds the 4 MiB size limit' }, 413);
  }
  const content = rawContent.trim();
  if (!content) {
    return c.json({ success: false, error: 'content is required' }, 400);
  }
  const format = body.format ?? 'auto';
  if (!isValidSourceFormat(format)) {
    return c.json({ success: false, error: 'invalid source format' }, 400);
  }
  if (body.nodeImportMode !== undefined && body.nodeImportMode !== 'all' && body.nodeImportMode !== 'new-only') {
    return c.json({ success: false, error: 'invalid node import mode' }, 400);
  }
  const conflictResolutions = normalizeStructuredConflictResolutions(body.structuredConflictResolutions);
  if (!conflictResolutions.valid) {
    return c.json({ success: false, error: conflictResolutions.error }, 400);
  }
  const sourceFields = validateSourceMutableFields(body);
  if (!sourceFields.valid) {
    return c.json({ success: false, error: sourceFields.error }, 400);
  }
  if (body.nodeImportMode === 'new-only') {
    const nodeDiff = await buildNodeImportDiff(c.env.DB, content, format);
    if (nodeDiff.counts.new === 0) {
      return c.json({ success: false, error: 'No new nodes remain after applying the import mode' }, 409);
    }
  }
  let structuredOnlyPreview: SourceImportPreview | undefined;
  const parsedPreview = previewParsedSourceContent(content, format);
  if (parsedPreview.nodeCount === 0 && body.importStructured) {
    await ensureSourceZeroSetupState(c.env.DB, now());
    const reconciled = await reconcileStructuredImportPreview(c.env.DB, content, parsedPreview);
    if (hasImportableStructuredCandidates(reconciled)) structuredOnlyPreview = reconciled;
  }

  const id = newId();
  const importRunId = newId();
  const ts = now();
  const sourceName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Imported Config';
  const nodeImportMode = body.nodeImportMode ?? 'all';

  await c.env.DB.batch([c.env.DB.prepare(
    `INSERT INTO sources (id, name, type, url, format, enabled, node_count, last_updated, update_interval, user_agent, notes, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      sourceName,
      'clipboard',
      null,
      format,
      1,
      sourceFields.updateInterval ?? 0,
      sourceFields.userAgent ?? null,
      sourceFields.notes ?? null,
      jsonStringify(sourceFields.tags ?? []),
      ts,
      ts
    )
  , c.env.DB.prepare(
    `INSERT INTO source_import_runs
      (id, source_id, source_name, format, node_import_mode, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`
  ).bind(importRunId, id, sourceName, format, nodeImportMode, ts)]);

  let refresh: SourceRefreshResult | undefined;
  let refreshError: string | undefined;
  if (structuredOnlyPreview) {
    refresh = await persistStructuredOnlySourceContent(c.env.DB, id, content, structuredOnlyPreview, ts);
  } else {
    try {
      refresh = await importSourceFromContent(c.env.DB, id, content, format, {
        nodeImportMode,
      });
    } catch (err) {
      refreshError = err instanceof Error ? err.message : String(err);
      await recordSourceRefreshError(c.env.DB, id, refreshError);
    }
  }
  await ensureSourceZeroSetupState(c.env.DB, ts);
  let structuredImport: StructuredImportSummary | undefined;
  let structuredUndoChanges: StructuredImportUndoChange[] = [];
  let structuredImportError: string | undefined;
  if (body.importStructured) {
    try {
      const execution = await importStructuredSourceContent(
        c.env.DB, id, content, format, ts, conflictResolutions.value
      );
      structuredImport = execution.summary;
      structuredUndoChanges = execution.undoChanges;
    } catch (err) {
      structuredImportError = err instanceof Error ? err.message : String(err);
    }
  }
  const completedAt = now();
  const importRun = await completeSourceImportRun(c.env.DB, {
    id: importRunId,
    sourceId: id,
    sourceName,
    format,
    nodeImportMode,
    refresh,
    refreshError,
    structuredImport,
    structuredUndoChanges,
    structuredImportError,
    createdAt: ts,
    completedAt,
  });

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({
    success: true,
    data: { source: mapSource(row!), refresh, refreshError, structuredImport, structuredImportError, importRun },
  }, 201);
});

app.post('/import/preview', async (c) => {
  const body = await c.req.json<{ content?: string; format?: string }>();
  const rawContent = typeof body.content === 'string' ? body.content : '';
  if (utf8ByteLength(rawContent) > MAX_SOURCE_CONTENT_BYTES) {
    return c.json({ success: false, error: 'source content exceeds the 4 MiB size limit' }, 413);
  }
  const content = rawContent.trim();
  if (!content) return c.json({ success: false, error: 'content is required' }, 400);
  const format = body.format ?? 'auto';
  if (!isValidSourceFormat(format)) return c.json({ success: false, error: 'invalid source format' }, 400);

  let preview = previewParsedSourceContent(content, format);
  await ensureSourceZeroSetupState(c.env.DB, now());
  preview = await reconcileStructuredImportPreview(c.env.DB, content, preview);
  if (preview.nodeCount === 0 && !hasImportableStructuredCandidates(preview)) {
    return c.json({
      success: false,
      error: `No usable proxy nodes parsed from source content (detected format: ${preview.detectedFormat}, excluded: ${preview.excludedCount})`,
    }, 422);
  }
  return c.json({ success: true, data: preview });
});

app.get('/imports', async (c) => {
  await recoverStaleSourceImportRuns(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM source_import_runs
     ORDER BY created_at DESC
     LIMIT 50`
  ).all<Record<string, unknown>>();
  return c.json({ success: true, data: results.map(mapSourceImportRun) });
});

app.post('/imports/:runId/nodes/preview', async (c) => {
  await recoverStaleSourceImportRuns(c.env.DB);
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
    .bind(runId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status !== 'partial' || typeof run.refresh_error !== 'string' || !run.source_id) {
    return c.json({ success: false, error: 'Node import is not retryable' }, 409);
  }
  const source = await c.env.DB.prepare('SELECT raw_content, format FROM sources WHERE id = ?')
    .bind(String(run.source_id))
    .first<{ raw_content: string | null; format: string }>();
  const content = source?.raw_content?.trim() ?? '';
  if (!source || !content) return c.json({ success: false, error: 'Imported source content is unavailable' }, 409);
  if (utf8ByteLength(content) > MAX_SOURCE_CONTENT_BYTES) {
    return c.json({ success: false, error: 'Stored source content exceeds the 4 MiB size limit' }, 422);
  }
  const format = isValidSourceFormat(source.format) ? source.format : 'auto';
  let preview = previewParsedSourceContent(content, format);
  if (preview.nodeCount === 0) {
    return c.json({ success: false, error: 'No usable proxy nodes are available to retry' }, 422);
  }
  await ensureSourceZeroSetupState(c.env.DB, now());
  preview = await reconcileStructuredImportPreview(c.env.DB, content, preview, String(run.source_id));
  return c.json({ success: true, data: preview });
});

app.post('/imports/:runId/nodes/retry', async (c) => {
  await recoverStaleSourceImportRuns(c.env.DB);
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
    .bind(runId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status !== 'partial' || typeof run.refresh_error !== 'string' || !run.source_id) {
    return c.json({ success: false, error: 'Node import is not retryable' }, 409);
  }
  const source = await c.env.DB.prepare('SELECT raw_content, format FROM sources WHERE id = ?')
    .bind(String(run.source_id))
    .first<{ raw_content: string | null; format: string }>();
  const content = source?.raw_content?.trim() ?? '';
  if (!source || !content) return c.json({ success: false, error: 'Imported source content is unavailable' }, 409);
  if (utf8ByteLength(content) > MAX_SOURCE_CONTENT_BYTES) {
    return c.json({ success: false, error: 'Stored source content exceeds the 4 MiB size limit' }, 422);
  }
  const format = isValidSourceFormat(source.format) ? source.format : 'auto';
  if (previewParsedSourceContent(content, format).nodeCount === 0) {
    return c.json({ success: false, error: 'No usable proxy nodes are available to retry' }, 422);
  }
  const ts = now();
  const claim = await c.env.DB.prepare(
    `UPDATE source_import_runs SET status = 'running', completed_at = ?
     WHERE id = ? AND status = 'partial' AND refresh_error = ?`
  ).bind(ts, runId, run.refresh_error).run();
  if (Number(claim.meta?.changes ?? 0) === 0) {
    return c.json({ success: false, error: 'Node import retry is already running' }, 409);
  }

  try {
    const refresh = await importSourceFromContent(c.env.DB, String(run.source_id), content, format, {
      nodeImportMode: run.node_import_mode === 'new-only' ? 'new-only' : 'all',
      allowEmptyNewOnly: true,
    });
    const status = typeof run.structured_error === 'string' ? 'partial' : 'success';
    await c.env.DB.prepare(
      `UPDATE source_import_runs SET
        status = ?, node_count = ?, added_count = ?, updated_count = ?, skipped_existing_count = ?,
        refresh_error = NULL, completed_at = ?
       WHERE id = ? AND status = 'running'`
    ).bind(
      status,
      refresh.nodeCount,
      refresh.addedCount,
      refresh.updatedCount ?? 0,
      refresh.skippedExistingCount ?? 0,
      now(),
      runId
    ).run();
    const updated = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
      .bind(runId)
      .first<Record<string, unknown>>();
    return c.json({ success: true, data: { importRun: mapSourceImportRun(updated!), refresh } });
  } catch {
    await c.env.DB.prepare(
      `UPDATE source_import_runs SET status = 'partial', refresh_error = ?, completed_at = ?
       WHERE id = ? AND status = 'running'`
    ).bind('Node import failed', now(), runId).run();
    return c.json({ success: false, error: 'Node import retry failed' }, 502);
  }
});

app.post('/imports/:runId/structured/preview', async (c) => {
  await recoverStaleSourceImportRuns(c.env.DB);
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
    .bind(runId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status !== 'partial' || typeof run.structured_error !== 'string' || !run.source_id) {
    return c.json({ success: false, error: 'Structured import is not retryable' }, 409);
  }
  const source = await c.env.DB.prepare('SELECT raw_content, format FROM sources WHERE id = ?')
    .bind(String(run.source_id))
    .first<{ raw_content: string | null; format: string }>();
  const content = source?.raw_content?.trim() ?? '';
  if (!source || !content) return c.json({ success: false, error: 'Imported source content is unavailable' }, 409);
  if (utf8ByteLength(content) > MAX_SOURCE_CONTENT_BYTES) {
    return c.json({ success: false, error: 'Stored source content exceeds the 4 MiB size limit' }, 422);
  }
  const format = isValidSourceFormat(source.format) ? source.format : 'auto';
  await ensureSourceZeroSetupState(c.env.DB, now());
  const preview = await reconcileStructuredImportPreview(
    c.env.DB,
    content,
    previewParsedSourceContent(content, format)
  );
  return c.json({ success: true, data: preview });
});

app.post('/imports/:runId/structured/retry', async (c) => {
  await recoverStaleSourceImportRuns(c.env.DB);
  const runId = c.req.param('runId');
  const body = await c.req.json<{ structuredConflictResolutions?: unknown }>();
  const conflictResolutions = normalizeStructuredConflictResolutions(body.structuredConflictResolutions);
  if (!conflictResolutions.valid) {
    return c.json({ success: false, error: conflictResolutions.error }, 400);
  }
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
    .bind(runId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status !== 'partial' || typeof run.structured_error !== 'string' || !run.source_id) {
    return c.json({ success: false, error: 'Structured import is not retryable' }, 409);
  }
  const source = await c.env.DB.prepare('SELECT raw_content, format FROM sources WHERE id = ?')
    .bind(String(run.source_id))
    .first<{ raw_content: string | null; format: string }>();
  const content = source?.raw_content?.trim() ?? '';
  if (!source || !content) return c.json({ success: false, error: 'Imported source content is unavailable' }, 409);
  if (utf8ByteLength(content) > MAX_SOURCE_CONTENT_BYTES) {
    return c.json({ success: false, error: 'Stored source content exceeds the 4 MiB size limit' }, 422);
  }
  const format = isValidSourceFormat(source.format) ? source.format : 'auto';
  const ts = now();
  const claim = await c.env.DB.prepare(
    `UPDATE source_import_runs SET status = 'running', completed_at = ?
     WHERE id = ? AND status = 'partial' AND structured_error = ?`
  ).bind(ts, runId, run.structured_error).run();
  if (Number(claim.meta?.changes ?? 0) === 0) {
    return c.json({ success: false, error: 'Structured import retry is already running' }, 409);
  }

  try {
    await ensureSourceZeroSetupState(c.env.DB, ts);
    const execution = await importStructuredSourceContent(
      c.env.DB,
      String(run.source_id),
      content,
      format,
      ts,
      conflictResolutions.value
    );
    const priorChanges = parseStructuredUndoChanges(
      typeof run.structured_changes === 'string' ? run.structured_changes : null
    );
    const changes = [...priorChanges, ...execution.undoChanges];
    const conflictCount = execution.summary.conflictingRules
      + execution.summary.conflictingRemoteRuleSets
      + changes.length;
    const status = typeof run.refresh_error === 'string' ? 'partial' : 'success';
    await c.env.DB.prepare(
      `UPDATE source_import_runs SET
        status = ?, rule_count = ?, remote_rule_set_count = ?, skipped_rule_count = ?, conflict_count = ?,
        structured_error = NULL, structured_changes = ?, completed_at = ?
       WHERE id = ? AND status = 'running'`
    ).bind(
      status,
      execution.summary.rules,
      execution.summary.remoteRuleSets,
      execution.summary.skippedRules,
      conflictCount,
      jsonStringify(changes),
      now(),
      runId
    ).run();
    const updated = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
      .bind(runId)
      .first<Record<string, unknown>>();
    return c.json({
      success: true,
      data: { importRun: mapSourceImportRun(updated!), structuredImport: execution.summary },
    });
  } catch {
    await c.env.DB.prepare(
      `UPDATE source_import_runs SET status = 'partial', structured_error = ?, completed_at = ?
       WHERE id = ? AND status = 'running'`
    ).bind('Structured rule import failed', now(), runId).run();
    return c.json({ success: false, error: 'Structured rule import retry failed' }, 502);
  }
});

app.post('/imports/:runId/undo', async (c) => {
  await recoverStaleSourceImportRuns(c.env.DB);
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
    .bind(runId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status === 'undone' || !run.source_id) {
    return c.json({ success: false, error: 'Import run has already been undone' }, 409);
  }
  const deleted = await deleteSourceById(c.env.DB, String(run.source_id));
  if (!deleted) return c.json({ success: false, error: 'Imported source no longer exists' }, 409);
  const updated = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
    .bind(runId)
    .first<Record<string, unknown>>();
  return c.json({ success: true, data: mapSourceImportRun(updated!) });
});

// ─── Get source ───────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {

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
  if (existing.type === 'manual') {
    return c.json({ success: false, error: 'The manual node source is managed internally' }, 403);
  }

  const body = await c.req.json<Record<string, unknown>>();
  if (body.type !== undefined) {
    return c.json({ success: false, error: 'source type cannot be changed' }, 400);
  }
  const booleanError = validateOptionalBooleanFields(body, ['enabled']);
  if (booleanError) return c.json({ success: false, error: booleanError }, 400);
  const ts = now();
  const nextType = String(existing.type);
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
    return c.json({ success: false, error: 'url must be a public http(s) URL' }, 400);
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
  const existing = await c.env.DB.prepare('SELECT type FROM sources WHERE id = ?')
    .bind(id)
    .first<{ type: SourceType }>();
  if (!existing) return c.json({ success: false, error: 'Source not found' }, 404);
  if (existing.type === 'manual') {
    return c.json({ success: false, error: 'The manual node source is managed internally' }, 403);
  }
  const deleted = await deleteSourceById(c.env.DB, id);
  if (!deleted) return c.json({ success: false, error: 'Source could not be deleted' }, 409);
  return c.json({ success: true, data: { id } });
});

export async function deleteSourceById(db: D1Database, id: string, ts = now()): Promise<boolean> {
  const existing = await db.prepare('SELECT id, type FROM sources WHERE id = ?')
    .bind(id)
    .first<{ id: string; type: SourceType }>();

  if (!existing || existing.type === 'manual') return false;

  const marker = structuredImportMarker(id);
  const { results: importRunRows } = await db.prepare(
    `SELECT structured_changes FROM source_import_runs
     WHERE source_id = ? AND status != 'undone'`
  ).bind(id).all<{ structured_changes: string | null }>();
  const restoreStatements: D1PreparedStatement[] = [];
  for (const change of importRunRows.flatMap((row) => parseStructuredUndoChanges(row.structured_changes))) {
    if (change.kind === 'rule') {
      restoreStatements.push(db.prepare(
        `UPDATE rules SET target_group_id = ?, updated_at = ?
         WHERE id = ? AND target_group_id = ? AND EXISTS (SELECT 1 FROM groups WHERE id = ?)`
      ).bind(change.beforeTargetId, ts, change.id, change.appliedTargetId, change.beforeTargetId));
    } else {
      restoreStatements.push(db.prepare(
        `UPDATE remote_rule_sets SET target_group_id = ?, behavior = ?, update_interval = ?, updated_at = ?
         WHERE id = ? AND target_group_id = ? AND behavior = ? AND update_interval = ?
           AND preset_source IS NULL AND EXISTS (SELECT 1 FROM groups WHERE id = ?)`
      ).bind(
        change.beforeTargetId, change.beforeBehavior, change.beforeUpdateInterval, ts, change.id,
        change.appliedTargetId, change.appliedBehavior, change.appliedUpdateInterval, change.beforeTargetId
      ));
    }
  }
  await db.batch([
    ...restoreStatements,
    db.prepare('DELETE FROM rules WHERE notes = ?').bind(marker),
    db.prepare('DELETE FROM remote_rule_sets WHERE notes = ?').bind(marker),
    db.prepare('DELETE FROM nodes WHERE source_id = ?').bind(id),
    db.prepare(
      `UPDATE source_import_runs
       SET status = 'undone', undone_at = ?, completed_at = COALESCE(completed_at, ?)
       WHERE source_id = ? AND status != 'undone'`
    ).bind(ts, ts, id),
    db.prepare('DELETE FROM sources WHERE id = ?').bind(id),
  ]);
  await ensureZeroSetupDefaults(db, ts);
  return true;
}

interface CompleteSourceImportRunInput {
  id: string;
  sourceId: string;
  sourceName: string;
  format: SourceFormat;
  nodeImportMode: 'all' | 'new-only';
  refresh?: SourceRefreshResult;
  refreshError?: string;
  structuredImport?: StructuredImportSummary;
  structuredUndoChanges: StructuredImportUndoChange[];
  structuredImportError?: string;
  createdAt: string;
  completedAt: string;
}

async function completeSourceImportRun(db: D1Database, input: CompleteSourceImportRunInput): Promise<SourceImportRun> {
  const conflictCount = (input.structuredImport?.conflictingRules ?? 0)
    + (input.structuredImport?.conflictingRemoteRuleSets ?? 0)
    + input.structuredUndoChanges.length;
  const status = input.refreshError || input.structuredImportError ? 'partial' : 'success';
  const refreshHistoryError = input.refreshError ? 'Node parsing or persistence failed' : null;
  const structuredHistoryError = input.structuredImportError ? 'Structured rule import failed' : null;
  await db.prepare(
    `UPDATE source_import_runs SET
      status = ?, node_count = ?, added_count = ?, updated_count = ?, skipped_existing_count = ?,
      rule_count = ?, remote_rule_set_count = ?, skipped_rule_count = ?, conflict_count = ?,
      refresh_error = ?, structured_error = ?, structured_changes = ?, completed_at = ?
     WHERE id = ?`
  ).bind(
    status,
    input.refresh?.nodeCount ?? 0,
    input.refresh?.addedCount ?? 0,
    input.refresh?.updatedCount ?? 0,
    input.refresh?.skippedExistingCount ?? 0,
    input.structuredImport?.rules ?? 0,
    input.structuredImport?.remoteRuleSets ?? 0,
    input.structuredImport?.skippedRules ?? 0,
    conflictCount,
    refreshHistoryError,
    structuredHistoryError,
    jsonStringify(input.structuredUndoChanges),
    input.completedAt,
    input.id
  ).run();
  return {
    id: input.id,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    format: input.format,
    nodeImportMode: input.nodeImportMode,
    status,
    nodeCount: input.refresh?.nodeCount ?? 0,
    addedCount: input.refresh?.addedCount ?? 0,
    updatedCount: input.refresh?.updatedCount ?? 0,
    skippedExistingCount: input.refresh?.skippedExistingCount ?? 0,
    ruleCount: input.structuredImport?.rules ?? 0,
    remoteRuleSetCount: input.structuredImport?.remoteRuleSets ?? 0,
    skippedRuleCount: input.structuredImport?.skippedRules ?? 0,
    conflictCount,
    ...(refreshHistoryError ? { refreshError: refreshHistoryError } : {}),
    ...(structuredHistoryError ? { structuredError: structuredHistoryError } : {}),
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    canUndo: true,
  };
}

function mapSourceImportRun(row: Record<string, unknown>): SourceImportRun {
  const sourceId = typeof row.source_id === 'string' ? row.source_id : undefined;
  const status = String(row.status) as SourceImportRun['status'];
  return {
    id: String(row.id),
    ...(sourceId ? { sourceId } : {}),
    sourceName: String(row.source_name),
    format: String(row.format) as SourceFormat,
    nodeImportMode: row.node_import_mode === 'new-only' ? 'new-only' : 'all',
    status,
    nodeCount: Number(row.node_count ?? 0),
    addedCount: Number(row.added_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    skippedExistingCount: Number(row.skipped_existing_count ?? 0),
    ruleCount: Number(row.rule_count ?? 0),
    remoteRuleSetCount: Number(row.remote_rule_set_count ?? 0),
    skippedRuleCount: Number(row.skipped_rule_count ?? 0),
    conflictCount: Number(row.conflict_count ?? 0),
    ...(typeof row.refresh_error === 'string' ? { refreshError: row.refresh_error } : {}),
    ...(typeof row.structured_error === 'string' ? { structuredError: row.structured_error } : {}),
    createdAt: String(row.created_at),
    ...(typeof row.completed_at === 'string' ? { completedAt: row.completed_at } : {}),
    ...(typeof row.undone_at === 'string' ? { undoneAt: row.undone_at } : {}),
    canUndo: Boolean(sourceId) && status !== 'undone',
  };
}

const STALE_SOURCE_IMPORT_RUN_MS = 10 * 60 * 1000;

export async function recoverStaleSourceImportRuns(db: D1Database, recoveredAt = now()): Promise<void> {
  const recoveredAtMs = Date.parse(recoveredAt);
  if (!Number.isFinite(recoveredAtMs)) return;
  const staleBefore = new Date(recoveredAtMs - STALE_SOURCE_IMPORT_RUN_MS).toISOString();
  await db.prepare(
    `UPDATE source_import_runs SET
      status = 'partial',
      refresh_error = CASE
        WHEN structured_error IS NULL THEN COALESCE(refresh_error, 'Import did not complete')
        ELSE refresh_error
      END,
      completed_at = ?
     WHERE status = 'running' AND COALESCE(completed_at, created_at) < ?`
  ).bind(recoveredAt, staleBefore).run();
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
    if (!(err instanceof SourceRefreshError) || err.status >= 422) {
      await recordSourceRefreshError(c.env.DB, id, message);
    }
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
  if (row.type !== 'url') {
    throw new SourceRefreshError('Only URL subscription sources can be refreshed', 400);
  }
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
    const response = await safeRemoteFetch(fetch, row.url as string, {
      headers: {
        'User-Agent': (row.user_agent as string | null) ?? defaultUserAgent,
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
  await cacheFetchedSourceContent(db, id, rawContent, subscriptionInfo, now());

  return applyParsedSourceContent(db, id, rawContent, subscriptionInfo, row.format);
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
  options: { nodeImportMode?: 'all' | 'new-only'; allowEmptyNewOnly?: boolean } = {}
): Promise<SourceRefreshResult> {
  const ts = now();
  // Preserve the raw content even if parsing below fails to find usable nodes.
  await cacheFetchedSourceContent(db, id, rawContent, {}, ts);
  return applyParsedSourceContent(db, id, rawContent, {}, sourceFormatInput, options);
}

async function persistStructuredOnlySourceContent(
  db: D1Database,
  id: string,
  rawContent: string,
  preview: SourceImportPreview,
  ts: string
): Promise<SourceRefreshResult> {
  await db.prepare(
    `UPDATE sources SET
      raw_content = ?, node_count = 0, last_updated = ?, source_groups = '[]',
      last_refresh_error = NULL, updated_at = ?
     WHERE id = ?`
  ).bind(rawContent, ts, ts, id).run();
  return {
    sourceId: id,
    success: true,
    nodeCount: 0,
    addedCount: 0,
    updatedCount: 0,
    removedCount: 0,
    excludedCount: preview.excludedCount,
    skippedExistingCount: 0,
    sourceGroupCount: 0,
    format: preview.detectedFormat,
  };
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
  options: { nodeImportMode?: 'all' | 'new-only'; allowEmptyNewOnly?: boolean } = {}
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
    const filtered = await filterNewImportNodes(db, id, parsedNodes);
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
  const statements: D1PreparedStatement[] = [];

  // Insert added nodes
  for (const node of addedNodes) {
    const nodeId = newId();
    statements.push(db.prepare(
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
        jsonStringify(item.node.tags),
        jsonStringify(item.node.rawConfig),
        jsonStringify(item.node.parsedConfig),
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
      jsonStringify(parsedGroups),
      rawContent,
      ts,
      id
    ));

  await db.batch(statements);

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
    skippedExistingCount,
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
    "SELECT id, node_ids, notes FROM collections WHERE notes IS NOT NULL AND notes != ''"
  )
    .all<{ id: string; node_ids: string | null; notes: string | null }>();
  const sourceCollections = collections.filter((collection) => {
    const key = extractSourceNodeGroupMarkerKey(collection.notes);
    const marker = key ? parseSourceNodeGroupKey(key) : null;
    return marker?.sourceId === sourceId;
  });
  if (sourceCollections.length === 0) return;

  const { results: nodeRows } = await db.prepare(
    'SELECT id, name FROM nodes WHERE source_id = ? AND is_manual = 0 AND enabled = 1'
  )
    .bind(sourceId)
    .all<{ id: string; name: string }>();
  const nodeIdByName = new Map(nodeRows.map((row) => [row.name, row.id]));
  const groupByName = new Map(groups.map((group) => [group.name, group]));
  const statements: D1PreparedStatement[] = [];

  for (const collection of sourceCollections) {
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
  const text = value.trim();
  return isSafeRemoteHttpUrl(text) ? text : undefined;
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
  if (body.userAgent !== undefined && body.userAgent !== null && typeof body.userAgent !== 'string') {
    return { valid: false, error: 'userAgent must be a string or null' };
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return { valid: false, error: 'notes must be a string or null' };
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

  if (looksLikeIniClientConfig(trimmed)) {
    return { nodes: parseClientTextConfigProxies(trimmed), groups: [], format: 'surge' };
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

export function previewParsedSourceContent(rawContent: string, sourceFormat: SourceFormat = 'auto'): SourceImportPreview {
  const parsed = detectAndParse(rawContent, sourceFormat);
  const filtered = filterUsableParsedContent(parsed.nodes, parsed.groups);
  const detectedFormat = resolveStructuredSourceFormat(rawContent, sourceFormat, parsed.format);
  const structured = parseStructuredSourceContent(rawContent, detectedFormat);
  const importedObjects: SourceImportPreview['importedObjects'] = [];
  if (filtered.nodes.length > 0) importedObjects.push('nodes');
  if (filtered.groups.length > 0) importedObjects.push('source-groups');
  if (structured.rules.length > 0) importedObjects.push('rules');
  if (structured.remoteRuleSets.length > 0) importedObjects.push('remote-rule-sets');
  const preservedOnly: SourceImportPreview['preservedOnly'] = [];
  if (structured.skippedRules > 0) preservedOnly.push('rules');
  if (structured.hasDns) preservedOnly.push('dns');
  if (structured.clientSettingKeys.length > 0) preservedOnly.push('client-settings');
  return {
    detectedFormat,
    nodeCount: filtered.nodes.length,
    excludedCount: filtered.excludedCount,
    sourceGroupCount: filtered.groups.length,
    groups: filtered.groups,
    nodes: filtered.nodes.slice(0, 100).map((node) => ({
      name: node.name,
      protocol: node.protocol,
      server: node.server,
      port: node.port,
      country: node.country,
      countryCode: node.countryCode,
      tags: node.tags,
    })),
    importedObjects,
    preservedOnly,
    structured: {
      rules: structured.rules.length,
      remoteRuleSets: structured.remoteRuleSets.length,
      skippedRules: structured.skippedRules,
      duplicateRules: 0,
      duplicateRemoteRuleSets: 0,
      conflictingRules: 0,
      conflictingRemoteRuleSets: 0,
      unmappedTargets: [],
      hasDns: structured.hasDns,
      clientSettingKeys: structured.clientSettingKeys,
    },
    diff: {
      nodes: makeImportDiffSection(filtered.nodes.map((node, index) => ({
        key: `node:${index}:${nodeIdentityKey(node)}`,
        label: node.name,
        status: 'new',
        changes: [],
      }))),
      rules: makeImportDiffSection(structured.rules.map((rule, index) => ({
        key: `rule:${index}:${structuredRuleBaseKey(rule.type, rule.payload, rule.noResolve)}`,
        label: structuredRuleLabel(rule),
        status: 'new',
        target: rule.target,
        changes: [],
      }))),
      remoteRuleSets: makeImportDiffSection(structured.remoteRuleSets.map((set, index) => ({
        key: `remote-rule-set:${index}:${set.url}`,
        label: set.name,
        status: 'new',
        target: set.target,
        changes: [],
      }))),
    },
  };
}

interface StructuredRuleImport {
  type: RuleType;
  payload: string;
  target: string;
  noResolve: boolean;
}

interface StructuredRuleSetImport {
  name: string;
  url: string;
  behavior: 'domain' | 'ipcidr' | 'classical';
  updateInterval: number;
  target: string;
}

interface ParsedStructuredSource {
  rules: StructuredRuleImport[];
  remoteRuleSets: StructuredRuleSetImport[];
  skippedRules: number;
  hasDns: boolean;
  clientSettingKeys: string[];
}

type StructuredImportSummary = Omit<SourceStructuredImportSummary, 'hasDns' | 'clientSettingKeys'>;

type StructuredImportUndoChange =
  | {
      kind: 'rule';
      id: string;
      beforeTargetId: string;
      appliedTargetId: string;
    }
  | {
      kind: 'remote-rule-set';
      id: string;
      beforeTargetId: string;
      beforeBehavior: string;
      beforeUpdateInterval: number;
      appliedTargetId: string;
      appliedBehavior: string;
      appliedUpdateInterval: number;
    };

function parseStructuredUndoChanges(text: string | null): StructuredImportUndoChange[] {
  if (!text) return [];
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StructuredImportUndoChange => {
      if (!isPlainRecord(item) || typeof item.id !== 'string') return false;
      if (item.kind === 'rule') {
        return typeof item.beforeTargetId === 'string' && typeof item.appliedTargetId === 'string';
      }
      return item.kind === 'remote-rule-set'
        && typeof item.beforeTargetId === 'string'
        && typeof item.beforeBehavior === 'string'
        && Number.isInteger(item.beforeUpdateInterval)
        && typeof item.appliedTargetId === 'string'
        && typeof item.appliedBehavior === 'string'
        && Number.isInteger(item.appliedUpdateInterval);
    });
  } catch {
    return [];
  }
}

interface StructuredImportExecution {
  summary: StructuredImportSummary;
  undoChanges: StructuredImportUndoChange[];
}

const STRUCTURED_RULE_TYPES = new Set<RuleType>([
  'DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-REGEX', 'IP-CIDR', 'IP-CIDR6',
  'IP-ASN', 'GEOIP', 'GEOSITE', 'PROCESS-NAME', 'PROCESS-PATH', 'PORT', 'SRC-PORT',
  'SRC-IP-CIDR', 'PROTOCOL', 'NETWORK', 'IN-TYPE', 'SCRIPT',
]);

const CLIENT_SETTING_KEYS = [
  'port', 'socks-port', 'mixed-port', 'redir-port', 'tproxy-port', 'mode', 'ipv6',
  'allow-lan', 'bind-address', 'tun', 'profile', 'hosts',
] as const;

export function parseStructuredSourceContent(rawContent: string, format: SourceFormat): ParsedStructuredSource {
  const empty: ParsedStructuredSource = { rules: [], remoteRuleSets: [], skippedRules: 0, hasDns: false, clientSettingKeys: [] };
  if (format !== 'clash' && format !== 'mihomo') return empty;

  let document: Record<string, unknown>;
  try {
    const parsed = parseYAML(rawContent);
    if (!isPlainRecord(parsed)) return empty;
    document = parsed;
  } catch {
    return empty;
  }

  const rules: StructuredRuleImport[] = [];
  const providerTargets = new Map<string, string>();
  let skippedRules = 0;
  for (const rawRule of Array.isArray(document.rules) ? document.rules : []) {
    if (typeof rawRule !== 'string') { skippedRules++; continue; }
    const parts = rawRule.split(',').map((part) => part.trim()).filter(Boolean);
    const rawType = parts[0]?.toUpperCase();
    if (!rawType) { skippedRules++; continue; }
    if (rawType === 'RULE-SET') {
      const providerName = parts[1];
      const target = parts[2];
      if (providerName && target) providerTargets.set(providerName, target);
      else skippedRules++;
      continue;
    }
    const normalizedType = rawType === 'DST-PORT' ? 'PORT' : rawType;
    if (!STRUCTURED_RULE_TYPES.has(normalizedType as RuleType)) { skippedRules++; continue; }
    const type = normalizedType as RuleType;
    const targetIndex = parts.at(-1)?.toLowerCase() === 'no-resolve' ? parts.length - 2 : parts.length - 1;
    const target = parts[targetIndex];
    const payload = parts.slice(1, targetIndex).join(',');
    if (!target || !payload) { skippedRules++; continue; }
    rules.push({ type, payload, target, noResolve: parts.at(-1)?.toLowerCase() === 'no-resolve' });
  }

  const providers = isPlainRecord(document['rule-providers']) ? document['rule-providers'] : {};
  const remoteRuleSets: StructuredRuleSetImport[] = [];
  for (const [name, rawProvider] of Object.entries(providers)) {
    if (!isPlainRecord(rawProvider) || rawProvider.type !== 'http' || typeof rawProvider.url !== 'string') continue;
    const target = providerTargets.get(name);
    if (!target || !normalizeHttpUrl(rawProvider.url)) continue;
    const behavior = rawProvider.behavior === 'domain' || rawProvider.behavior === 'ipcidr'
      ? rawProvider.behavior
      : 'classical';
    const intervalSeconds = Number(rawProvider.interval);
    remoteRuleSets.push({
      name,
      url: rawProvider.url.trim(),
      behavior,
      updateInterval: Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? Math.max(1, Math.round(intervalSeconds / 3600)) : 24,
      target,
    });
  }

  return {
    rules,
    remoteRuleSets,
    skippedRules,
    hasDns: isPlainRecord(document.dns),
    clientSettingKeys: CLIENT_SETTING_KEYS.filter((key) => document[key] !== undefined),
  };
}

export async function importStructuredSourceContent(
  db: D1Database,
  sourceId: string,
  rawContent: string,
  format: SourceFormat,
  ts: string,
  conflictResolutions: Record<string, SourceImportConflictResolution> = {}
): Promise<StructuredImportExecution> {
  const parsedFormat = detectAndParse(rawContent, format).format;
  const detectedFormat = resolveStructuredSourceFormat(rawContent, format, parsedFormat);
  const parsed = parseStructuredSourceContent(rawContent, detectedFormat);
  const plan = await buildStructuredImportPlan(db, parsed, conflictResolutions);
  const maxRule = await db.prepare('SELECT MAX(sort_order) AS max_order FROM rules').first<{ max_order: number | null }>();
  const maxSet = await db.prepare('SELECT MAX(sort_order) AS max_order FROM remote_rule_sets').first<{ max_order: number | null }>();
  let ruleOrder = (maxRule?.max_order ?? -1) + 1;
  let setOrder = (maxSet?.max_order ?? -1) + 1;
  const marker = structuredImportMarker(sourceId);
  const statements: D1PreparedStatement[] = [];
  const undoCandidates: Array<{ statementIndex: number; change: StructuredImportUndoChange }> = [];

  for (const rule of plan.rules) {
    statements.push(db.prepare(
      `INSERT INTO rules (id, name, type, payload, no_resolve, target_group_id, enabled, sort_order, notes, compatibility, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
    ).bind(
      newId(), `Imported ${rule.type}`, rule.type, rule.payload, rule.noResolve ? 1 : 0, rule.targetId,
      ruleOrder++, marker, jsonStringify(getRuleCompatibilityForPayload(rule.type, rule.payload)), ts, ts
    ));
  }

  for (const set of plan.remoteRuleSets) {
    statements.push(db.prepare(
      `INSERT INTO remote_rule_sets
        (id, name, url, format, behavior, preset_source, preset_id, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at)
       VALUES (?, ?, ?, 'mihomo', ?, NULL, NULL, ?, ?, 1, ?, NULL, ?, ?, ?)`
    ).bind(
      newId(), set.name, set.url, set.behavior, set.targetId, set.updateInterval, setOrder++,
      marker, ts, ts
    ));
  }

  for (const update of plan.ruleUpdates) {
    undoCandidates.push({
      statementIndex: statements.length,
      change: { kind: 'rule', id: update.id, beforeTargetId: update.beforeTargetId, appliedTargetId: update.targetId },
    });
    statements.push(db.prepare(
      'UPDATE rules SET target_group_id = ?, updated_at = ? WHERE id = ? AND target_group_id = ?'
    ).bind(update.targetId, ts, update.id, update.beforeTargetId));
  }

  for (const update of plan.remoteRuleSetUpdates) {
    undoCandidates.push({
      statementIndex: statements.length,
      change: {
        kind: 'remote-rule-set', id: update.id,
        beforeTargetId: update.beforeTargetId,
        beforeBehavior: update.beforeBehavior,
        beforeUpdateInterval: update.beforeUpdateInterval,
        appliedTargetId: update.targetId,
        appliedBehavior: update.behavior,
        appliedUpdateInterval: update.updateInterval,
      },
    });
    statements.push(db.prepare(
      `UPDATE remote_rule_sets SET target_group_id = ?, behavior = ?, update_interval = ?, updated_at = ?
       WHERE id = ? AND target_group_id = ? AND behavior = ? AND update_interval = ? AND preset_source IS NULL`
    ).bind(
      update.targetId, update.behavior, update.updateInterval, ts, update.id,
      update.beforeTargetId, update.beforeBehavior, update.beforeUpdateInterval
    ));
  }

  const results = statements.length > 0 ? await db.batch(statements) : [];
  const appliedChanges = undoCandidates.filter(({ statementIndex }) => Number(results[statementIndex]?.meta?.changes ?? 0) > 0);
  const appliedRuleUpdates = appliedChanges.filter(({ change }) => change.kind === 'rule').length;
  const appliedRemoteRuleSetUpdates = appliedChanges.length - appliedRuleUpdates;
  const failedRuleUpdates = plan.ruleUpdates.length - appliedRuleUpdates;
  const failedRemoteRuleSetUpdates = plan.remoteRuleSetUpdates.length - appliedRemoteRuleSetUpdates;

  return {
    summary: {
      rules: plan.rules.length,
      remoteRuleSets: plan.remoteRuleSets.length,
      skippedRules: plan.skippedRules,
      duplicateRules: plan.duplicateRules,
      duplicateRemoteRuleSets: plan.duplicateRemoteRuleSets,
      conflictingRules: plan.conflictingRules + failedRuleUpdates,
      conflictingRemoteRuleSets: plan.conflictingRemoteRuleSets + failedRemoteRuleSetUpdates,
      unmappedTargets: plan.unmappedTargets,
    },
    undoChanges: appliedChanges.map(({ change }) => change),
  };
}

function resolveStructuredSourceFormat(
  rawContent: string,
  requestedFormat: SourceFormat,
  detectedFormat: SourceFormat
): SourceFormat {
  if (requestedFormat === 'clash' || requestedFormat === 'mihomo') return requestedFormat;
  if (detectedFormat === 'clash' || detectedFormat === 'mihomo') return detectedFormat;
  if (requestedFormat !== 'auto') return detectedFormat;
  try {
    const document = parseYAML(rawContent);
    if (isPlainRecord(document) && (Array.isArray(document.rules) || isPlainRecord(document['rule-providers']))) {
      return 'mihomo';
    }
  } catch {
    // Keep the node parser's detected format for malformed or non-YAML content.
  }
  return detectedFormat;
}

interface StructuredImportPlan {
  rules: Array<StructuredRuleImport & { targetId: string }>;
  remoteRuleSets: Array<StructuredRuleSetImport & { targetId: string }>;
  ruleUpdates: Array<{ id: string; beforeTargetId: string; targetId: string }>;
  remoteRuleSetUpdates: Array<{
    id: string;
    beforeTargetId: string;
    beforeBehavior: string;
    beforeUpdateInterval: number;
    targetId: string;
    behavior: string;
    updateInterval: number;
  }>;
  skippedRules: number;
  duplicateRules: number;
  duplicateRemoteRuleSets: number;
  conflictingRules: number;
  conflictingRemoteRuleSets: number;
  unmappedTargets: string[];
  ruleDiff: SourceImportDiffItem[];
  remoteRuleSetDiff: SourceImportDiffItem[];
}

async function buildStructuredImportPlan(
  db: D1Database,
  parsed: ParsedStructuredSource,
  conflictResolutions: Record<string, SourceImportConflictResolution> = {}
): Promise<StructuredImportPlan> {
  if (parsed.rules.length === 0 && parsed.remoteRuleSets.length === 0) {
    return {
      rules: [],
      remoteRuleSets: [],
      ruleUpdates: [],
      remoteRuleSetUpdates: [],
      skippedRules: parsed.skippedRules,
      duplicateRules: 0,
      duplicateRemoteRuleSets: 0,
      conflictingRules: 0,
      conflictingRemoteRuleSets: 0,
      unmappedTargets: [],
      ruleDiff: [],
      remoteRuleSetDiff: [],
    };
  }

  const [groupResult, ruleResult, ruleSetResult] = await Promise.all([
    db.prepare('SELECT id, name FROM groups WHERE enabled = 1').all<{ id: string; name: string }>(),
    db.prepare('SELECT id, type, payload, no_resolve, target_group_id FROM rules').all<{
      id: string;
      type: string;
      payload: string;
      no_resolve: number;
      target_group_id: string;
    }>(),
    db.prepare('SELECT id, name, url, behavior, update_interval, target_group_id, preset_source FROM remote_rule_sets').all<{
      id: string;
      name: string;
      url: string;
      behavior: string;
      update_interval: number;
      target_group_id: string;
      preset_source: string | null;
    }>(),
  ]);
  const targetIds = new Map(groupResult.results.flatMap((row) => [
    [row.name.trim().toLowerCase(), row.id] as const,
    [row.id.trim().toLowerCase(), row.id] as const,
  ]));
  const targetNamesById = new Map(groupResult.results.map((row) => [row.id, row.name]));
  const knownRulesByBase = new Map<string, Array<{ id: string; targetId: string; targetName: string }>>();
  for (const row of ruleResult.results) {
    const key = structuredRuleBaseKey(row.type, row.payload, Boolean(row.no_resolve));
    const values = knownRulesByBase.get(key) ?? [];
    values.push({ id: row.id, targetId: row.target_group_id, targetName: targetNamesById.get(row.target_group_id) ?? row.target_group_id });
    knownRulesByBase.set(key, values);
  }
  const knownRuleSetsByUrl = new Map<string, Array<{
    id: string;
    targetId: string;
    targetName: string;
    behavior: string;
    updateInterval: number;
    managed: boolean;
  }>>();
  for (const row of ruleSetResult.results) {
    const key = structuredRuleSetBaseKey(row.url);
    const values = knownRuleSetsByUrl.get(key) ?? [];
    values.push({
      id: row.id,
      targetId: row.target_group_id,
      targetName: targetNamesById.get(row.target_group_id) ?? row.target_group_id,
      behavior: row.behavior,
      updateInterval: Number(row.update_interval),
      managed: Boolean(row.preset_source),
    });
    knownRuleSetsByUrl.set(key, values);
  }
  const rules: StructuredImportPlan['rules'] = [];
  const remoteRuleSets: StructuredImportPlan['remoteRuleSets'] = [];
  const ruleUpdates: StructuredImportPlan['ruleUpdates'] = [];
  const remoteRuleSetUpdates: StructuredImportPlan['remoteRuleSetUpdates'] = [];
  const ruleDiff: SourceImportDiffItem[] = [];
  const remoteRuleSetDiff: SourceImportDiffItem[] = [];
  const unmappedTargets = new Set<string>();
  let skippedRules = parsed.skippedRules;
  let duplicateRules = 0;
  let duplicateRemoteRuleSets = 0;
  let conflictingRules = 0;
  let conflictingRemoteRuleSets = 0;

  for (const [index, rule] of parsed.rules.entries()) {
    const diffKey = `rule:${index}:${structuredRuleBaseKey(rule.type, rule.payload, rule.noResolve)}`;
    const targetId = targetIds.get(normalizeImportTarget(rule.target));
    if (!targetId) {
      skippedRules++;
      unmappedTargets.add(rule.target);
      ruleDiff.push({ key: diffKey, label: structuredRuleLabel(rule), status: 'unmapped', target: rule.target, changes: [] });
      continue;
    }
    const baseKey = structuredRuleBaseKey(rule.type, rule.payload, rule.noResolve);
    const existingRules = knownRulesByBase.get(baseKey) ?? [];
    const exact = existingRules.find((item) => item.targetId === targetId);
    if (exact) {
      duplicateRules++;
      ruleDiff.push({ key: diffKey, label: structuredRuleLabel(rule), status: 'duplicate', target: rule.target, changes: [] });
      continue;
    }
    if (existingRules.length > 0) {
      const existing = existingRules[0]!;
      const resolvable = existingRules.length === 1 && Boolean(existing.id);
      if (resolvable && conflictResolutions[diffKey] === 'use-imported') {
        ruleUpdates.push({ id: existing.id, beforeTargetId: existing.targetId, targetId });
      } else {
        conflictingRules++;
      }
      ruleDiff.push({
        key: diffKey,
        label: structuredRuleLabel(rule),
        status: 'conflict',
        target: rule.target,
        changes: [{ field: 'target', before: existing.targetName, after: rule.target }],
        resolvable,
      });
      continue;
    }
    knownRulesByBase.set(baseKey, [{ id: '', targetId, targetName: targetNamesById.get(targetId) ?? rule.target }]);
    rules.push({ ...rule, targetId });
    ruleDiff.push({ key: diffKey, label: structuredRuleLabel(rule), status: 'new', target: rule.target, changes: [] });
  }

  for (const [index, set] of parsed.remoteRuleSets.entries()) {
    const diffKey = `remote-rule-set:${index}:${set.url}`;
    const targetId = targetIds.get(normalizeImportTarget(set.target));
    if (!targetId) {
      skippedRules++;
      unmappedTargets.add(set.target);
      remoteRuleSetDiff.push({ key: diffKey, label: set.name, status: 'unmapped', target: set.target, changes: [] });
      continue;
    }
    const baseKey = structuredRuleSetBaseKey(set.url);
    const existingSets = knownRuleSetsByUrl.get(baseKey) ?? [];
    const exact = existingSets.find((item) =>
      item.targetId === targetId
      && item.behavior === set.behavior
      && item.updateInterval === set.updateInterval
    );
    if (exact) {
      duplicateRemoteRuleSets++;
      remoteRuleSetDiff.push({ key: diffKey, label: set.name, status: 'duplicate', target: set.target, changes: [] });
      continue;
    }
    if (existingSets.length > 0) {
      const existing = existingSets[0]!;
      const resolvable = existingSets.length === 1 && Boolean(existing.id) && !existing.managed;
      if (resolvable && conflictResolutions[diffKey] === 'use-imported') {
        remoteRuleSetUpdates.push({
          id: existing.id,
          beforeTargetId: existing.targetId,
          beforeBehavior: existing.behavior,
          beforeUpdateInterval: existing.updateInterval,
          targetId,
          behavior: set.behavior,
          updateInterval: set.updateInterval,
        });
      } else {
        conflictingRemoteRuleSets++;
      }
      const changes = [
        existing.targetId !== targetId ? { field: 'target', before: existing.targetName, after: set.target } : null,
        existing.behavior !== set.behavior ? { field: 'behavior', before: existing.behavior, after: set.behavior } : null,
        existing.updateInterval !== set.updateInterval
          ? { field: 'updateInterval', before: String(existing.updateInterval), after: String(set.updateInterval) }
          : null,
      ].filter((item): item is NonNullable<typeof item> => item !== null);
      remoteRuleSetDiff.push({ key: diffKey, label: set.name, status: 'conflict', target: set.target, changes, resolvable });
      continue;
    }
    knownRuleSetsByUrl.set(baseKey, [{
      id: '',
      targetId,
      targetName: targetNamesById.get(targetId) ?? set.target,
      behavior: set.behavior,
      updateInterval: set.updateInterval,
      managed: false,
    }]);
    remoteRuleSets.push({ ...set, targetId });
    remoteRuleSetDiff.push({ key: diffKey, label: set.name, status: 'new', target: set.target, changes: [] });
  }

  return {
    rules,
    remoteRuleSets,
    ruleUpdates,
    remoteRuleSetUpdates,
    skippedRules,
    duplicateRules,
    duplicateRemoteRuleSets,
    conflictingRules,
    conflictingRemoteRuleSets,
    unmappedTargets: [...unmappedTargets].sort((a, b) => a.localeCompare(b)),
    ruleDiff,
    remoteRuleSetDiff,
  };
}

async function reconcileStructuredImportPreview(
  db: D1Database,
  rawContent: string,
  preview: SourceImportPreview,
  excludeNodeSourceId?: string
): Promise<SourceImportPreview> {
  const parsed = parseStructuredSourceContent(rawContent, preview.detectedFormat);
  const [plan, nodeDiff] = await Promise.all([
    buildStructuredImportPlan(db, parsed),
    buildNodeImportDiff(db, rawContent, preview.detectedFormat, excludeNodeSourceId),
  ]);
  const importedObjects: SourceImportPreview['importedObjects'] = preview.importedObjects
    .filter((item) => item !== 'rules' && item !== 'remote-rule-sets');
  if (plan.rules.length > 0) importedObjects.push('rules');
  if (plan.remoteRuleSets.length > 0) importedObjects.push('remote-rule-sets');
  const preservedOnly: SourceImportPreview['preservedOnly'] = preview.preservedOnly
    .filter((item) => item !== 'rules');
  if ((plan.skippedRules > 0 || plan.conflictingRules > 0) && !preservedOnly.includes('rules')) preservedOnly.unshift('rules');
  if (plan.conflictingRemoteRuleSets > 0 && !preservedOnly.includes('remote-rule-sets')) preservedOnly.push('remote-rule-sets');

  return {
    ...preview,
    importedObjects,
    preservedOnly,
    structured: {
      ...preview.structured,
      rules: plan.rules.length,
      remoteRuleSets: plan.remoteRuleSets.length,
      skippedRules: plan.skippedRules,
      duplicateRules: plan.duplicateRules,
      duplicateRemoteRuleSets: plan.duplicateRemoteRuleSets,
      conflictingRules: plan.conflictingRules,
      conflictingRemoteRuleSets: plan.conflictingRemoteRuleSets,
      unmappedTargets: plan.unmappedTargets,
    },
    diff: {
      nodes: nodeDiff,
      rules: makeImportDiffSection(plan.ruleDiff),
      remoteRuleSets: makeImportDiffSection(plan.remoteRuleSetDiff),
    },
  };
}

function hasImportableStructuredCandidates(preview: SourceImportPreview): boolean {
  const sections = [preview.diff.rules, preview.diff.remoteRuleSets];
  return sections.some((section) => section.counts.new + section.counts.duplicate + section.counts.conflict > 0);
}

function structuredImportMarker(sourceId: string): string {
  return `[uni-conf:import] source:${sourceId}`;
}

function normalizeImportTarget(target: string): string {
  return target.trim().toLowerCase();
}

function structuredRuleBaseKey(type: string, payload: string, noResolve: boolean): string {
  return [type.toUpperCase(), payload.trim(), noResolve ? '1' : '0'].join('\u0000');
}

function structuredRuleSetBaseKey(url: string): string {
  return url.trim();
}

function structuredRuleLabel(rule: Pick<StructuredRuleImport, 'type' | 'payload'>): string {
  return rule.payload ? `${rule.type},${rule.payload}` : rule.type;
}

const MAX_IMPORT_DIFF_ITEMS = 100;

function makeImportDiffSection(items: SourceImportDiffItem[]): SourceImportDiffSection {
  const counts = items.reduce<SourceImportDiffSection['counts']>(
    (result, item) => ({ ...result, [item.status]: result[item.status] + 1 }),
    { new: 0, duplicate: 0, conflict: 0, unmapped: 0 }
  );
  return {
    total: items.length,
    items: items.slice(0, MAX_IMPORT_DIFF_ITEMS),
    truncated: items.length > MAX_IMPORT_DIFF_ITEMS,
    counts,
  };
}

async function buildNodeImportDiff(
  db: D1Database,
  rawContent: string,
  format: SourceFormat,
  excludeSourceId?: string
): Promise<SourceImportDiffSection> {
  const parsed = detectAndParse(rawContent, format);
  const nodes = filterUsableParsedContent(parsed.nodes, parsed.groups).nodes;
  if (nodes.length === 0) return makeImportDiffSection([]);

  const query = excludeSourceId
    ? 'SELECT name, server, port, protocol, parsed_config FROM nodes WHERE source_id IS NULL OR source_id != ?'
    : 'SELECT name, server, port, protocol, parsed_config FROM nodes';
  const statement = db.prepare(query);
  const { results: existingRows } = excludeSourceId
    ? await statement.bind(excludeSourceId).all<NodeDiffRow>()
    : await statement.all<NodeDiffRow>();
  const indexes = createNodeDiffIndexes(existingRows);

  const seenIncoming = new Map<string, Set<string>>();
  const items = nodes.map((node, index): SourceImportDiffItem => {
    const exactKey = nodeDiffExactKey(node);
    const key = `node:${index}:${exactKey}`;
    const classification = classifyNodeImport(node, indexes, seenIncoming);
    return { key, label: node.name, ...classification };
  });

  return makeImportDiffSection(items);
}

interface NodeDiffRow {
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

function createNodeDiffIndexes(rows: NodeDiffRow[]): NodeDiffIndexes {
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

function classifyNodeImport(
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
  nodes: ParsedNodeRaw[]
): Promise<{ nodes: ParsedNodeRaw[]; skippedCount: number }> {
  const { results: existingRows } = await db.prepare(
    'SELECT name, server, port, protocol, parsed_config FROM nodes WHERE source_id IS NULL OR source_id != ?'
  ).bind(sourceId).all<NodeDiffRow>();
  const indexes = createNodeDiffIndexes(existingRows);
  const seenIncoming = new Map<string, Set<string>>();
  const nextNodes = nodes.filter((node) => classifyNodeImport(node, indexes, seenIncoming).status === 'new');
  return { nodes: nextNodes, skippedCount: nodes.length - nextNodes.length };
}

function nodeDiffExactKey(node: { name: string; server: string; port: number; protocol: string }): string {
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
  if (Array.isArray(value)) return `[${value.map(stableJsonString).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonString(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
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

function normalizeStructuredConflictResolutions(value: unknown):
  | { valid: true; value: Record<string, SourceImportConflictResolution> }
  | { valid: false; error: string } {
  if (value === undefined) return { valid: true, value: {} };
  if (!isPlainRecord(value)) return { valid: false, error: 'structured conflict resolutions must be an object' };
  const entries = Object.entries(value);
  if (entries.length > MAX_IMPORT_DIFF_ITEMS) {
    return { valid: false, error: `structured conflict resolutions cannot exceed ${MAX_IMPORT_DIFF_ITEMS} items` };
  }
  const result = Object.create(null) as Record<string, SourceImportConflictResolution>;
  for (const [key, resolution] of entries) {
    if (key.length === 0 || key.length > 1000 || (!key.startsWith('rule:') && !key.startsWith('remote-rule-set:'))) {
      return { valid: false, error: 'invalid structured conflict resolution key' };
    }
    if (resolution !== 'keep-existing' && resolution !== 'use-imported') {
      return { valid: false, error: 'invalid structured conflict resolution value' };
    }
    result[key] = resolution;
  }
  return { valid: true, value: result };
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

  if (format === 'shadowrocket') {
    return {
      nodes: parseShadowrocketTextConfigProxies(trimmed),
      groups: [],
      format,
    };
  }

  if (format === 'surge' || format === 'loon' || format === 'quantumultx') {
    return {
      nodes: parseClientTextConfigProxies(trimmed),
      groups: [],
      format,
    };
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

      const protocol = clashTypeToProtocol(typeStr, proxyObj);
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
  } catch {
    // Invalid imported content is reported through the preview/import result.
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

function clashTypeToProtocol(type: string, proxy?: Record<string, unknown>): ProxyProtocol {
  if (type === 'http' && hasNativeTls(proxy)) return 'https';
  return MIHOMO_TYPE_TO_PROTOCOL[type] ?? (type === 'hy2' ? 'hysteria2' : 'unknown');
}

function parseSingboxJson(data: Record<string, unknown>): ParsedNodeRaw[] {
  const nodes: ParsedNodeRaw[] = [];
  const outbounds = data.outbounds as Array<Record<string, unknown>> | undefined;

  const proxyTypes = new Set([
    'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic',
    'anytls', 'socks', 'http', 'ssh', 'shadowtls',
  ]);

  if (Array.isArray(outbounds)) {
    for (const ob of outbounds) {
      const type = (ob.type as string | undefined)?.toLowerCase() ?? '';
      if (!proxyTypes.has(type)) continue;

      const name = (ob.tag as string | null) ?? 'Unknown';
      const server = (ob.server as string | null) ?? '';
      const port = (ob.server_port as number | null) ?? 0;
      if (!server || !port) continue;

      const protocol = singboxTypeToProtocol(type, ob);
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
  }

  const endpoints = data.endpoints as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(endpoints)) {
    for (const endpoint of endpoints) {
      const parsed = parseSingboxWireGuardEndpoint(endpoint);
      if (!parsed) continue;
      nodes.push({
        ...parsed,
        protocol: 'wireguard',
        ...countryFields(parsed.name),
        ...recognitionTags(parsed.name),
      });
    }
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

function looksLikeIniClientConfig(content: string): boolean {
  return /^\s*\[(Proxy|Proxy Group|General|Remote Proxy|Rule|server_local)\]/im.test(content);
}

function parseClientTextConfigProxies(content: string): ParsedNodeRaw[] {
  const iniNodes = parseIniClientProxies(content);
  const quantumultXNodes = extractIniSection(content, 'server_local').length > 0
    ? parseRawLines(extractIniSection(content, 'server_local'))
    : [];
  return [...iniNodes, ...quantumultXNodes];
}

function parseShadowrocketTextConfigProxies(content: string): ParsedNodeRaw[] {
  const sectionNodes = parseClientTextConfigProxies(content);
  if (sectionNodes.length > 0) return sectionNodes;
  return parseRawLines(content.split('\n').filter((line) => line.trim().length > 0));
}

function parseIniClientProxies(content: string): ParsedNodeRaw[] {
  const proxyLines = extractIniSection(content, 'Proxy');
  return proxyLines
    .map(parseIniProxyLine)
    .filter((node): node is ParsedNodeRaw => node !== null);
}

function extractIniSection(content: string, sectionName: string): string[] {
  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    const section = trimmed.match(/^\[([^\]]+)\]$/);
    if (section) {
      inSection = section[1]?.trim().toLowerCase() === sectionName.toLowerCase();
      continue;
    }

    if (inSection) result.push(trimmed);
  }

  return result;
}

function parseIniProxyLine(line: string): ParsedNodeRaw | null {
  const separatorIndex = line.indexOf('=');
  if (separatorIndex <= 0) return null;

  const name = line.slice(0, separatorIndex).trim();
  const parts = splitCommaList(line.slice(separatorIndex + 1));
  const type = parts[0]?.trim().toLowerCase();
  const server = parts[1]?.trim();
  const port = parseInt(parts[2]?.trim() ?? '', 10);
  if (!name || !type || !server || !port) return null;

  const rawConfig = parseIniProxyOptions(parts.slice(3));
  const protocol = iniTypeToProtocol(type, rawConfig);
  if (protocol === 'unknown') return null;

  if (rawConfig.password === undefined && rawConfig.pass !== undefined) rawConfig.password = rawConfig.pass;
  if (rawConfig.username === undefined && rawConfig.user !== undefined) rawConfig.username = rawConfig.user;
  if (rawConfig.method === undefined && rawConfig['encrypt-method'] !== undefined) rawConfig.method = rawConfig['encrypt-method'];
  if (rawConfig.cipher === undefined && rawConfig.method !== undefined) rawConfig.cipher = rawConfig.method;

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

function splitCommaList(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of value) {
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      current += char;
      continue;
    }
    if (quote === char) {
      quote = null;
      current += char;
      continue;
    }
    if (char === ',' && quote === null) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function parseIniProxyOptions(parts: string[]): Record<string, unknown> {
  const rawConfig: Record<string, unknown> = {};
  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = trimQuotes(part.slice(separatorIndex + 1).trim());
    rawConfig[key] = coerceIniValue(value);
  }
  return rawConfig;
}

function trimQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceIniValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function hasNativeTls(config?: Record<string, unknown>): boolean {
  if (!config) return false;
  const tls = config.tls;
  if (tls === true || tls === 1 || tls === '1' || tls === 'true' || tls === 'tls') return true;
  const security = config.security;
  if (security === 'tls' || security === 'reality') return true;
  const nestedTls = config.tls;
  if (nestedTls && typeof nestedTls === 'object' && !Array.isArray(nestedTls)) {
    return (nestedTls as Record<string, unknown>).enabled === true;
  }
  return false;
}

function iniTypeToProtocol(type: string, rawConfig?: Record<string, unknown>): ProxyProtocol {
  if (type === 'http' && hasNativeTls(rawConfig)) return 'https';
  if (type === 'socks5' || type === 'socks') return 'socks5';
  if (type === 'hy2') return 'hysteria2';
  return MIHOMO_TYPE_TO_PROTOCOL[type] ?? URI_SCHEME_TO_PROTOCOL[type] ?? 'unknown';
}

function isMihomoBuiltinPolicyName(name: string): boolean {
  return ['DIRECT', 'REJECT'].includes(name.toUpperCase());
}

function isSingboxBuiltinOutboundName(name: string): boolean {
  return ['direct', 'block'].includes(name.toLowerCase());
}

function singboxTypeToProtocol(type: string, outbound?: Record<string, unknown>): ProxyProtocol {
  if (type === 'http' && hasNativeTls(outbound)) return 'https';
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
  try {
    return decodeBase64UrlUtf8(value);
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

function parseGenericUrlUri(uri: string): ParsedNodeRaw | null {
  const scheme = uri.slice(0, uri.indexOf('://'));
  const protocol = schemeToProtocol(scheme);
  if (!protocol) return null;

  const parts = parseProxyUrlParts(uri, scheme, protocol, protocol.toUpperCase());
  if (!parts) return null;
  const { name, params, port, server, uriPath, userinfo } = parts;

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
