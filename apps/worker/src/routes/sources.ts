import { Hono } from 'hono';
import { load as parseYAML } from 'js-yaml';
import type { Env } from '../types';
import { mapSource, newId, now } from '../db/helpers';
import {
  getSubscriptionUrlName,
  getRuleCompatibilityForPayload,
  MAX_SOURCE_CONTENT_BYTES,
} from '@uni-conf/shared';
import type {
  RuleType,
  SourceFormat,
  SourceImportConflictResolution,
  SourceImportRun,
  SourceRefreshResult,
  SourceStructuredImportSummary,
  SourceType,
} from '@uni-conf/types';
import type { SourceImportDiffItem, SourceImportDiffSection, SourceImportPreview } from '@uni-conf/types';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import { isSafeRemoteHttpUrl } from '../services/safe-remote-fetch';
import { validateOptionalBooleanFields } from '../services/request-validation';
import { listSourceRemoteRuleSets } from '../services/source-rule-sets';
import { DEFAULT_WORKSPACE_ID, requestWorkspaceId } from '../services/workspaces';
import { filterUsableParsedContent, detectAndParse, isPlainRecord } from '../services/source-parser';
import {
  SourceRefreshError,
  refreshSourceById,
  importSourceFromContent,
  recordSourceRefreshError,
  type NodeDiffRow,
  createNodeDiffIndexes,
  classifyNodeImport,
  nodeDiffExactKey,
  utf8ByteLength,
  isValidSourceFormat,
} from '../services/source-refresh';

const app = new Hono<{ Bindings: Env }>();

// ─── List all sources ─────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, type, url, format, enabled, node_count, last_updated,
      last_refresh_error,
      update_interval, user_agent, notes, tags, source_groups,
      upload_bytes, download_bytes, total_bytes, expire_time,
      created_at, updated_at
     FROM sources
     WHERE workspace_id = ? AND type <> 'manual'
     ORDER BY created_at DESC`
  ).bind(workspaceId).all();
  const sources = (results as Record<string, unknown>[]).map(mapSource);
  return c.json({ success: true, data: sources });
});

// ─── Create source ─────────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const workspaceId = requestWorkspaceId(c);
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
    `INSERT INTO sources (id, name, type, url, format, enabled, node_count, last_updated, update_interval, user_agent, notes, tags, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?)`
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
      JSON.stringify(sourceFields.tags ?? []),
      ts,
      ts,
      workspaceId
    )
    .run();

  let refresh: SourceRefreshResult | undefined;
  let refreshError: string | undefined;
  const shouldRefreshAfterCreate = body.refreshAfterCreate !== false && sourceType === 'url' && Boolean(body.url);
  if (shouldRefreshAfterCreate) {
    try {
      refresh = await refreshSourceById(c.env.DB, id, workspaceId);
    } catch (err) {
      refreshError = err instanceof Error ? err.message : String(err);
    }
  }
  await ensureSourceZeroSetupState(c.env.DB, ts, workspaceId);

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: { source: mapSource(row!), refresh, refreshError } }, 201);
});

async function ensureSourceZeroSetupState(db: D1Database, ts: string, workspaceId: string): Promise<void> {
  await ensureZeroSetupDefaults(db, ts, workspaceId);
}

// ─── Import source from pasted/uploaded config content ─────────────────────────
// Reuses the same node/group parsing pipeline as URL subscriptions (Clash/Mihomo
// YAML, sing-box JSON, raw URI lines, Base64) so an existing config can be split
// into a source + nodes + node groups without requiring a reachable URL.

app.post('/import', async (c) => {
  const workspaceId = requestWorkspaceId(c);
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
    const nodeDiff = await buildNodeImportDiff(c.env.DB, content, format, workspaceId);
    if (nodeDiff.counts.new === 0) {
      return c.json({ success: false, error: 'No new nodes remain after applying the import mode' }, 409);
    }
  }
  let structuredOnlyPreview: SourceImportPreview | undefined;
  const parsedPreview = previewParsedSourceContent(content, format);
  if (parsedPreview.nodeCount === 0 && body.importStructured) {
    await ensureSourceZeroSetupState(c.env.DB, now(), workspaceId);
    const reconciled = await reconcileStructuredImportPreview(c.env.DB, content, parsedPreview, workspaceId);
    if (hasImportableStructuredCandidates(reconciled)) structuredOnlyPreview = reconciled;
  }

  const id = newId();
  const importRunId = newId();
  const ts = now();
  const sourceName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Imported Config';
  const nodeImportMode = body.nodeImportMode ?? 'all';

  await c.env.DB.batch([c.env.DB.prepare(
    `INSERT INTO sources (id, name, type, url, format, enabled, node_count, last_updated, update_interval, user_agent, notes, tags, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?)`
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
      JSON.stringify(sourceFields.tags ?? []),
      ts,
      ts,
      workspaceId
    )
  , c.env.DB.prepare(
    `INSERT INTO source_import_runs
      (id, source_id, source_name, format, node_import_mode, status, created_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`
  ).bind(importRunId, id, sourceName, format, nodeImportMode, ts, workspaceId)]);

  let refresh: SourceRefreshResult | undefined;
  let refreshError: string | undefined;
  if (structuredOnlyPreview) {
    refresh = await persistStructuredOnlySourceContent(c.env.DB, id, content, structuredOnlyPreview, ts);
  } else {
    try {
      refresh = await importSourceFromContent(c.env.DB, id, content, format, {
        nodeImportMode,
      }, workspaceId);
    } catch (err) {
      refreshError = err instanceof Error ? err.message : String(err);
      await recordSourceRefreshError(c.env.DB, id, refreshError);
    }
  }
  await ensureSourceZeroSetupState(c.env.DB, ts, workspaceId);
  let structuredImport: StructuredImportSummary | undefined;
  let structuredUndoChanges: StructuredImportUndoChange[] = [];
  let structuredImportError: string | undefined;
  if (body.importStructured) {
    try {
      const execution = await importStructuredSourceContent(
        c.env.DB, id, content, format, ts, conflictResolutions.value, workspaceId
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

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();

  return c.json({
    success: true,
    data: { source: mapSource(row!), refresh, refreshError, structuredImport, structuredImportError, importRun },
  }, 201);
});

app.post('/import/preview', async (c) => {
  const workspaceId = requestWorkspaceId(c);
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
  await ensureSourceZeroSetupState(c.env.DB, now(), workspaceId);
  preview = await reconcileStructuredImportPreview(c.env.DB, content, preview, workspaceId);
  if (preview.nodeCount === 0 && !hasImportableStructuredCandidates(preview)) {
    return c.json({
      success: false,
      error: `No usable proxy nodes parsed from source content (detected format: ${preview.detectedFormat}, excluded: ${preview.excludedCount})`,
    }, 422);
  }
  return c.json({ success: true, data: preview });
});

app.get('/imports', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  await recoverStaleSourceImportRuns(c.env.DB, now(), workspaceId);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM source_import_runs
     WHERE workspace_id = ?
     ORDER BY created_at DESC
     LIMIT 50`
  ).bind(workspaceId).all<Record<string, unknown>>();
  return c.json({ success: true, data: results.map(mapSourceImportRun) });
});

app.post('/imports/:runId/nodes/preview', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  await recoverStaleSourceImportRuns(c.env.DB, now(), workspaceId);
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ? AND workspace_id = ?')
    .bind(runId, workspaceId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status !== 'partial' || typeof run.refresh_error !== 'string' || !run.source_id) {
    return c.json({ success: false, error: 'Node import is not retryable' }, 409);
  }
  const source = await c.env.DB.prepare('SELECT raw_content, format FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(String(run.source_id), workspaceId)
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
  await ensureSourceZeroSetupState(c.env.DB, now(), workspaceId);
  preview = await reconcileStructuredImportPreview(c.env.DB, content, preview, workspaceId, String(run.source_id));
  return c.json({ success: true, data: preview });
});

app.post('/imports/:runId/nodes/retry', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  await recoverStaleSourceImportRuns(c.env.DB, now(), workspaceId);
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ? AND workspace_id = ?')
    .bind(runId, workspaceId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status !== 'partial' || typeof run.refresh_error !== 'string' || !run.source_id) {
    return c.json({ success: false, error: 'Node import is not retryable' }, 409);
  }
  const source = await c.env.DB.prepare('SELECT raw_content, format FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(String(run.source_id), workspaceId)
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
    }, workspaceId);
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
  const workspaceId = requestWorkspaceId(c);
  await recoverStaleSourceImportRuns(c.env.DB, now(), workspaceId);
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ? AND workspace_id = ?')
    .bind(runId, workspaceId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status !== 'partial' || typeof run.structured_error !== 'string' || !run.source_id) {
    return c.json({ success: false, error: 'Structured import is not retryable' }, 409);
  }
  const source = await c.env.DB.prepare('SELECT raw_content, format FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(String(run.source_id), workspaceId)
    .first<{ raw_content: string | null; format: string }>();
  const content = source?.raw_content?.trim() ?? '';
  if (!source || !content) return c.json({ success: false, error: 'Imported source content is unavailable' }, 409);
  if (utf8ByteLength(content) > MAX_SOURCE_CONTENT_BYTES) {
    return c.json({ success: false, error: 'Stored source content exceeds the 4 MiB size limit' }, 422);
  }
  const format = isValidSourceFormat(source.format) ? source.format : 'auto';
  await ensureSourceZeroSetupState(c.env.DB, now(), workspaceId);
  const preview = await reconcileStructuredImportPreview(
    c.env.DB,
    content,
    previewParsedSourceContent(content, format),
    workspaceId
  );
  return c.json({ success: true, data: preview });
});

app.post('/imports/:runId/structured/retry', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  await recoverStaleSourceImportRuns(c.env.DB, now(), workspaceId);
  const runId = c.req.param('runId');
  const body = await c.req.json<{ structuredConflictResolutions?: unknown }>();
  const conflictResolutions = normalizeStructuredConflictResolutions(body.structuredConflictResolutions);
  if (!conflictResolutions.valid) {
    return c.json({ success: false, error: conflictResolutions.error }, 400);
  }
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ? AND workspace_id = ?')
    .bind(runId, workspaceId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status !== 'partial' || typeof run.structured_error !== 'string' || !run.source_id) {
    return c.json({ success: false, error: 'Structured import is not retryable' }, 409);
  }
  const source = await c.env.DB.prepare('SELECT raw_content, format FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(String(run.source_id), workspaceId)
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
    await ensureSourceZeroSetupState(c.env.DB, ts, workspaceId);
    const execution = await importStructuredSourceContent(
      c.env.DB,
      String(run.source_id),
      content,
      format,
      ts,
      conflictResolutions.value,
      workspaceId
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
      JSON.stringify(changes),
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
  const workspaceId = requestWorkspaceId(c);
  await recoverStaleSourceImportRuns(c.env.DB, now(), workspaceId);
  const runId = c.req.param('runId');
  const run = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ? AND workspace_id = ?')
    .bind(runId, workspaceId)
    .first<Record<string, unknown>>();
  if (!run) return c.json({ success: false, error: 'Import run not found' }, 404);
  if (run.status === 'undone' || !run.source_id) {
    return c.json({ success: false, error: 'Import run has already been undone' }, 409);
  }
  const deleted = await deleteSourceById(c.env.DB, String(run.source_id), now(), workspaceId);
  if (!deleted) return c.json({ success: false, error: 'Imported source no longer exists' }, 409);
  const updated = await c.env.DB.prepare('SELECT * FROM source_import_runs WHERE id = ?')
    .bind(runId)
    .first<Record<string, unknown>>();
  return c.json({ success: true, data: mapSourceImportRun(updated!) });
});

// ─── Get source ───────────────────────────────────────────────────────────────

app.get('/:id/rule-sets', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const candidates = await listSourceRemoteRuleSets(c.env.DB, c.req.param('id'), workspaceId);
  if (candidates === null) return c.json({ success: false, error: 'Source not found' }, 404);
  return c.json({ success: true, data: candidates });
});

app.get('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(c.req.param('id'), workspaceId)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Source not found' }, 404);
  return c.json({ success: true, data: mapSource(row) });
});

// ─── Update source ────────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
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
      refresh_revision = refresh_revision + 1, name = ?, type = ?, url = ?, format = ?, enabled = ?,
      update_interval = ?, user_agent = ?, notes = ?, tags = ?, updated_at = ?
     WHERE id = ? AND workspace_id = ?`
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
      body.tags !== undefined ? JSON.stringify(sourceFields.tags) : existing.tags,
      ts,
      id,
      workspaceId
    )
    .run();

  await ensureZeroSetupDefaults(c.env.DB, ts, workspaceId);

  const updated = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapSource(updated!) });
});

// ─── Delete source (nodes cascade via FK) ─────────────────────────────────────

app.delete('/:id', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT type FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
    .first<{ type: SourceType }>();
  if (!existing) return c.json({ success: false, error: 'Source not found' }, 404);
  if (existing.type === 'manual') {
    return c.json({ success: false, error: 'The manual node source is managed internally' }, 403);
  }
  const deleted = await deleteSourceById(c.env.DB, id, now(), workspaceId);
  if (!deleted) return c.json({ success: false, error: 'Source could not be deleted' }, 409);
  return c.json({ success: true, data: { id } });
});

export async function deleteSourceById(
  db: D1Database,
  id: string,
  ts = now(),
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<boolean> {
  const existing = await db.prepare('SELECT id, type FROM sources WHERE id = ? AND workspace_id = ?')
    .bind(id, workspaceId)
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
    db.prepare(
      `UPDATE remote_rule_sets
       SET source_id = NULL, source_missing = 1, updated_at = ?
       WHERE source_id = ?`
    ).bind(ts, id),
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
  await ensureZeroSetupDefaults(db, ts, workspaceId);
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
    JSON.stringify(input.structuredUndoChanges),
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

async function recoverStaleSourceImportRuns(
  db: D1Database,
  recoveredAt = now(),
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<void> {
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
     WHERE workspace_id = ? AND status = 'running' AND COALESCE(completed_at, created_at) < ?`
  ).bind(recoveredAt, workspaceId, staleBefore).run();
}

// ─── Refresh source ───────────────────────────────────────────────────────────

app.post('/:id/refresh', async (c) => {
  const workspaceId = requestWorkspaceId(c);
  const id = c.req.param('id');
  try {
    const result = await refreshSourceById(c.env.DB, id, workspaceId);
    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : `Failed to fetch URL: ${String(err)}`;
    if (err instanceof SourceRefreshError) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    return c.json(
      { success: false, error: message },
      502
    );
  }
});

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

export function deriveSourceName(url: string | undefined): string {
  const value = url?.trim();
  if (!value) return '订阅源';

  try {
    const parsed = new URL(value);
    const queryName = getSubscriptionUrlName(value);
    if (queryName) return queryName;
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

export function isValidSourceType(value: unknown): value is SourceType {
  return SOURCE_TYPES.has(value as SourceType);
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
  if (updateInterval !== undefined && updateInterval > 0 && updateInterval < 5) {
    return { valid: false, error: 'updateInterval must be 0 or at least 5 minutes' };
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
    ...(filtered.issues.length > 0 ? { issues: filtered.issues.slice(0, 100) } : {}),
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
        key: `node:${index}:${node.protocol}:${node.server}:${node.port}:${node.name}`,
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

function parseStructuredSourceContent(rawContent: string, format: SourceFormat): ParsedStructuredSource {
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

async function importStructuredSourceContent(
  db: D1Database,
  sourceId: string,
  rawContent: string,
  format: SourceFormat,
  ts: string,
  conflictResolutions: Record<string, SourceImportConflictResolution> = {},
  workspaceId = DEFAULT_WORKSPACE_ID
): Promise<StructuredImportExecution> {
  const parsedFormat = detectAndParse(rawContent, format).format;
  const detectedFormat = resolveStructuredSourceFormat(rawContent, format, parsedFormat);
  const parsed = parseStructuredSourceContent(rawContent, detectedFormat);
  const plan = await buildStructuredImportPlan(db, parsed, conflictResolutions, workspaceId);
  const maxRule = await db.prepare('SELECT MAX(sort_order) AS max_order FROM rules WHERE workspace_id = ?').bind(workspaceId).first<{ max_order: number | null }>();
  const maxSet = await db.prepare('SELECT MAX(sort_order) AS max_order FROM remote_rule_sets WHERE workspace_id = ?').bind(workspaceId).first<{ max_order: number | null }>();
  let ruleOrder = (maxRule?.max_order ?? -1) + 1;
  let setOrder = (maxSet?.max_order ?? -1) + 1;
  const marker = structuredImportMarker(sourceId);
  const statements: D1PreparedStatement[] = [];
  const undoCandidates: Array<{ statementIndex: number; change: StructuredImportUndoChange }> = [];

  for (const rule of plan.rules) {
    statements.push(db.prepare(
      `INSERT INTO rules (id, name, type, payload, no_resolve, target_group_id, enabled, sort_order, notes, compatibility, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
    ).bind(
      newId(), `Imported ${rule.type}`, rule.type, rule.payload, rule.noResolve ? 1 : 0, rule.targetId,
      ruleOrder++, marker, JSON.stringify(getRuleCompatibilityForPayload(rule.type, rule.payload)), ts, ts, workspaceId
    ));
  }

  for (const set of plan.remoteRuleSets) {
    statements.push(db.prepare(
      `INSERT INTO remote_rule_sets
        (id, name, url, format, behavior, preset_source, preset_id, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, 'mihomo', ?, NULL, NULL, ?, ?, 1, ?, NULL, ?, ?, ?, ?)`
    ).bind(
      newId(), set.name, set.url, set.behavior, set.targetId, set.updateInterval, setOrder++,
      marker, ts, ts, workspaceId
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
  conflictResolutions: Record<string, SourceImportConflictResolution> = {},
  workspaceId = DEFAULT_WORKSPACE_ID
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
    db.prepare('SELECT id, name FROM groups WHERE workspace_id = ? AND enabled = 1').bind(workspaceId).all<{ id: string; name: string }>(),
    db.prepare('SELECT id, type, payload, no_resolve, target_group_id FROM rules WHERE workspace_id = ?').bind(workspaceId).all<{
      id: string;
      type: string;
      payload: string;
      no_resolve: number;
      target_group_id: string;
    }>(),
    db.prepare('SELECT id, name, url, behavior, update_interval, target_group_id, preset_source FROM remote_rule_sets WHERE workspace_id = ?').bind(workspaceId).all<{
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
  workspaceId = DEFAULT_WORKSPACE_ID,
  excludeNodeSourceId?: string
): Promise<SourceImportPreview> {
  const parsed = parseStructuredSourceContent(rawContent, preview.detectedFormat);
  const [plan, nodeDiff] = await Promise.all([
    buildStructuredImportPlan(db, parsed, {}, workspaceId),
    buildNodeImportDiff(db, rawContent, preview.detectedFormat, workspaceId, excludeNodeSourceId),
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
  workspaceId = DEFAULT_WORKSPACE_ID,
  excludeSourceId?: string
): Promise<SourceImportDiffSection> {
  const parsed = detectAndParse(rawContent, format);
  const nodes = filterUsableParsedContent(parsed.nodes, parsed.groups).nodes;
  if (nodes.length === 0) return makeImportDiffSection([]);

  const query = excludeSourceId
    ? 'SELECT name, server, port, protocol, parsed_config FROM nodes WHERE workspace_id = ? AND (source_id IS NULL OR source_id != ?)'
    : 'SELECT name, server, port, protocol, parsed_config FROM nodes WHERE workspace_id = ?';
  const statement = db.prepare(query);
  const { results: existingRows } = excludeSourceId
    ? await statement.bind(workspaceId, excludeSourceId).all<NodeDiffRow>()
    : await statement.bind(workspaceId).all<NodeDiffRow>();
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


export default app;
