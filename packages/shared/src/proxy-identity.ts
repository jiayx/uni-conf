import type { NormalizedProxyConfig, ProxyProtocol } from '@uni-conf/types'

export interface ProxyConnectionIdentityInput {
  protocol: ProxyProtocol | string
  server: string
  port: number
  parsedConfig?: NormalizedProxyConfig | Record<string, unknown> | string | null
  rawConfig?: Record<string, unknown> | string | null
}

/**
 * JSON with recursively sorted object keys and without undefined values.
 * This is deliberately synchronous so it can be used by import diffing and
 * collection transforms without introducing request-scoped async state.
 */
export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value))
}

/**
 * A display-independent identity for one proxy connection. Names, source IDs,
 * regions and tags are intentionally excluded; connection-affecting protocol
 * fields remain in the canonical parsed configuration.
 */
export function proxyConnectionFingerprint(input: ProxyConnectionIdentityInput): string {
  const parsed = parseRecord(input.parsedConfig)
  const raw = parseRecord(input.rawConfig)
  const config = Object.keys(parsed).length > 0 ? parsed : raw
  const protocol = String(input.protocol || config.protocol || config.type || '').trim().toLowerCase()
  const server = normalizeProxyServer(input.server || String(config.server ?? ''))
  const port = normalizeProxyPort(input.port || Number(config.port ?? config.server_port ?? 0))

  return stableJsonStringify({
    protocol,
    server,
    port,
    config: stripDisplayOnlyProxyFields(config),
  })
}

export function sanitizeExportLabel(value: unknown): string {
  return Array.from(String(value ?? ''), (character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f ? ' ' : character
  }).join('')
    .replace(/,/g, '，')
    .replace(/=/g, '＝')
    .replace(/;/g, '；')
    .replace(/#/g, '＃')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue)
  if (!isRecord(value)) return value

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (item !== undefined) result[key] = canonicalizeJsonValue(item)
  }
  return result
}

function stripDisplayOnlyProxyFields(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value }
  for (const key of ['name', 'tag', 'ps', 'remark', 'remarks', 'country', 'countryCode', 'tags', 'sourceId']) {
    delete result[key]
  }

  // These fields are already represented by the normalized identity prefix.
  delete result.protocol
  delete result.type
  delete result.server
  delete result.server_port
  delete result.port
  if (isRecord(result.extra)) result.extra = stripNestedEndpointFields(result.extra)
  return result
}

function stripNestedEndpointFields(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value }
  for (const key of ['name', 'tag', 'ps', 'remark', 'remarks', 'server', 'server_port', 'port']) delete result[key]
  return result
}

function parseRecord(value: ProxyConnectionIdentityInput['parsedConfig']): Record<string, unknown> {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeProxyServer(value: string): string {
  const trimmed = String(value ?? '').trim()
  const withoutIpv6Brackets = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed
  return withoutIpv6Brackets.toLowerCase()
}

function normalizeProxyPort(value: number): number {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
