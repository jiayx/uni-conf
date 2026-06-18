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
      aid: '0',
      net: String(parsed?.['network'] ?? 'tcp'),
      type: 'none',
      host: '',
      path: String(extra?.['wsPath'] ?? ''),
      tls: parsed?.['tls'] ? 'tls' : '',
    }
    return `vmess://${btoa(JSON.stringify(vmessObj))}`
  }

  if (protocol === 'vless') {
    const uuid = String(parsed?.['uuid'] ?? '')
    return `vless://${uuid}@${server}:${port}?encryption=none#${name}`
  }

  if (protocol === 'trojan') {
    const password = String(parsed?.['password'] ?? '')
    return `trojan://${password}@${server}:${port}#${name}`
  }

  if (protocol === 'hysteria2' || protocol === 'hy2') {
    const password = String(parsed?.['password'] ?? '')
    return `hysteria2://${password}@${server}:${port}#${name}`
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
