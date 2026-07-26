import type { ExportConfig } from '@uni-conf/types';
import { syncAutoNodeGroups } from './auto-node-groups';
import { ensureDefaultExportConfig } from './default-export-config';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';
import { syncRoutingPolicyGroups } from './routing-policy-groups';
import { getAppSettings } from './app-settings';

export async function ensureZeroSetupDefaults(db: D1Database, ts: string): Promise<ExportConfig> {
  const defaultExportConfig = await ensureDefaultExportConfig(db, ts);
  await syncAutoNodeGroups(db, ts);
  await syncRoutingPolicyGroups(db, ts);
  const settings = await getAppSettings(db);
  await ensureDefaultRemoteRuleSets(db, ts, settings.unmatchedTrafficPolicy);
  return defaultExportConfig;
}
