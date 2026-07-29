import { getExportClientCapabilities } from '@uni-conf/shared';
import type { ExportDnsPolicy, ExportFormat } from '@uni-conf/types';
import { getAppSettings } from './app-settings';
import { DEFAULT_WORKSPACE_ID } from './workspaces';

export async function getEffectiveExportDnsPolicy(
  db: D1Database,
  format: ExportFormat,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<ExportDnsPolicy | undefined> {
  if (getExportClientCapabilities(format).dns.engine === 'none') return undefined;
  const settings = await getAppSettings(db, workspaceId);
  return {
    additionalRealIpDomains: settings.dnsRealIpDomains,
    resolutionMode: settings.dnsResolutionMode,
  };
}
