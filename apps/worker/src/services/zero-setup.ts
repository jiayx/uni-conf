import type { ExportConfig } from '@uni-conf/types';
import { syncAutoNodeGroups } from './auto-node-groups';
import { ensureDefaultExportConfig } from './default-export-config';
import { ensureDefaultRemoteRuleSets } from './default-rule-sets';
import { syncRoutingPolicyGroups } from './routing-policy-groups';

export async function ensureZeroSetupDefaults(db: D1Database, ts: string): Promise<ExportConfig> {
  const defaultExportConfig = await ensureDefaultExportConfig(db, ts);
  await syncAutoNodeGroups(db, ts);
  await syncRoutingPolicyGroups(db, ts);
  await ensureDefaultRemoteRuleSets(db, ts);
  return defaultExportConfig;
}
