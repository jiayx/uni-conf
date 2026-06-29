import type { NormalizedProxyConfig, ProxyProtocol } from '@uni-conf/types'

export type ManualNodeExtraValue = string | number | boolean | string[]

export function compactManualNodeExtra(
  extra: Record<string, ManualNodeExtraValue>
): Record<string, ManualNodeExtraValue> {
  return Object.fromEntries(
    Object.entries(extra).filter(([, value]) => {
      if (value === '' || value === undefined || value === null) return false
      if (Array.isArray(value) && value.length === 0) return false
      return true
    }),
  )
}

export function buildManualNodeParsedConfig(
  protocol: ProxyProtocol,
  server: string,
  port: number,
  extra: Record<string, ManualNodeExtraValue>,
  existing?: NormalizedProxyConfig
): NormalizedProxyConfig {
  return {
    ...(existing ?? { extra: {} }),
    protocol,
    server,
    port,
    password: asString(extra['password']),
    uuid: asString(extra['uuid']),
    tls: asBoolean(extra['tls']) || extra['security'] === 'tls' || extra['security'] === 'reality',
    sni: asString(extra['sni']),
    skipCertVerify: asBoolean(extra['skipCertVerify']),
    network: asNetwork(extra['network']),
    wsPath: asString(extra['wsPath']),
    extra,
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asNetwork(value: unknown): NormalizedProxyConfig['network'] | undefined {
  if (value === 'tcp' || value === 'ws' || value === 'http' || value === 'h2' || value === 'grpc' || value === 'quic') {
    return value
  }
  return undefined
}
