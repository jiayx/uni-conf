import type { ProxyNode, NormalizedProxyConfig } from '@uni-conf/types'

// ============================================================
// Clash / Mihomo Serializer
// ============================================================

export function nodeToClash(node: ProxyNode): Record<string, unknown> {
  const cfg = node.parsedConfig
  const base: Record<string, unknown> = {
    name: node.name,
    type: protocolToClashType(cfg.protocol),
    server: cfg.server,
    port: cfg.port,
  }

  if (cfg.password) base['password'] = cfg.password
  if (cfg.uuid) base['uuid'] = cfg.uuid
  if (cfg.tls) base['tls'] = cfg.tls
  if (cfg.sni) base['sni'] = cfg.sni
  if (cfg.skipCertVerify) base['skip-cert-verify'] = cfg.skipCertVerify

  // Transport
  if (cfg.network && cfg.network !== 'tcp') {
    base['network'] = cfg.network
    if (cfg.network === 'ws') {
      const wsOpts: Record<string, unknown> = {}
      if (cfg.wsPath) wsOpts['path'] = cfg.wsPath
      if (cfg.wsHeaders) wsOpts['headers'] = cfg.wsHeaders
      if (Object.keys(wsOpts).length > 0) base['ws-opts'] = wsOpts
    }
  }

  // Protocol-specific
  switch (cfg.protocol) {
    case 'ss': {
      const method = cfg.extra['method'] as string | undefined
      if (method) base['cipher'] = method
      break
    }
    case 'vmess': {
      const alterId = cfg.extra['alterId'] as number | undefined
      base['alterId'] = alterId ?? 0
      const cipher = cfg.extra['cipher'] as string | undefined
      if (cipher) base['cipher'] = cipher
      break
    }
    case 'hysteria2': {
      const obfs = cfg.extra['obfs'] as string | undefined
      const obfsPwd = cfg.extra['obfs-password'] as string | undefined
      if (obfs) base['obfs'] = obfs
      if (obfsPwd) base['obfs-password'] = obfsPwd
      break
    }
    case 'tuic': {
      const congestion = cfg.extra['congestion_control'] as string | undefined
      if (congestion) base['congestion-controller'] = congestion
      break
    }
    case 'anytls': {
      base['type'] = 'anytls'
      base['password'] = cfg.password ?? ''
      if (cfg.sni) base['sni'] = cfg.sni
      break
    }
  }

  return base
}

function protocolToClashType(protocol: NormalizedProxyConfig['protocol']): string {
  const map: Record<string, string> = {
    ss: 'ss',
    ssr: 'ssr',
    vmess: 'vmess',
    vless: 'vless',
    trojan: 'trojan',
    hysteria: 'hysteria',
    hysteria2: 'hysteria2',
    tuic: 'tuic',
    anytls: 'anytls',
    shadowtls: 'shadow-tls',
    wireguard: 'wireguard',
    ssh: 'ssh',
    naive: 'naive',
    socks5: 'socks5',
    http: 'http',
    https: 'http',
    unknown: 'ss',
  }
  return map[protocol] ?? protocol
}

// ============================================================
// sing-box Serializer
// ============================================================

export function nodeToSingboxOutbound(node: ProxyNode): Record<string, unknown> | null {
  const cfg = node.parsedConfig
  const type = protocolToSingboxType(cfg.protocol)
  if (!type) return null
  const base: Record<string, unknown> = {
    type,
    tag: node.name,
    server: cfg.server,
    server_port: cfg.port,
  }

  if (cfg.password) base['password'] = cfg.password
  if (cfg.uuid) base['uuid'] = cfg.uuid

  // TLS
  if (cfg.tls || cfg.sni || cfg.skipCertVerify) {
    const tlsObj: Record<string, unknown> = { enabled: cfg.tls ?? false }
    if (cfg.sni) tlsObj['server_name'] = cfg.sni
    if (cfg.skipCertVerify) tlsObj['insecure'] = true
    base['tls'] = tlsObj
  }

  // Transport
  if (cfg.network && cfg.network !== 'tcp') {
    const transport: Record<string, unknown> = { type: cfg.network }
    if (cfg.network === 'ws') {
      if (cfg.wsPath) transport['path'] = cfg.wsPath
      if (cfg.wsHeaders) transport['headers'] = cfg.wsHeaders
    }
    base['transport'] = transport
  }

  // Protocol-specific
  switch (cfg.protocol) {
    case 'ss': {
      const method = cfg.extra['method'] as string | undefined
      if (method) base['method'] = method
      break
    }
    case 'vmess': {
      const alterId = cfg.extra['alterId'] as number | undefined
      base['alter_id'] = alterId ?? 0
      const security = cfg.extra['cipher'] as string | undefined
      if (security) base['security'] = security
      break
    }
    case 'tuic': {
      const congestion = cfg.extra['congestion_control'] as string | undefined
      if (congestion) base['congestion_control'] = congestion
      break
    }
    case 'hysteria2': {
      const obfs = cfg.extra['obfs'] as string | undefined
      if (obfs) {
        base['obfs'] = { type: 'salamander', password: obfs }
      }
      break
    }
    case 'anytls': {
      base['password'] = cfg.password ?? ''
      base['tls'] = {
        enabled: true,
        server_name: cfg.sni ?? cfg.server,
        insecure: cfg.skipCertVerify ?? false,
      }
      break
    }
    case 'ssh': {
      const username = cfg.extra['username'] as string | undefined
      if (username) base['user'] = username
      if (cfg.password) base['password'] = cfg.password
      break
    }
  }

  return base
}

function protocolToSingboxType(protocol: NormalizedProxyConfig['protocol']): string {
  const map: Record<string, string> = {
    ss: 'shadowsocks',
    vmess: 'vmess',
    vless: 'vless',
    trojan: 'trojan',
    hysteria: 'hysteria',
    hysteria2: 'hysteria2',
    tuic: 'tuic',
    anytls: 'anytls',
    shadowtls: 'shadowtls',
    wireguard: 'wireguard',
    ssh: 'ssh',
    socks5: 'socks',
    http: 'http',
    https: 'http',
  }
  return map[protocol] ?? null
}

// ============================================================
// URI Serializer
// ============================================================

export function nodeToUri(node: ProxyNode): string | null {
  const cfg = node.parsedConfig
  const encodedName = encodeURIComponent(node.name)

  switch (cfg.protocol) {
    case 'ss': {
      const method = (cfg.extra['method'] as string) || 'aes-256-gcm'
      const userinfo = btoa(`${method}:${cfg.password ?? ''}`)
      return `ss://${userinfo}@${cfg.server}:${cfg.port}#${encodedName}`
    }
    case 'vmess': {
      const vmessObj = {
        v: '2',
        ps: node.name,
        add: cfg.server,
        port: cfg.port,
        id: cfg.uuid ?? '',
        aid: cfg.extra['alterId'] ?? 0,
        scy: cfg.extra['cipher'] ?? 'auto',
        net: cfg.network ?? 'tcp',
        type: 'none',
        host: cfg.wsHeaders?.['Host'] ?? cfg.sni ?? '',
        path: cfg.wsPath ?? '',
        tls: cfg.tls ? 'tls' : '',
        sni: cfg.sni ?? '',
      }
      return `vmess://${btoa(JSON.stringify(vmessObj))}`
    }
    case 'vless': {
      const params = buildParams(cfg)
      return `vless://${cfg.uuid ?? ''}@${cfg.server}:${cfg.port}?${params}#${encodedName}`
    }
    case 'trojan': {
      const params = buildParams(cfg)
      return `trojan://${encodeURIComponent(cfg.password ?? '')}@${cfg.server}:${cfg.port}?${params}#${encodedName}`
    }
    case 'hysteria2': {
      const params = buildParams(cfg)
      return `hysteria2://${encodeURIComponent(cfg.password ?? '')}@${cfg.server}:${cfg.port}?${params}#${encodedName}`
    }
    case 'hysteria': {
      const params = buildParams(cfg)
      return `hysteria://${encodeURIComponent(cfg.password ?? '')}@${cfg.server}:${cfg.port}?${params}#${encodedName}`
    }
    case 'tuic': {
      const params = buildParams(cfg)
      return `tuic://${cfg.uuid ?? ''}:${encodeURIComponent(cfg.password ?? '')}@${cfg.server}:${cfg.port}?${params}#${encodedName}`
    }
    case 'anytls': {
      const params = buildParams(cfg)
      return `anytls://${encodeURIComponent(cfg.password ?? '')}@${cfg.server}:${cfg.port}?${params}#${encodedName}`
    }
    case 'shadowtls': {
      const params = buildParams(cfg)
      return `shadowtls://${encodeURIComponent(cfg.password ?? '')}@${cfg.server}:${cfg.port}?${params}#${encodedName}`
    }
    case 'wireguard': {
      const params = buildParams(cfg)
      return `wireguard://${encodeURIComponent((cfg.extra['privateKey'] as string | undefined) ?? cfg.password ?? '')}@${cfg.server}:${cfg.port}?${params}#${encodedName}`
    }
    case 'ssh': {
      const username = encodeURIComponent((cfg.extra['username'] as string | undefined) ?? '')
      const password = encodeURIComponent(cfg.password ?? '')
      const auth = username || password ? `${username}${password ? `:${password}` : ''}@` : ''
      return `ssh://${auth}${cfg.server}:${cfg.port}#${encodedName}`
    }
    case 'naive': {
      const username = encodeURIComponent((cfg.extra['username'] as string | undefined) ?? '')
      const password = encodeURIComponent(cfg.password ?? '')
      const auth = username || password ? `${username}${password ? `:${password}` : ''}@` : ''
      return `naive+https://${auth}${cfg.server}:${cfg.port}#${encodedName}`
    }
    case 'socks5': {
      const userPart =
        cfg.uuid || cfg.password
          ? `${encodeURIComponent(cfg.uuid ?? '')}:${encodeURIComponent(cfg.password ?? '')}@`
          : ''
      return `socks5://${userPart}${cfg.server}:${cfg.port}#${encodedName}`
    }
    default:
      return null
  }
}

function buildParams(cfg: NormalizedProxyConfig): string {
  const params = new URLSearchParams()
  if (cfg.tls) params.set('security', 'tls')
  if (cfg.sni) params.set('sni', cfg.sni)
  if (cfg.skipCertVerify) params.set('allowInsecure', '1')
  if (cfg.network && cfg.network !== 'tcp') params.set('type', cfg.network)
  if (cfg.wsPath) params.set('path', cfg.wsPath)
  return params.toString()
}

// ============================================================
// Loon Serializer
// ============================================================

export function nodeToLoon(node: ProxyNode): string {
  const cfg = node.parsedConfig

  switch (cfg.protocol) {
    case 'ss': {
      const method = (cfg.extra['method'] as string) || 'aes-256-gcm'
      let line = `${node.name} = Shadowsocks,${cfg.server},${cfg.port},${method},"${cfg.password ?? ''}"`
      if (cfg.tls) line += `,over-tls=true,tls-name=${cfg.sni ?? cfg.server}`
      return line
    }
    case 'vmess': {
      const alterId = cfg.extra['alterId'] ?? 0
      let line = `${node.name} = vmess,${cfg.server},${cfg.port},aes-128-gcm,"${cfg.uuid ?? ''}",over-tls=${cfg.tls ? 'true' : 'false'}`
      if (cfg.sni) line += `,tls-name=${cfg.sni}`
      if (cfg.network === 'ws') {
        line += `,transport=ws`
        if (cfg.wsPath) line += `,path=${cfg.wsPath}`
      }
      line += `,alter-id=${alterId}`
      return line
    }
    case 'trojan': {
      let line = `${node.name} = trojan,${cfg.server},${cfg.port},"${cfg.password ?? ''}"`
      if (cfg.sni) line += `,tls-name=${cfg.sni}`
      if (cfg.skipCertVerify) line += `,skip-cert-verify=true`
      return line
    }
    case 'hysteria2': {
      let line = `${node.name} = hysteria2,${cfg.server},${cfg.port},"${cfg.password ?? ''}"`
      if (cfg.sni) line += `,tls-name=${cfg.sni}`
      if (cfg.skipCertVerify) line += `,skip-cert-verify=true`
      return line
    }
    case 'socks5': {
      let line = `${node.name} = socks5,${cfg.server},${cfg.port}`
      if (cfg.uuid) line += `,"${cfg.uuid}","${cfg.password ?? ''}"`
      return line
    }
    case 'http':
    case 'https': {
      let line = `${node.name} = http,${cfg.server},${cfg.port}`
      if (cfg.uuid) line += `,"${cfg.uuid}","${cfg.password ?? ''}"`
      if (cfg.tls) line += `,over-tls=true`
      return line
    }
    default:
      return `${node.name} = socks5,${cfg.server},${cfg.port}`
  }
}
