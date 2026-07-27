import { getDefaultExportDnsPolicy, getExportClientCapabilities } from '@uni-conf/shared';
import type {
  DnsAddressMode,
  DnsResolutionMode,
  ExportDnsPolicy,
  ExportFormat,
} from '@uni-conf/types';

const MAX_REAL_IP_EXCEPTIONS = 256;
const MAX_DOMAIN_PATTERN_LENGTH = 253;

export function resolveExportDnsPolicy(
  format: ExportFormat,
  requested?: unknown,
): ExportDnsPolicy | undefined {
  if (requested === undefined) return getDefaultExportDnsPolicy(format);
  const policy = normalizeExportDnsPolicy(requested);
  if (!policy) return undefined;

  const capabilities = getExportClientCapabilities(format).dns;
  if (
    !(capabilities.addressModes as readonly DnsAddressMode[]).includes(policy.address.mode)
    || !(capabilities.resolutionModes as readonly DnsResolutionMode[]).includes(policy.resolution.mode)
  ) {
    return undefined;
  }
  if (
    policy.address.mode === 'fake-ip'
    && !capabilities.supportsRealIpExceptions
    && policy.address.realIpExceptions.domains.length > 0
  ) {
    return undefined;
  }
  return policy;
}

function normalizeExportDnsPolicy(value: unknown): ExportDnsPolicy | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['address', 'resolution'])) return undefined;
  const address = value.address;
  const resolution = value.resolution;
  if (!isRecord(address) || !isRecord(resolution)) return undefined;
  if (
    !hasOnlyKeys(resolution, ['mode', 'preset'])
    || (resolution.mode !== 'single' && resolution.mode !== 'split')
    || resolution.preset !== 'managed'
  ) {
    return undefined;
  }

  if (address.mode === 'real-ip') {
    if (!hasOnlyKeys(address, ['mode'])) return undefined;
    return {
      address: { mode: 'real-ip' },
      resolution: { mode: resolution.mode, preset: 'managed' },
    };
  }
  if (address.mode !== 'fake-ip' || !hasOnlyKeys(address, ['mode', 'realIpExceptions'])) {
    return undefined;
  }
  const exceptions = address.realIpExceptions;
  if (
    !isRecord(exceptions)
    || !hasOnlyKeys(exceptions, ['includeManagedDefaults', 'domains'])
    || typeof exceptions.includeManagedDefaults !== 'boolean'
    || !Array.isArray(exceptions.domains)
    || exceptions.domains.length > MAX_REAL_IP_EXCEPTIONS
  ) {
    return undefined;
  }
  const domains = exceptions.domains.map(domain => typeof domain === 'string' ? domain.trim() : '');
  if (
    domains.some(domain => !domain || domain.length > MAX_DOMAIN_PATTERN_LENGTH || /[\s,\n\r]/.test(domain))
  ) {
    return undefined;
  }

  return {
    address: {
      mode: 'fake-ip',
      realIpExceptions: {
        includeManagedDefaults: exceptions.includeManagedDefaults,
        domains: [...new Set(domains)],
      },
    },
    resolution: { mode: resolution.mode, preset: 'managed' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every(key => allowed.has(key));
}
