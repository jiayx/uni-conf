import {
  PROTOCOL_FORM_FIELDS,
  type NormalizedProxyConfig,
  type ProtocolFieldDefinition,
  type ProxyProtocol,
} from '@uni-conf/types'
import { buildStructuredProxyConfig } from '@uni-conf/shared'

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
  const fields = protocolFields(protocol)
  const defaults = Object.fromEntries(
    fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue as ManualNodeExtraValue])
  )
  const booleanKeys = new Set(fields.filter(field => field.type === 'boolean').map(field => field.key))
  const normalized = Object.fromEntries(
    Object.entries(extra).map(([key, value]) => [
      key,
      booleanKeys.has(key) ? normalizeBooleanFieldValue(value) : value,
    ])
  )
  return { ...defaults, ...normalized }
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
    ...buildStructuredProxyConfig(protocol, server, port, completedExtra),
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

function isMissingValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

function normalizeBooleanFieldValue(value: ManualNodeExtraValue): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}
