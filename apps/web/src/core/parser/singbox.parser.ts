import { SINGBOX_TYPE_TO_PROTOCOL } from '@uni-conf/types'
import type { ProxyNode, NormalizedProxyConfig, ProxyProtocol } from '@uni-conf/types'
import { detectCountry } from './proxy-link.parser'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

type SingboxOutbound = Record<string, unknown>

// Built-in outbound types that we skip
const BUILTIN_TYPES = new Set([
  'direct',
  'block',
  'dns',
  'selector',
  'urltest',
  'loadbalance',
  'trojan', // handled below but listed for clarity — actually trojan IS a proxy type
])

const PROXY_TYPES = new Set([
  'shadowsocks',
  'vmess',
  'vless',
  'trojan',
  'hysteria',
  'hysteria2',
  'tuic',
  'anytls',
  'socks',
  'http',
  'ssh',
  'shadowtls',
  'wireguard',
])

function mapSingboxProtocol(type: string): ProxyProtocol {
  return SINGBOX_TYPE_TO_PROTOCOL[type.toLowerCase()] ?? 'unknown'
}

function singboxOutboundToNode(outbound: SingboxOutbound, sourceId: string): ProxyNode | null {
  const type = outbound['type'] as string | undefined
  if (!type || !PROXY_TYPES.has(type.toLowerCase())) return null

  const protocol = mapSingboxProtocol(type)
  if (protocol === 'unknown') return null

  const server = outbound['server'] as string | undefined
  const port = outbound['server_port'] as number | undefined
  const name = (outbound['tag'] as string) || `${server}:${port}`

  if (!server || port === undefined) return null

  const password = outbound['password'] as string | undefined
  const uuid = outbound['uuid'] as string | undefined

  // TLS
  const tlsObj = outbound['tls'] as Record<string, unknown> | undefined
  const tls = tlsObj?.['enabled'] === true
  const sni = tlsObj?.['server_name'] as string | undefined
  const skipCertVerify = tlsObj?.['insecure'] === true

  // Transport
  const transportObj = outbound['transport'] as Record<string, unknown> | undefined
  let network: NormalizedProxyConfig['network'] | undefined
  let wsPath: string | undefined
  let wsHeaders: Record<string, string> | undefined

  if (transportObj) {
    const ttype = transportObj['type'] as string | undefined
    if (ttype === 'ws') {
      network = 'ws'
      wsPath = transportObj['path'] as string | undefined
      wsHeaders = transportObj['headers'] as Record<string, string> | undefined
    } else if (ttype === 'http') {
      network = 'http'
    } else if (ttype === 'grpc') {
      network = 'grpc'
    } else if (ttype === 'quic') {
      network = 'quic'
    }
  }

  const extra: Record<string, unknown> = { ...outbound }

  const parsedConfig: NormalizedProxyConfig = {
    protocol,
    server,
    port,
    password,
    uuid,
    tls,
    sni,
    skipCertVerify,
    network,
    wsPath,
    wsHeaders,
    extra,
  }

  const countryInfo = detectCountry(name)
  const now = new Date().toISOString()

  return {
    id: generateId(),
    sourceId,
    name,
    protocol,
    server,
    port,
    country: countryInfo?.country,
    countryCode: countryInfo?.countryCode,
    enabled: true,
    tags: [],
    rawConfig: outbound,
    parsedConfig,
    isManual: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function parseSingboxConfig(content: string, sourceId: string): ProxyNode[] {
  try {
    const doc = JSON.parse(content) as Record<string, unknown>
    if (!doc || typeof doc !== 'object') return []

    const outbounds = doc['outbounds'] as SingboxOutbound[] | undefined
    if (!Array.isArray(outbounds)) return []

    return outbounds
      .filter((ob) => {
        const t = (ob['type'] as string | undefined)?.toLowerCase()
        return t && !BUILTIN_TYPES.has(t) || (t && PROXY_TYPES.has(t))
      })
      .map((ob) => singboxOutboundToNode(ob, sourceId))
      .filter((node): node is ProxyNode => node !== null)
  } catch {
    return []
  }
}
