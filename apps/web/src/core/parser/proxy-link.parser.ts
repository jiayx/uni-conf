import { buildNodeRecognitionTags, detectCountry, isSubscriptionInfoNodeName } from '@uni-conf/shared'
import type { ProxyNode, NormalizedProxyConfig, ProxyProtocol } from '@uni-conf/types'

// ============================================================
// ID Generation
// ============================================================

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const DEFAULT_PORTS: Partial<Record<ProxyProtocol, number>> = {
  anytls: 443,
  trojan: 443,
  vless: 443,
  hysteria: 443,
  hysteria2: 443,
  tuic: 443,
  naive: 443,
  https: 443,
  http: 80,
  socks5: 1080,
  ssh: 22,
  shadowtls: 443,
  wireguard: 51820,
}

// ============================================================
// URI Parsers
// ============================================================

function makeParsedConfig(
  protocol: ProxyProtocol,
  server: string,
  port: number,
  extra: Record<string, unknown>,
): NormalizedProxyConfig {
  return {
    protocol,
    server,
    port,
    password: extra.password as string | undefined,
    uuid: extra.uuid as string | undefined,
    tls: extra.tls as boolean | undefined,
    sni: extra.sni as string | undefined,
    skipCertVerify: extra.skipCertVerify as boolean | undefined,
    network: extra.network as NormalizedProxyConfig['network'],
    wsPath: extra.wsPath as string | undefined,
    wsHeaders: extra.wsHeaders as Record<string, string> | undefined,
    extra,
  }
}

function decodeSafe(s: string): string {
  try {
    return decodeBase64Utf8(s)
  } catch {
    // Try URL-safe base64
    try {
      const normalized = s.replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
      return decodeBase64Utf8(padded)
    } catch {
      return s
    }
  }
}

function decodeBase64Utf8(s: string): string {
  const binary = atob(s)
  try {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return binary
  }
}

function parseSS(uri: string): Omit<ProxyNode, 'id' | 'sourceId' | 'createdAt' | 'updatedAt'> | null {
  // ss://BASE64@server:port#name  or  ss://BASE64(userinfo@server:port)#name
  try {
    const withoutScheme = uri.slice(5) // remove "ss://"
    const hashIdx = withoutScheme.indexOf('#')
    const name = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : ''
    const body = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme

    let method: string
    let password: string
    let server: string
    let port: number

    if (body.includes('@')) {
      // userinfo@host:port
      const atIdx = body.lastIndexOf('@')
      const userinfo = body.slice(0, atIdx)
      const hostPort = body.slice(atIdx + 1)
      // userinfo may be base64 encoded
      let decoded = decodeSafe(userinfo)
      if (!decoded.includes(':')) decoded = userinfo
      const colonIdx = decoded.indexOf(':')
      method = decoded.slice(0, colonIdx)
      password = decoded.slice(colonIdx + 1)
      const portColon = hostPort.lastIndexOf(':')
      server = hostPort.slice(0, portColon)
      port = parseInt(hostPort.slice(portColon + 1), 10)
    } else {
      // fully base64 encoded: userinfo@host:port
      const decoded = decodeSafe(body)
      const atIdx = decoded.lastIndexOf('@')
      const userinfo = decoded.slice(0, atIdx)
      const hostPort = decoded.slice(atIdx + 1)
      const colonIdx = userinfo.indexOf(':')
      method = userinfo.slice(0, colonIdx)
      password = userinfo.slice(colonIdx + 1)
      const portColon = hostPort.lastIndexOf(':')
      server = hostPort.slice(0, portColon)
      port = parseInt(hostPort.slice(portColon + 1), 10)
    }

    if (!server || isNaN(port)) return null

    const rawConfig: Record<string, unknown> = { method, password, server, port }
    const parsedConfig = makeParsedConfig('ss', server, port, { method, password })

    const nodeName = name || `${server}:${port}`
    const countryInfo = detectCountry(nodeName)
    return {
      name: nodeName,
      protocol: 'ss',
      server,
      port,
      country: countryInfo?.country,
      countryCode: countryInfo?.countryCode,
      enabled: true,
      tags: buildNodeRecognitionTags(nodeName),
      rawConfig,
      parsedConfig,
      isManual: false,
    }
  } catch {
    return null
  }
}

function parseSSR(uri: string): Omit<ProxyNode, 'id' | 'sourceId' | 'createdAt' | 'updatedAt'> | null {
  const decoded = decodeSafe(uri.slice('ssr://'.length))
  const querySeparator = decoded.indexOf('/?')
  const main = querySeparator >= 0 ? decoded.slice(0, querySeparator) : decoded
  const query = querySeparator >= 0 ? decoded.slice(querySeparator + 2) : ''
  const [server, portValue, ssrProtocol, method, obfs, passwordValue] = main.split(':')
  const port = parseInt(portValue ?? '', 10)
  const password = decodeSafe(passwordValue ?? '')
  if (!server || isNaN(port) || !ssrProtocol || !method || !obfs || !password) return null

  const params = new URLSearchParams(query)
  const obfsParam = decodeSafe(params.get('obfsparam') ?? '') || undefined
  const protocolParam = decodeSafe(params.get('protoparam') ?? '') || undefined
  const group = decodeSafe(params.get('group') ?? '') || undefined
  const nodeName = decodeSafe(params.get('remarks') ?? '') || `${server}:${port}`
  const extra: Record<string, unknown> = {
    method,
    password,
    protocol: ssrProtocol,
    obfs,
    obfsParam,
    protocolParam,
    group,
  }
  const countryInfo = detectCountry(nodeName)

  return {
    name: nodeName,
    protocol: 'ssr',
    server,
    port,
    country: countryInfo?.country,
    countryCode: countryInfo?.countryCode,
    enabled: true,
    tags: buildNodeRecognitionTags(nodeName),
    rawConfig: extra,
    parsedConfig: makeParsedConfig('ssr', server, port, extra),
    isManual: false,
  }
}

function parseVMess(uri: string): Omit<ProxyNode, 'id' | 'sourceId' | 'createdAt' | 'updatedAt'> | null {
  try {
    const encoded = uri.slice(8) // remove "vmess://"
    const decoded = decodeSafe(encoded)
    const config = JSON.parse(decoded) as Record<string, unknown>

    const server = (config.add as string) || ''
    const port = parseInt(String(config.port), 10)
    const name = (config.ps as string) || `${server}:${port}`

    if (!server || isNaN(port)) return null

    const extra: Record<string, unknown> = {
      uuid: config.id,
      alterId: config.aid,
      cipher: config.scy || config.type || 'auto',
      network: config.net,
      wsPath: config.path,
      wsHost: config.host,
      tls: config.tls === 'tls',
      sni: config.sni || config.host,
    }

    const parsedConfig = makeParsedConfig('vmess', server, port, extra)

    const countryInfo = detectCountry(name)
    return {
      name,
      protocol: 'vmess',
      server,
      port,
      country: countryInfo?.country,
      countryCode: countryInfo?.countryCode,
      enabled: true,
      tags: buildNodeRecognitionTags(name),
      rawConfig: config,
      parsedConfig,
      isManual: false,
    }
  } catch {
    return null
  }
}

function parseURLStyle(
  uri: string,
  scheme: string,
  protocol: ProxyProtocol,
): Omit<ProxyNode, 'id' | 'sourceId' | 'createdAt' | 'updatedAt'> | null {
  try {
    // Normalize: some URIs use non-standard chars; we need to parse carefully
    const withoutScheme = uri.slice(scheme.length + 3) // remove "scheme://"
    const hashIdx = withoutScheme.indexOf('#')
    const name = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : ''
    const beforeHash = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme

    const qIdx = beforeHash.indexOf('?')
    const hostAndPath = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash
    const slashIdx = hostAndPath.indexOf('/')
    const hostPart = slashIdx >= 0 ? hostAndPath.slice(0, slashIdx) : hostAndPath
    const uriPath = slashIdx >= 0 ? hostAndPath.slice(slashIdx) : ''
    const queryStr = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : ''
    const params = new URLSearchParams(queryStr)

    // userinfo@host:port
    const atIdx = hostPart.lastIndexOf('@')
    const userinfo = atIdx >= 0 ? hostPart.slice(0, atIdx) : ''
    const hostPort = atIdx >= 0 ? hostPart.slice(atIdx + 1) : hostPart

    // Extract host and port (handle IPv6)
    let server: string
    let port: number
    if (hostPort.startsWith('[')) {
      // IPv6
      const closeBracket = hostPort.indexOf(']')
      server = hostPort.slice(1, closeBracket)
      port = hostPort.length > closeBracket + 1
        ? parseInt(hostPort.slice(closeBracket + 2), 10)
        : (DEFAULT_PORTS[protocol] ?? 0)
    } else {
      const portColon = hostPort.lastIndexOf(':')
      if (portColon >= 0) {
        server = hostPort.slice(0, portColon)
        port = parseInt(hostPort.slice(portColon + 1), 10)
      } else {
        server = hostPort
        port = DEFAULT_PORTS[protocol] ?? 0
      }
    }

    if (!server || isNaN(port)) return null

    // Parse userinfo
    let password: string | undefined
    let uuid: string | undefined
    let username: string | undefined

    if (protocol === 'vless' || protocol === 'trojan' || protocol === 'hysteria' || protocol === 'hysteria2' || protocol === 'anytls' || protocol === 'shadowtls') {
      // userinfo is password or uuid (no colon separator for trojan/vless)
      if (userinfo.includes(':')) {
        // tuic: uuid:password
        const colonIdx = userinfo.indexOf(':')
        uuid = userinfo.slice(0, colonIdx)
        password = userinfo.slice(colonIdx + 1)
      } else {
        if (protocol === 'vless') uuid = decodeURIComponent(userinfo)
        else password = decodeURIComponent(userinfo)
      }
    } else if (protocol === 'tuic') {
      const colonIdx = userinfo.indexOf(':')
      uuid = decodeURIComponent(userinfo.slice(0, colonIdx))
      password = decodeURIComponent(userinfo.slice(colonIdx + 1))
    } else if (protocol === 'wireguard') {
      password = decodeURIComponent(userinfo)
    } else if (protocol === 'ssh') {
      if (userinfo.includes(':')) {
        const colonIdx = userinfo.indexOf(':')
        username = decodeURIComponent(userinfo.slice(0, colonIdx))
        password = decodeURIComponent(userinfo.slice(colonIdx + 1))
      } else {
        username = decodeURIComponent(userinfo)
      }
    } else {
      // socks5/http: user:pass
      if (userinfo.includes(':')) {
        const colonIdx = userinfo.indexOf(':')
        username = decodeURIComponent(userinfo.slice(0, colonIdx))
        password = decodeURIComponent(userinfo.slice(colonIdx + 1))
      } else {
        username = decodeURIComponent(userinfo)
      }
    }

    const tls =
      protocol === 'https' ||
      protocol === 'hysteria' ||
      protocol === 'hysteria2' ||
      protocol === 'anytls' ||
      protocol === 'shadowtls' ||
      protocol === 'naive' ||
      params.get('security') === 'tls' ||
      params.get('tls') === '1' ||
      params.get('security') === 'reality'
    const sni = params.get('sni') || params.get('peer') || params.get('host') || undefined
    const skipCertVerify =
      params.get('allowInsecure') === '1' ||
      params.get('allowInsecure') === 'true' ||
      params.get('insecure') === '1' ||
      params.get('insecure') === 'true' ||
      params.get('skip-cert-verify') === 'true'
    const network = (params.get('type') || params.get('network') || 'tcp') as NormalizedProxyConfig['network']
    const wsPath = params.get('path') || (uriPath && uriPath !== '/' ? uriPath : undefined)

    const extra: Record<string, unknown> = {}
    params.forEach((value, key) => {
      extra[key] = value
    })
    extra.uuid = uuid
    extra.password = password
    extra.username = username
    extra.privateKey = params.get('private-key') || params.get('privateKey') || password
    extra.publicKey = params.get('public-key') || params.get('publicKey') || params.get('peer-public-key') || undefined
    extra.presharedKey = params.get('pre-shared-key') || params.get('presharedKey') || undefined
    extra.ip = params.get('address') || params.get('ip') || undefined
    extra.alpn = params.get('alpn') || undefined
    extra.fingerprint = params.get('fp') || params.get('fingerprint') || undefined
    extra.tls = tls
    extra.sni = sni
    extra.skipCertVerify = skipCertVerify
    extra.network = network
    extra.wsPath = wsPath

    const parsedConfig = makeParsedConfig(protocol, server, port, extra)

    const rawConfig: Record<string, unknown> = {
      server,
      port,
      password,
      uuid,
      username,
      ...extra,
    }

    const nodeName = name || `${server}:${port}`
    const countryInfo = detectCountry(nodeName)

    return {
      name: nodeName,
      protocol,
      server,
      port,
      country: countryInfo?.country,
      countryCode: countryInfo?.countryCode,
      enabled: true,
      tags: buildNodeRecognitionTags(nodeName),
      rawConfig,
      parsedConfig,
      isManual: false,
    }
  } catch {
    return null
  }
}

// ============================================================
// Main Exports
// ============================================================

export function parseProxyLink(uri: string, sourceId: string): ProxyNode | null {
  const trimmed = uri.trim()
  let partial: Omit<ProxyNode, 'id' | 'sourceId' | 'createdAt' | 'updatedAt'> | null = null

  if (trimmed.startsWith('ss://')) {
    partial = parseSS(trimmed)
  } else if (trimmed.startsWith('ssr://')) {
    partial = parseSSR(trimmed)
  } else if (trimmed.startsWith('vmess://')) {
    partial = parseVMess(trimmed)
  } else if (trimmed.startsWith('vless://')) {
    partial = parseURLStyle(trimmed, 'vless', 'vless')
  } else if (trimmed.startsWith('trojan://')) {
    partial = parseURLStyle(trimmed, 'trojan', 'trojan')
  } else if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) {
    const scheme = trimmed.startsWith('hy2://') ? 'hy2' : 'hysteria2'
    partial = parseURLStyle(trimmed, scheme, 'hysteria2')
  } else if (trimmed.startsWith('hysteria://') || trimmed.startsWith('hy://')) {
    const scheme = trimmed.startsWith('hy://') ? 'hy' : 'hysteria'
    partial = parseURLStyle(trimmed, scheme, 'hysteria')
  } else if (trimmed.startsWith('tuic://')) {
    partial = parseURLStyle(trimmed, 'tuic', 'tuic')
  } else if (trimmed.startsWith('anytls://')) {
    partial = parseURLStyle(trimmed, 'anytls', 'anytls')
  } else if (trimmed.startsWith('shadowtls://')) {
    partial = parseURLStyle(trimmed, 'shadowtls', 'shadowtls')
  } else if (trimmed.startsWith('wireguard://')) {
    partial = parseURLStyle(trimmed, 'wireguard', 'wireguard')
  } else if (trimmed.startsWith('wg://')) {
    partial = parseURLStyle(trimmed, 'wg', 'wireguard')
  } else if (trimmed.startsWith('ssh://')) {
    partial = parseURLStyle(trimmed, 'ssh', 'ssh')
  } else if (trimmed.startsWith('naive+https://')) {
    partial = parseURLStyle(trimmed, 'naive+https', 'naive')
  } else if (trimmed.startsWith('naive://')) {
    partial = parseURLStyle(trimmed, 'naive', 'naive')
  } else if (trimmed.startsWith('socks5://')) {
    partial = parseURLStyle(trimmed, 'socks5', 'socks5')
  } else if (trimmed.startsWith('socks://')) {
    partial = parseURLStyle(trimmed, 'socks', 'socks5')
  } else if (trimmed.startsWith('http://')) {
    partial = parseURLStyle(trimmed, 'http', 'http')
  } else if (trimmed.startsWith('https://')) {
    partial = parseURLStyle(trimmed, 'https', 'https')
  }

  if (!partial) return null

  const now = new Date().toISOString()
  return {
    ...partial,
    id: generateId(),
    sourceId,
    createdAt: now,
    updatedAt: now,
  }
}

export function parseProxyLinks(text: string, sourceId: string): ProxyNode[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseProxyLink(line, sourceId))
    .filter((node): node is ProxyNode => node !== null && !isSubscriptionInfoNodeName(node.name))
}
