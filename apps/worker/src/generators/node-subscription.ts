export function generateNodeSubscriptionBase64(nodes: Record<string, unknown>[]): string {
  return btoa(generateNodeSubscriptionRaw(nodes))
}

export function generateNodeSubscriptionRaw(nodes: Record<string, unknown>[]): string {
  return nodes
    .map(nodeToUri)
    .filter((uri): uri is string => uri !== null)
    .join('\n')
}

function nodeToUri(node: Record<string, unknown>): string | null {
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
    const credentials = btoa(`${cipher}:${password}`)
    return `ss://${credentials}@${server}:${port}#${name}`
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
    return `vmess://${btoa(JSON.stringify(vmessObj))}`
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

  if (protocol === 'socks5') {
    const username = String(extra?.['username'] ?? parsed?.['uuid'] ?? '')
    const password = String(parsed?.['password'] ?? '')
    const userPart = username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : ''
    return `socks5://${userPart}${server}:${port}#${name}`
  }

  return null
}

function safeJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null
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

  if (parsed['tls']) params.set('security', 'tls')
  if (sni) params.set('sni', sni)
  if (parsed['skipCertVerify']) params.set('allowInsecure', '1')
  if (network && network !== 'tcp') params.set('type', network)
  if (wsPath) params.set('path', wsPath)

  return params.toString()
}

function getWsHost(parsed: Record<string, unknown> | null): string | undefined {
  const headers = asRecord(parsed?.['wsHeaders'])
  return (headers?.['Host'] ?? headers?.['host']) as string | undefined
}
