import {
  PROTOCOL_FORM_FIELDS,
  type NormalizedProxyConfig,
  type ProtocolFieldDefinition,
  type ProxyProtocol,
} from '@uni-conf/types'

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

export function completeManualNodeExtra(
  protocol: ProxyProtocol,
  extra: Record<string, ManualNodeExtraValue>
): Record<string, ManualNodeExtraValue> {
  const defaults = Object.fromEntries(
    protocolFields(protocol)
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue as ManualNodeExtraValue])
  )
  return { ...defaults, ...extra }
}

export function buildManualNodeParsedConfig(
  protocol: ProxyProtocol,
  server: string,
  port: number,
  extra: Record<string, ManualNodeExtraValue>,
  existing?: NormalizedProxyConfig
): NormalizedProxyConfig {
  const completedExtra = completeManualNodeExtra(protocol, extra)
  return {
    ...(existing ?? { extra: {} }),
    protocol,
    server,
    port,
    password: asString(completedExtra['password']),
    uuid: asString(completedExtra['uuid']),
    tls: asBoolean(completedExtra['tls']) || completedExtra['security'] === 'tls' || completedExtra['security'] === 'reality',
    sni: asString(completedExtra['sni']),
    skipCertVerify: asBoolean(completedExtra['skipCertVerify']),
    network: asNetwork(completedExtra['network']),
    wsPath: asString(completedExtra['wsPath']),
    extra: completedExtra,
  }
}

export function getMissingRequiredManualNodeFields(
  protocol: ProxyProtocol,
  extra: Record<string, ManualNodeExtraValue>
): string[] {
  return protocolFields(protocol)
    .filter((field) => 'required' in field && field.required)
    .filter((field) => isMissingValue(extra[field.key]) && isMissingValue(field.defaultValue))
    .map((field) => field.label)
}

function protocolFields(protocol: ProxyProtocol): readonly ProtocolFieldDefinition[] {
  return PROTOCOL_FORM_FIELDS[protocol] as readonly ProtocolFieldDefinition[]
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function isMissingValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
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
