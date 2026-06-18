import type { ProxyNode, NormalizedProxyConfig, ProxyProtocol } from '@uni-conf/types'

// ============================================================
// ID Generation
// ============================================================

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// ============================================================
// Country Detection
// ============================================================

interface CountryInfo {
  country: string
  countryCode: string
}

const FLAG_MAP: Array<[string, string, string]> = [
  ['🇭🇰', 'Hong Kong', 'HK'],
  ['🇯🇵', 'Japan', 'JP'],
  ['🇺🇸', 'United States', 'US'],
  ['🇸🇬', 'Singapore', 'SG'],
  ['🇹🇼', 'Taiwan', 'TW'],
  ['🇰🇷', 'Korea', 'KR'],
  ['🇬🇧', 'United Kingdom', 'GB'],
  ['🇩🇪', 'Germany', 'DE'],
  ['🇫🇷', 'France', 'FR'],
  ['🇳🇱', 'Netherlands', 'NL'],
  ['🇦🇺', 'Australia', 'AU'],
  ['🇨🇦', 'Canada', 'CA'],
  ['🇮🇳', 'India', 'IN'],
  ['🇧🇷', 'Brazil', 'BR'],
  ['🇷🇺', 'Russia', 'RU'],
  ['🇹🇷', 'Turkey', 'TR'],
  ['🇦🇷', 'Argentina', 'AR'],
  ['🇲🇾', 'Malaysia', 'MY'],
  ['🇹🇭', 'Thailand', 'TH'],
  ['🇻🇳', 'Vietnam', 'VN'],
  ['🇮🇩', 'Indonesia', 'ID'],
  ['🇵🇭', 'Philippines', 'PH'],
  ['🇿🇦', 'South Africa', 'ZA'],
  ['🇮🇱', 'Israel', 'IL'],
  ['🇸🇦', 'Saudi Arabia', 'SA'],
  ['🇦🇪', 'United Arab Emirates', 'AE'],
  ['🇮🇷', 'Iran', 'IR'],
  ['🇵🇱', 'Poland', 'PL'],
  ['🇮🇹', 'Italy', 'IT'],
  ['🇪🇸', 'Spain', 'ES'],
  ['🇵🇹', 'Portugal', 'PT'],
  ['🇨🇿', 'Czech Republic', 'CZ'],
  ['🇸🇪', 'Sweden', 'SE'],
  ['🇳🇴', 'Norway', 'NO'],
  ['🇩🇰', 'Denmark', 'DK'],
  ['🇫🇮', 'Finland', 'FI'],
  ['🇨🇭', 'Switzerland', 'CH'],
  ['🇦🇹', 'Austria', 'AT'],
  ['🇧🇪', 'Belgium', 'BE'],
]

const KEYWORD_MAP: Array<[RegExp, string, string]> = [
  [/\b(hong\s*kong|hongkong|hk)\b/i, 'Hong Kong', 'HK'],
  [/\b(japan|jp|tokyo)\b/i, 'Japan', 'JP'],
  [/\b(usa|united\s+states|america)\b/i, 'United States', 'US'],
  // "us" is intentionally NOT matched by keyword alone (too ambiguous like "us" in words)
  [/\b(singapore|sg)\b/i, 'Singapore', 'SG'],
  [/\b(taiwan|tw)\b/i, 'Taiwan', 'TW'],
  [/\b(korea|kr)\b/i, 'Korea', 'KR'],
  [/\b(uk|britain|england|london)\b/i, 'United Kingdom', 'GB'],
  [/\b(germany|german|de)\b/i, 'Germany', 'DE'],
  [/\b(france|fr)\b/i, 'France', 'FR'],
  [/\b(netherlands|nl|dutch)\b/i, 'Netherlands', 'NL'],
  [/\b(australia|au)\b/i, 'Australia', 'AU'],
  [/\b(canada|ca)\b/i, 'Canada', 'CA'],
]

export function detectCountry(name: string): CountryInfo | null {
  // 1. Check flag emojis first
  for (const [flag, country, code] of FLAG_MAP) {
    if (name.includes(flag)) {
      return { country, countryCode: code }
    }
  }
  // 2. Check text keywords
  for (const [pattern, country, code] of KEYWORD_MAP) {
    if (pattern.test(name)) {
      return { country, countryCode: code }
    }
  }
  return null
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
    return atob(s)
  } catch {
    // Try URL-safe base64
    try {
      const normalized = s.replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
      return atob(padded)
    } catch {
      return s
    }
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
    const parsedConfig = makeParsedConfig('ss', server, port, { password, extra: {} })
    parsedConfig.extra = { method }

    const countryInfo = detectCountry(name)
    return {
      name: name || `${server}:${port}`,
      protocol: 'ss',
      server,
      port,
      country: countryInfo?.country,
      countryCode: countryInfo?.countryCode,
      enabled: true,
      tags: [],
      rawConfig,
      parsedConfig,
      isManual: false,
    }
  } catch {
    return null
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

    const parsedConfig = makeParsedConfig('vmess', server, port, {
      uuid: config.id as string,
      tls: config.tls === 'tls',
      sni: (config.sni || config.host) as string | undefined,
      network: (config.net as NormalizedProxyConfig['network']) || 'tcp',
      wsPath: config.path as string | undefined,
      extra,
    })

    const countryInfo = detectCountry(name)
    return {
      name,
      protocol: 'vmess',
      server,
      port,
      country: countryInfo?.country,
      countryCode: countryInfo?.countryCode,
      enabled: true,
      tags: [],
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
    const hostPart = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash
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
      port = parseInt(hostPort.slice(closeBracket + 2), 10)
    } else {
      const portColon = hostPort.lastIndexOf(':')
      server = hostPort.slice(0, portColon)
      port = parseInt(hostPort.slice(portColon + 1), 10)
    }

    if (!server || isNaN(port)) return null

    // Parse userinfo
    let password: string | undefined
    let uuid: string | undefined

    if (protocol === 'vless' || protocol === 'trojan' || protocol === 'hysteria2') {
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
    } else {
      // socks5: user:pass
      if (userinfo.includes(':')) {
        const colonIdx = userinfo.indexOf(':')
        uuid = decodeURIComponent(userinfo.slice(0, colonIdx))
        password = decodeURIComponent(userinfo.slice(colonIdx + 1))
      } else {
        password = decodeURIComponent(userinfo)
      }
    }

    const tls = params.get('security') === 'tls' || params.get('tls') === '1' || params.get('security') === 'reality'
    const sni = params.get('sni') || params.get('peer') || undefined
    const skipCertVerify = params.get('allowInsecure') === '1' || params.get('skip-cert-verify') === 'true'
    const network = (params.get('type') || params.get('network') || 'tcp') as NormalizedProxyConfig['network']
    const wsPath = params.get('path') || undefined

    const extra: Record<string, unknown> = {}
    params.forEach((value, key) => {
      extra[key] = value
    })
    extra.uuid = uuid
    extra.password = password

    const parsedConfig = makeParsedConfig(protocol, server, port, {
      password,
      uuid,
      tls,
      sni,
      skipCertVerify,
      network,
      wsPath,
      extra,
    })

    const rawConfig: Record<string, unknown> = {
      server,
      port,
      password,
      uuid,
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
      tags: [],
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
  } else if (trimmed.startsWith('vmess://')) {
    partial = parseVMess(trimmed)
  } else if (trimmed.startsWith('vless://')) {
    partial = parseURLStyle(trimmed, 'vless', 'vless')
  } else if (trimmed.startsWith('trojan://')) {
    partial = parseURLStyle(trimmed, 'trojan', 'trojan')
  } else if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) {
    const scheme = trimmed.startsWith('hy2://') ? 'hy2' : 'hysteria2'
    partial = parseURLStyle(trimmed, scheme, 'hysteria2')
  } else if (trimmed.startsWith('tuic://')) {
    partial = parseURLStyle(trimmed, 'tuic', 'tuic')
  } else if (trimmed.startsWith('socks5://')) {
    partial = parseURLStyle(trimmed, 'socks5', 'socks5')
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
    .filter((node): node is ProxyNode => node !== null)
}
