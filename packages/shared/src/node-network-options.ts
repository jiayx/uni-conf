/** Optional node settings: absence must preserve the client's own defaults. */
export function readNodeNetworkOptions(extra: Record<string, unknown> | null | undefined = {}): {
  udp?: boolean
  blockQuic?: boolean
} {
  const udp = optionalBoolean(extra?.udp ?? extra?.['udp-relay'] ?? extra?.udp_relay)
  const blockQuic = optionalBoolean(extra?.blockQuic ?? extra?.['block-quic'] ?? extra?.block_quic)
  return {
    ...(udp !== undefined ? { udp } : {}),
    ...(blockQuic !== undefined ? { blockQuic } : {}),
  }
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') return true
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'off') return false
  return undefined
}

// These outbound schemas expose a network (tcp/udp) restriction. AnyTLS and
// WireGuard have no corresponding per-outbound UDP switch in sing-box.
export const SINGBOX_NETWORK_PROTOCOLS = new Set([
  'ss', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic', 'socks5',
])
