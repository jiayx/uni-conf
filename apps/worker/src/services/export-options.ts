import { getExportClientCapabilities } from '@uni-conf/shared'
import type { AppSettings, ExportConfig, ExportFormat, RuleSetConversionPolicy } from '@uni-conf/types'
import { exportNeedsInlineManagedRealIpDomains, getManagedRealIpDomains } from './managed-dns-resources'

export function resolveExportRuleSetConversionPolicy(
  config: Pick<ExportConfig, 'ruleSetConversionPolicy'>,
  globalPolicy: RuleSetConversionPolicy,
): RuleSetConversionPolicy {
  return config.ruleSetConversionPolicy === 'compatible' || config.ruleSetConversionPolicy === 'strict'
    ? config.ruleSetConversionPolicy
    : globalPolicy
}

export async function buildExportRenderOptions(
  requestUrl: string,
  token: string,
  format: ExportFormat,
  settings: AppSettings,
  kv?: KVNamespace,
) {
  return {
    dnsPolicy: getExportClientCapabilities(format).dns.engine === 'none'
      ? undefined
      : { additionalRealIpDomains: settings.dnsRealIpDomains },
    managedRealIpDomains: exportNeedsInlineManagedRealIpDomains(format)
      ? await getManagedRealIpDomains(kv)
      : undefined,
    ruleSetConversionBaseUrl: `${new URL(requestUrl).origin}/sub/${encodeURIComponent(token)}/rules`,
  }
}
