import type { ProxyNode, NormalizedProxyConfig, ProxyProtocol } from '@uni-conf/types'
import yaml from 'js-yaml'
import { detectCountry } from './proxy-link.parser'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

type ClashProxy = Record<string, unknown>

function mapClashProtocol(type: string): ProxyProtocol {
  const map: Record<string, ProxyProtocol> = {
    ss: 'ss',
    ssr: 'ssr',
    vmess: 'vmess',
    vless: 'vless',
    trojan: 'trojan',
    hysteria: 'hysteria',
    hysteria2: 'hysteria2',
    tuic: 'tuic',
    socks5: 'socks5',
    http: 'http',
    'naiveproxy': 'naive',
  }
  return map[type.toLowerCase()] ?? 'unknown'
}

function clashProxyToNode(proxy: ClashProxy, sourceId: string): ProxyNode | null {
  const type = proxy['type'] as string | undefined
  if (!type) return null

  const protocol = mapClashProtocol(type)
  if (protocol === 'unknown') return null

  const server = proxy['server'] as string | undefined
  const port = proxy['port'] as number | undefined
  const name = (proxy['name'] as string) || `${server}:${port}`

  if (!server || port === undefined) return null

  const password = proxy['password'] as string | undefined
  const uuid = proxy['uuid'] as string | undefined
  const tls = (proxy['tls'] as boolean | undefined) ?? false
  const sni = proxy['sni'] as string | undefined
  const skipCertVerify = (proxy['skip-cert-verify'] as boolean | undefined) ?? false
  const network = (proxy['network'] as NormalizedProxyConfig['network']) || undefined
  const wsPath = (proxy['ws-opts'] as Record<string, unknown> | undefined)?.['path'] as string | undefined
  const wsHeaders = (proxy['ws-opts'] as Record<string, unknown> | undefined)?.['headers'] as
    | Record<string, string>
    | undefined

  const extra: Record<string, unknown> = { ...proxy }

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
    rawConfig: proxy,
    parsedConfig,
    isManual: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function parseClashConfig(content: string, sourceId: string): ProxyNode[] {
  try {
    const doc = yaml.load(content) as Record<string, unknown>
    if (!doc || typeof doc !== 'object') return []

    const proxies = doc['proxies'] as ClashProxy[] | undefined
    if (!Array.isArray(proxies)) return []

    return proxies
      .map((proxy) => clashProxyToNode(proxy, sourceId))
      .filter((node): node is ProxyNode => node !== null)
  } catch {
    return []
  }
}
