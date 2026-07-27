import type { ExportDnsPolicy } from '@uni-conf/types';

export const MANAGED_REAL_IP_DOMAINS = [
  '*.lan',
  '*.local',
  'localhost',
  'localhost.ptlogin2.qq.com',
  'localhost.sec.qq.com',
  '*.msftconnecttest.com',
  '*.msftncsi.com',
] as const;

export const DEFAULT_FAKE_IP_POLICY: ExportDnsPolicy = {
  address: {
    mode: 'fake-ip',
    realIpExceptions: {
      includeManagedDefaults: true,
      domains: [],
    },
  },
  resolution: {
    mode: 'split',
    preset: 'managed',
  },
};

export function realIpDomains(policy: ExportDnsPolicy): string[] {
  if (policy.address.mode !== 'fake-ip') return [];
  return [
    ...(policy.address.realIpExceptions.includeManagedDefaults ? MANAGED_REAL_IP_DOMAINS : []),
    ...policy.address.realIpExceptions.domains,
  ];
}
