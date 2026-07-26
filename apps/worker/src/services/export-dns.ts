import { getDefaultManagedDnsMode, getExportClientCapabilities } from '@uni-conf/shared';
import type { DnsMode, ExportFormat } from '@uni-conf/types';

export function resolveExportDnsMode(
  format: ExportFormat,
  requested?: DnsMode,
): DnsMode | undefined {
  const supported = getExportClientCapabilities(format).managedDnsModes as readonly DnsMode[];
  if (requested !== undefined) return supported.includes(requested) ? requested : undefined;
  return getDefaultManagedDnsMode(format);
}
