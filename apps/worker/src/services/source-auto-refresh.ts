import { DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES } from '@uni-conf/shared';
import { recordSourceRefreshError, refreshSourceById } from '../routes/sources';
import { ensureZeroSetupDefaults } from './zero-setup';

export const AUTO_REFRESH_CONCURRENCY = 4;

export interface AutoRefreshSourceRow {
  id: string;
  last_updated: string | null;
  update_interval: number | null;
}

interface AutoRefreshCandidateRow extends AutoRefreshSourceRow {
  workspace_id: string;
  auto_refresh_interval: number | null;
}

export interface AutoRefreshResult {
  checkedCount: number;
  refreshedCount: number;
  failedCount: number;
  skipped: boolean;
  refreshedSourceIds: string[];
  errors: Array<{ sourceId: string; error: string }>;
}

export async function refreshDueSources(db: D1Database, nowMs = Date.now()): Promise<AutoRefreshResult> {
  const { results } = await db.prepare(
    `SELECT s.id, s.workspace_id, s.last_updated, s.update_interval, a.auto_refresh_interval
     FROM sources s
     INNER JOIN app_settings a ON a.id = s.workspace_id
     WHERE s.type = 'url' AND s.url IS NOT NULL AND a.enable_auto_refresh = 1
     ORDER BY s.workspace_id ASC, s.created_at ASC`
  ).all<AutoRefreshCandidateRow>();
  const totals: AutoRefreshResult = {
    checkedCount: results.length,
    refreshedCount: 0,
    failedCount: 0,
    skipped: results.length === 0,
    refreshedSourceIds: [],
    errors: [],
  };
  const dueByWorkspace = new Map<string, AutoRefreshCandidateRow[]>();
  for (const source of results) {
    if (resolveDueSources([source], source.auto_refresh_interval ?? 0, nowMs).length === 0) continue;
    const workspaceSources = dueByWorkspace.get(source.workspace_id) ?? [];
    workspaceSources.push(source);
    dueByWorkspace.set(source.workspace_id, workspaceSources);
  }

  for (const [workspaceId, dueSources] of dueByWorkspace) {
    let refreshedInWorkspace = 0;
    for (let offset = 0; offset < dueSources.length; offset += AUTO_REFRESH_CONCURRENCY) {
      const batch = dueSources.slice(offset, offset + AUTO_REFRESH_CONCURRENCY);
      const refreshResults = await Promise.allSettled(batch.map((source) =>
        refreshSourceById(db, source.id, workspaceId, { reconcileDefaults: false })
      ));
      for (const [index, result] of refreshResults.entries()) {
        const source = batch[index]!;
        if (result.status === 'fulfilled') {
          totals.refreshedSourceIds.push(source.id);
          totals.refreshedCount++;
          refreshedInWorkspace++;
          continue;
        }
        const error = String(result.reason instanceof Error ? result.reason.message : result.reason);
        await recordSourceRefreshError(db, source.id, error);
        totals.errors.push({ sourceId: source.id, error });
        totals.failedCount++;
      }
    }
    if (refreshedInWorkspace > 0) {
      await ensureZeroSetupDefaults(db, new Date(nowMs).toISOString(), workspaceId);
    }
  }

  return totals;
}

export function resolveDueSources(
  sources: AutoRefreshSourceRow[],
  globalIntervalMinutes: number,
  nowMs: number
): AutoRefreshSourceRow[] {
  const fallbackInterval = Math.max(5, globalIntervalMinutes || DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES);
  return sources.filter((source) => {
    const interval = Math.max(5, source.update_interval && source.update_interval > 0
      ? source.update_interval
      : fallbackInterval);
    if (!source.last_updated) return true;

    const lastUpdatedMs = Date.parse(source.last_updated);
    if (!Number.isFinite(lastUpdatedMs)) return true;
    return nowMs - lastUpdatedMs >= interval * 60 * 1000;
  });
}
