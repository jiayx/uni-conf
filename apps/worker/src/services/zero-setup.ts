import type { ExportConfig } from '@uni-conf/types';
import { syncAutoNodeGroups } from './auto-node-groups';
import { ensureDefaultExportConfig } from './default-export-config';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';
import { syncRoutingPolicyGroups } from './routing-policy-groups';
import { getAppSettings } from './app-settings';

// Increment when the canonical workspace graph changes and existing spaces need reconciliation.
export const WORKSPACE_DEFAULTS_VERSION = 1;

export async function ensureWorkspaceInitialized(
  db: D1Database,
  kv: KVNamespace,
  ts: string,
  workspaceId: string,
): Promise<void> {
  const key = workspaceDefaultsKey(workspaceId);
  const currentVersion = await kv.get(key) === String(WORKSPACE_DEFAULTS_VERSION);
  if (currentVersion && await hasInitializedWorkspaceState(db, workspaceId)) return;
  await ensureZeroSetupDefaults(db, ts, workspaceId);
  await kv.put(key, String(WORKSPACE_DEFAULTS_VERSION));
}

export async function ensureZeroSetupDefaults(
  db: D1Database,
  ts: string,
  workspaceId: string,
): Promise<ExportConfig> {
  const defaultExportConfig = await ensureDefaultExportConfig(db, ts, workspaceId);
  await syncAutoNodeGroups(db, ts, workspaceId);
  await syncRoutingPolicyGroups(db, ts, workspaceId);
  const settings = await getAppSettings(db, workspaceId);
  await ensureDefaultRemoteRuleSets(db, ts, settings.unmatchedTrafficPolicy, undefined, workspaceId);
  return defaultExportConfig;
}

export function workspaceDefaultsKey(workspaceId: string): string {
  return `workspace-defaults:${workspaceId}`;
}

async function hasInitializedWorkspaceState(db: D1Database, workspaceId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS initialized
     FROM app_settings a
     INNER JOIN export_configs e
       ON e.token = a.default_export_token AND e.workspace_id = a.id AND e.enabled = 1
     WHERE a.id = ?
     LIMIT 1`,
  ).bind(workspaceId).first<{ initialized: number }>();
  return row?.initialized === 1;
}
