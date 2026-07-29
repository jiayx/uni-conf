import type { ExportConfig } from '@uni-conf/types';
import { syncAutoNodeGroups } from './auto-node-groups';
import { ensureDefaultExportConfig } from './default-export-config';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';
import { syncRoutingPolicyGroups } from './routing-policy-groups';
import { getAppSettings } from './app-settings';

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
