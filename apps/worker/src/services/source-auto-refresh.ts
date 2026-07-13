import { DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES } from '@uni-conf/shared';
import { getAppSettings } from './app-settings';
import { recordSourceRefreshError, refreshSourceById } from '../routes/sources';
import { ensureZeroSetupDefaults } from './zero-setup';

export const AUTO_REFRESH_CONCURRENCY = 4;

export interface AutoRefreshSourceRow {
  id: string;
  last_updated: string | null;
  update_interval: number | null;
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
  const settings = await getAppSettings(db);
  if (!settings.enableAutoRefresh) {
    return {
      checkedCount: 0,
      refreshedCount: 0,
      failedCount: 0,
      skipped: true,
      refreshedSourceIds: [],
      errors: [],
    };
  }

  await ensureZeroSetupDefaults(db, new Date(nowMs).toISOString());

  const { results } = await db.prepare(
    `SELECT id, last_updated, update_interval
     FROM sources
     WHERE enabled = 1 AND type = 'url' AND url IS NOT NULL`
  ).all<AutoRefreshSourceRow>();

  const dueSources = resolveDueSources(results, settings.autoRefreshInterval, nowMs);
  const refreshedSourceIds: string[] = [];
  const errors: Array<{ sourceId: string; error: string }> = [];

  for (let offset = 0; offset < dueSources.length; offset += AUTO_REFRESH_CONCURRENCY) {
    const batch = dueSources.slice(offset, offset + AUTO_REFRESH_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((source) => refreshSourceById(db, source.id)));
    for (const [index, result] of results.entries()) {
      const source = batch[index]!;
      if (result.status === 'fulfilled') {
        refreshedSourceIds.push(source.id);
        continue;
      }
      const error = String(result.reason instanceof Error ? result.reason.message : result.reason);
      await recordSourceRefreshError(db, source.id, error);
      errors.push({ sourceId: source.id, error });
    }
  }

  if (dueSources.length > 0) {
    await ensureZeroSetupDefaults(db, new Date(nowMs).toISOString());
  }

  return {
    checkedCount: results.length,
    refreshedCount: refreshedSourceIds.length,
    failedCount: errors.length,
    skipped: false,
    refreshedSourceIds,
    errors,
  };
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
