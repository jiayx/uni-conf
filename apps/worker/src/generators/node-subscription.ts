export function generateNodeSubscriptionBase64(nodes: Record<string, unknown>[]): string {
  return encodeBase64Utf8(generateNodeSubscriptionRaw(nodes))
}

export function generateNodeSubscriptionRaw(nodes: Record<string, unknown>[]): string {
  return nodes
    .map(nodeToSubscriptionUri)
    .filter((uri): uri is string => uri !== null)
    .join('\n')
}

export function nodeToSubscriptionUri(node: Record<string, unknown>): string | null {
  const name = encodeURIComponent(String(node['name'] ?? ''))
  const server = String(node['server'] ?? '')
  const port = Number(node['port'] ?? 0)
  const protocol = String(node['protocol'] ?? '')
  const parsed = safeJson(node['parsed_config'] as string)
  const extra = asRecord(parsed?.['extra'])

  if (!server || !port) return null

  if (protocol === 'ss') {
    const cipher = String(extra?.['cipher'] ?? 'aes-256-gcm')
    const password = String(parsed?.['password'] ?? '')
    const credentials = encodeBase64Utf8(`${cipher}:${password}`)
    return `ss://${credentials}@${server}:${port}#${name}`
  }

  if (protocol === 'ssr') {
    const method = String(extra?.['cipher'] ?? extra?.['method'] ?? 'aes-256-cfb')
    const password = String(parsed?.['password'] ?? '')
    const ssrProtocol = String(extra?.['protocol'] ?? 'origin')
    const obfs = String(extra?.['obfs'] ?? 'plain')
    const params = new URLSearchParams({
      remarks: encodeBase64Url(decodeURIComponent(name)),
    })
    if (extra?.['obfsParam']) params.set('obfsparam', encodeBase64Url(String(extra['obfsParam'])))
    if (extra?.['protocolParam']) params.set('protoparam', encodeBase64Url(String(extra['protocolParam'])))
    if (extra?.['group']) params.set('group', encodeBase64Url(String(extra['group'])))
    const main = [
      server,
      port,
      ssrProtocol,
      method,
      obfs,
      encodeBase64Url(password),
    ].join(':')
    return `ssr://${encodeBase64Url(`${main}/?${params.toString()}`)}`
  }

  if (protocol === 'vmess') {
    const vmessObj = {
      v: '2',
      ps: decodeURIComponent(name),
      add: server,
      port: String(port),
      id: String(parsed?.['uuid'] ?? ''),
      aid: String(extra?.['alterId'] ?? 0),
      scy: String(extra?.['cipher'] ?? 'auto'),
      net: String(parsed?.['network'] ?? 'tcp'),
      type: 'none',
      host: getWsHost(parsed) ?? String(parsed?.['sni'] ?? ''),
      path: String(parsed?.['wsPath'] ?? ''),
      tls: parsed?.['tls'] ? 'tls' : '',
      sni: String(parsed?.['sni'] ?? ''),
    }
    return `vmess://${encodeBase64Utf8(JSON.stringify(vmessObj))}`
  }

  if (protocol === 'vless') {
    const uuid = String(parsed?.['uuid'] ?? '')
    const params = buildParams(parsed, { encryption: 'none' })
    return `vless://${uuid}@${server}:${port}?${params}#${name}`
  }

  if (protocol === 'trojan') {
    const password = encodeURIComponent(String(parsed?.['password'] ?? ''))
    const params = buildParams(parsed)
    return `trojan://${password}@${server}:${port}${params ? `?${params}` : ''}#${name}`
  }

  if (protocol === 'hysteria') {
    const auth = encodeURIComponent(String(parsed?.['password'] ?? extra?.['authStr'] ?? extra?.['auth'] ?? ''))
    const params = buildParams(parsed)
    return `hysteria://${auth}@${server}:${port}${params ? `?${params}` : ''}#${name}`
  }

  if (protocol === 'hysteria2' || protocol === 'hy2') {
    const password = encodeURIComponent(String(parsed?.['password'] ?? extra?.['auth'] ?? ''))
    const params = buildParams(parsed)
    return `hysteria2://${password}@${server}:${port}${params ? `?${params}` : ''}#${name}`
  }

  if (protocol === 'tuic') {
    const uuid = encodeURIComponent(String(parsed?.['uuid'] ?? ''))
    const password = encodeURIComponent(String(parsed?.['password'] ?? ''))
    const params = buildParams(parsed)
    return `tuic://${uuid}:${password}@${server}:${port}${params ? `?${params}` : ''}#${name}`
  }

  if (protocol === 'anytls') {
    const password = encodeURIComponent(String(parsed?.['password'] ?? ''))
    const params = buildParams(parsed)
    return `anytls://${password}@${server}:${port}${params ? `?${params}` : ''}#${name}`
  }

  if (protocol === 'socks5') {
    const username = String(extra?.['username'] ?? parsed?.['uuid'] ?? '')
    const password = String(parsed?.['password'] ?? '')
    const userPart = username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : ''
    return `socks5://${userPart}${server}:${port}#${name}`
  }

  if (protocol === 'http' || protocol === 'https') {
    const username = String(extra?.['username'] ?? '')
    const password = String(parsed?.['password'] ?? '')
    const userPart = username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : ''
    return `${protocol}://${userPart}${server}:${port}#${name}`
  }

  if (protocol === 'ssh') {
    const username = String(extra?.['username'] ?? 'root')
    const password = String(parsed?.['password'] ?? '')
    const userPart = password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : `${encodeURIComponent(username)}@`
    return `ssh://${userPart}${server}:${port}#${name}`
  }

  if (protocol === 'shadowtls') {
    const password = encodeURIComponent(String(parsed?.['password'] ?? ''))
    const params = buildParams(parsed)
    return `shadowtls://${password}@${server}:${port}${params ? `?${params}` : ''}#${name}`
  }

  if (protocol === 'wireguard') {
    const privateKey = encodeURIComponent(String(extra?.['privateKey'] ?? parsed?.['password'] ?? ''))
    const params = buildParams(parsed)
    return `wireguard://${privateKey}@${server}:${port}${params ? `?${params}` : ''}#${name}`
  }

  return null
}

function safeJson(text: unknown): Record<string, unknown> | null {
  if (text && typeof text === 'object' && !Array.isArray(text)) return text as Record<string, unknown>
  if (typeof text !== 'string' || !text) return null
  try { return JSON.parse(text) as Record<string, unknown> } catch { return null }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function buildParams(
  parsed: Record<string, unknown> | null,
  defaults: Record<string, string> = {}
): string {
  const params = new URLSearchParams(defaults)
  if (!parsed) return params.toString()

  const network = String(parsed['network'] ?? '')
  const wsPath = String(parsed['wsPath'] ?? '')
  const sni = String(parsed['sni'] ?? '')
  const extra = asRecord(parsed['extra'])

  if (parsed['tls']) params.set('security', 'tls')
  if (sni) params.set('sni', sni)
  if (parsed['skipCertVerify']) params.set('allowInsecure', '1')
  if (network && network !== 'tcp') params.set('type', network)
  if (wsPath) params.set('path', wsPath)
  if (Array.isArray(extra?.['alpn'])) params.set('alpn', extra['alpn'].map(String).join(','))
  if (extra?.['client-fingerprint']) params.set('fp', String(extra['client-fingerprint']))
  if (extra?.['clientFingerprint']) params.set('fp', String(extra['clientFingerprint']))
  if (extra?.['fingerprint']) params.set('fp', String(extra['fingerprint']))
  if (extra?.['fp']) params.set('fp', String(extra['fp']))
  if (extra?.['udp'] !== undefined) params.set('udp', String(Boolean(extra['udp'])))
  if (extra?.['publicKey']) params.set('public-key', String(extra['publicKey']))
  if (extra?.['presharedKey']) params.set('pre-shared-key', String(extra['presharedKey']))
  if (extra?.['ip']) params.set('address', normalizeAddressParam(extra['ip']))
  if (extra?.['address']) params.set('address', normalizeAddressParam(extra['address']))

  return params.toString()
}

function getWsHost(parsed: Record<string, unknown> | null): string | undefined {
  const headers = asRecord(parsed?.['wsHeaders'])
  return (headers?.['Host'] ?? headers?.['host']) as string | undefined
}

function encodeBase64Url(value: string): string {
  return encodeBase64Utf8(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function normalizeAddressParam(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(',')
  return String(value)
}
