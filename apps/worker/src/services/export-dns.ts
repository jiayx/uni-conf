import { getExportClientCapabilities } from '@uni-conf/shared';
import type { ExportDnsPolicy, ExportFormat } from '@uni-conf/types';
import { getAppSettings } from './app-settings';

export async function getEffectiveExportDnsPolicy(
  db: D1Database,
  format: ExportFormat,
): Promise<ExportDnsPolicy | undefined> {
  if (getExportClientCapabilities(format).dns.engine === 'none') return undefined;
  const settings = await getAppSettings(db);
  return {
    additionalRealIpDomains: settings.dnsRealIpDomains,
    resolutionMode: settings.dnsResolutionMode,
  };
}
