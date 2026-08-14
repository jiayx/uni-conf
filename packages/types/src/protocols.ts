import type {
  AnyTLSOutboundOptions,
  DirectOutboundOptions,
  HTTPOutboundOptions,
  Hysteria2OutboundOptions,
  HysteriaOutboundOptions,
  ShadowsocksOutboundOptions,
  ShadowTLSOutboundOptions,
  SocksOutboundOptions,
  SSHOutboundOptions,
  TrojanOutboundOptions,
  TUICOutboundOptions,
  VLESSOutboundOptions,
  VMessOutboundOptions,
} from '@black-duty/sing-box-schema'
export { GENERATED_PROTOCOL_SCHEMA_METADATA } from './generated/protocol-schema-metadata'

export const PROXY_PROTOCOL_REGISTRY = {
  ss: {
    label: 'Shadowsocks',
    uriSchemes: ['ss'],
    singboxType: 'shadowsocks',
    mihomoType: 'ss',
    mainstream: true,
  },
  ssr: {
    label: 'ShadowsocksR',
    uriSchemes: ['ssr'],
    singboxType: undefined,
    mihomoType: 'ssr',
    mainstream: true,
  },
  vmess: {
    label: 'VMess',
    uriSchemes: ['vmess'],
    singboxType: 'vmess',
    mihomoType: 'vmess',
    mainstream: true,
  },
  vless: {
    label: 'VLESS',
    uriSchemes: ['vless'],
    singboxType: 'vless',
    mihomoType: 'vless',
    mainstream: true,
  },
  trojan: {
    label: 'Trojan',
    uriSchemes: ['trojan'],
    singboxType: 'trojan',
    mihomoType: 'trojan',
    mainstream: true,
  },
  hysteria: {
    label: 'Hysteria',
    uriSchemes: ['hysteria', 'hy'],
    singboxType: 'hysteria',
    mihomoType: 'hysteria',
    mainstream: true,
  },
  hysteria2: {
    label: 'Hysteria2',
    uriSchemes: ['hysteria2', 'hy2'],
    singboxType: 'hysteria2',
    mihomoType: 'hysteria2',
    mainstream: true,
  },
  tuic: {
    label: 'TUIC',
    uriSchemes: ['tuic'],
    singboxType: 'tuic',
    mihomoType: 'tuic',
    mainstream: true,
  },
  anytls: {
    label: 'AnyTLS',
    uriSchemes: ['anytls'],
    singboxType: 'anytls',
    mihomoType: 'anytls',
    mainstream: true,
  },
  naive: {
    label: 'NaiveProxy',
    uriSchemes: ['naive', 'naive+https'],
    singboxType: undefined,
    mihomoType: undefined,
    mainstream: true,
  },
  wireguard: {
    label: 'WireGuard',
    uriSchemes: ['wireguard', 'wg'],
    singboxType: undefined,
    singboxEndpointType: 'wireguard',
    mihomoType: 'wireguard',
    mainstream: true,
  },
  socks5: {
    label: 'SOCKS5',
    uriSchemes: ['socks', 'socks5'],
    singboxType: 'socks',
    mihomoType: 'socks5',
    mainstream: true,
  },
  http: {
    label: 'HTTP',
    uriSchemes: ['http'],
    singboxType: 'http',
    mihomoType: 'http',
    mainstream: true,
  },
  https: {
    label: 'HTTPS',
    uriSchemes: ['https'],
    singboxType: 'http',
    mihomoType: 'http',
    mainstream: true,
  },
  ssh: {
    label: 'SSH',
    uriSchemes: ['ssh'],
    singboxType: 'ssh',
    mihomoType: 'ssh',
    mainstream: true,
  },
  shadowtls: {
    label: 'ShadowTLS',
    uriSchemes: ['shadowtls'],
    singboxType: 'shadowtls',
    mihomoType: undefined,
    mainstream: true,
  },
  snell: {
    label: 'Snell',
    uriSchemes: ['snell'],
    singboxType: undefined,
    mihomoType: 'snell',
    mainstream: true,
  },
  mieru: {
    label: 'Mieru',
    uriSchemes: ['mieru'],
    singboxType: undefined,
    mihomoType: 'mieru',
    mainstream: true,
  },
  sudoku: {
    label: 'Sudoku',
    uriSchemes: ['sudoku'],
    singboxType: undefined,
    mihomoType: 'sudoku',
    mainstream: true,
  },
  trusttunnel: {
    label: 'TrustTunnel',
    uriSchemes: ['trusttunnel', 'trust-tunnel'],
    singboxType: undefined,
    mihomoType: 'trusttunnel',
    mainstream: true,
  },
  juicity: {
    label: 'Juicity',
    uriSchemes: ['juicity'],
    singboxType: undefined,
    mihomoType: undefined,
    mainstream: true,
  },
  masque: {
    label: 'MASQUE',
    uriSchemes: [],
    singboxType: undefined,
    mihomoType: 'masque',
    mainstream: true,
  },
  reality: {
    label: 'REALITY',
    uriSchemes: [],
    singboxType: undefined,
    mihomoType: undefined,
    mainstream: false,
  },
  direct: {
    label: 'DIRECT',
    uriSchemes: [],
    singboxType: 'direct',
    mihomoType: 'direct',
    mainstream: false,
  },
  reject: {
    label: 'REJECT',
    uriSchemes: [],
    singboxType: undefined,
    mihomoType: 'reject',
    mainstream: false,
  },
  unknown: {
    label: 'Unknown',
    uriSchemes: [],
    singboxType: undefined,
    mihomoType: undefined,
    mainstream: false,
  },
} as const

export type ProxyProtocol = keyof typeof PROXY_PROTOCOL_REGISTRY

export type MainstreamProxyProtocol = {
  [K in ProxyProtocol]: (typeof PROXY_PROTOCOL_REGISTRY)[K]['mainstream'] extends true ? K : never
}[ProxyProtocol]

export type SingboxNativeOutbound =
  | AnyTLSOutboundOptions
  | DirectOutboundOptions
  | HTTPOutboundOptions
  | HysteriaOutboundOptions
  | Hysteria2OutboundOptions
  | ShadowsocksOutboundOptions
  | ShadowTLSOutboundOptions
  | SocksOutboundOptions
  | SSHOutboundOptions
  | TrojanOutboundOptions
  | TUICOutboundOptions
  | VLESSOutboundOptions
  | VMessOutboundOptions

export type MihomoNativeProxy = Record<string, unknown> & {
  name: string
  type: string
  server?: string
  port?: number | string
}

export type NodeConfigSourceFormat = 'uri' | 'mihomo' | 'singbox' | 'unknown'

export type ProtocolFieldType = 'text' | 'password' | 'number' | 'boolean' | 'select' | 'string-array'

export interface ProtocolFieldOption {
  label: string
  value: string
}

export interface ProtocolFieldDefinition {
  key: string
  label: string
  type: ProtocolFieldType
  required?: boolean
  placeholder?: string
  options?: readonly ProtocolFieldOption[]
  defaultValue?: string | number | boolean | string[]
  nativeKeys?: {
    mihomo?: string
    singbox?: string
    uri?: string
  }
}

export interface NativeProxyConfig {
  sourceFormat: NodeConfigSourceFormat
  sourceUri?: string
  mihomo?: MihomoNativeProxy
  singbox?: SingboxNativeOutbound
  normalized?: Record<string, unknown>
}

export const MAINSTREAM_PROXY_PROTOCOLS = Object.entries(PROXY_PROTOCOL_REGISTRY)
  .filter(([, meta]) => meta.mainstream)
  .map(([protocol]) => protocol) as MainstreamProxyProtocol[]

export const URI_SCHEME_TO_PROTOCOL = Object.fromEntries(
  Object.entries(PROXY_PROTOCOL_REGISTRY).flatMap(([protocol, meta]) =>
    meta.uriSchemes.map((scheme) => [scheme, protocol]),
  ),
) as Record<string, ProxyProtocol>

export const SINGBOX_TYPE_TO_PROTOCOL = buildNativeTypeToProtocolMap('singboxType')

export const MIHOMO_TYPE_TO_PROTOCOL = buildNativeTypeToProtocolMap('mihomoType')

function buildNativeTypeToProtocolMap(key: 'mihomoType' | 'singboxType'): Record<string, ProxyProtocol> {
  const result: Record<string, ProxyProtocol> = {}
  for (const [protocol, meta] of Object.entries(PROXY_PROTOCOL_REGISTRY)) {
    const nativeType = meta[key]
    if (nativeType && result[nativeType] === undefined) {
      result[nativeType] = protocol as ProxyProtocol
    }
  }
  return result
}

const TLS_FIELDS = [
  {
    key: 'tls',
    label: 'TLS',
    type: 'boolean',
    nativeKeys: { mihomo: 'tls', singbox: 'tls.enabled', uri: 'security' },
  },
  {
    key: 'sni',
    label: 'SNI',
    type: 'text',
    nativeKeys: { mihomo: 'sni', singbox: 'tls.server_name', uri: 'sni' },
  },
  {
    key: 'skipCertVerify',
    label: 'Skip Cert Verify',
    type: 'boolean',
    nativeKeys: { mihomo: 'skip-cert-verify', singbox: 'tls.insecure', uri: 'allowInsecure' },
  },
] as const satisfies readonly ProtocolFieldDefinition[]

const TRANSPORT_FIELDS = [
  {
    key: 'network',
    label: 'Transport',
    type: 'select',
    defaultValue: 'tcp',
    options: [
      { label: 'TCP', value: 'tcp' },
      { label: 'WebSocket', value: 'ws' },
      { label: 'HTTP/2', value: 'h2' },
      { label: 'gRPC', value: 'grpc' },
      { label: 'QUIC', value: 'quic' },
    ],
    nativeKeys: { mihomo: 'network', singbox: 'transport.type', uri: 'type' },
  },
  {
    key: 'wsPath',
    label: 'WS Path',
    type: 'text',
    placeholder: '/',
    nativeKeys: { mihomo: 'ws-opts.path', singbox: 'transport.path', uri: 'path' },
  },
] as const satisfies readonly ProtocolFieldDefinition[]

export const PROTOCOL_FORM_FIELDS = {
  ss: [
    { key: 'method', label: 'Cipher', type: 'text', required: true, defaultValue: 'aes-256-gcm', nativeKeys: { mihomo: 'cipher', singbox: 'method' } },
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'userinfo' } },
  ],
  ssr: [
    { key: 'method', label: 'Cipher', type: 'text', required: true, nativeKeys: { mihomo: 'cipher' } },
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { mihomo: 'password' } },
    { key: 'obfs', label: 'Obfs', type: 'text', nativeKeys: { mihomo: 'obfs' } },
    { key: 'protocolParam', label: 'Protocol Param', type: 'text', nativeKeys: { mihomo: 'protocol-param' } },
  ],
  vmess: [
    { key: 'uuid', label: 'UUID', type: 'text', required: true, nativeKeys: { mihomo: 'uuid', singbox: 'uuid', uri: 'id' } },
    { key: 'alterId', label: 'Alter ID', type: 'number', defaultValue: 0, nativeKeys: { mihomo: 'alterId', singbox: 'alter_id', uri: 'aid' } },
    { key: 'cipher', label: 'Cipher', type: 'text', defaultValue: 'auto', nativeKeys: { mihomo: 'cipher', singbox: 'security', uri: 'scy' } },
    ...TLS_FIELDS,
    ...TRANSPORT_FIELDS,
  ],
  vless: [
    { key: 'uuid', label: 'UUID', type: 'text', required: true, nativeKeys: { mihomo: 'uuid', singbox: 'uuid', uri: 'userinfo' } },
    { key: 'flow', label: 'Flow', type: 'text', placeholder: 'xtls-rprx-vision', nativeKeys: { mihomo: 'flow', singbox: 'flow', uri: 'flow' } },
    { key: 'security', label: 'Security', type: 'select', defaultValue: 'none', options: [{ label: 'None', value: 'none' }, { label: 'TLS', value: 'tls' }, { label: 'REALITY', value: 'reality' }], nativeKeys: { uri: 'security' } },
    ...TLS_FIELDS,
    ...TRANSPORT_FIELDS,
    { key: 'publicKey', label: 'Reality Public Key', type: 'text', nativeKeys: { mihomo: 'reality-opts.public-key', singbox: 'tls.reality.public_key', uri: 'pbk' } },
    { key: 'shortId', label: 'Reality Short ID', type: 'text', nativeKeys: { mihomo: 'reality-opts.short-id', singbox: 'tls.reality.short_id', uri: 'sid' } },
  ],
  trojan: [
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'userinfo' } },
    ...TLS_FIELDS,
    ...TRANSPORT_FIELDS,
  ],
  hysteria: [
    { key: 'auth', label: 'Auth', type: 'password', required: true, nativeKeys: { mihomo: 'auth-str', singbox: 'auth_str', uri: 'auth' } },
    { key: 'upMbps', label: 'Upload Mbps', type: 'number', nativeKeys: { mihomo: 'up', singbox: 'up_mbps' } },
    { key: 'downMbps', label: 'Download Mbps', type: 'number', nativeKeys: { mihomo: 'down', singbox: 'down_mbps' } },
    ...TLS_FIELDS,
  ],
  hysteria2: [
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'userinfo' } },
    { key: 'obfs', label: 'Obfs', type: 'select', options: [{ label: 'None', value: '' }, { label: 'Salamander', value: 'salamander' }], nativeKeys: { mihomo: 'obfs', singbox: 'obfs.type', uri: 'obfs' } },
    { key: 'obfsPassword', label: 'Obfs Password', type: 'password', nativeKeys: { mihomo: 'obfs-password', singbox: 'obfs.password', uri: 'obfs-password' } },
    ...TLS_FIELDS,
  ],
  tuic: [
    { key: 'uuid', label: 'UUID', type: 'text', required: true, nativeKeys: { mihomo: 'uuid', singbox: 'uuid', uri: 'uuid' } },
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'password' } },
    { key: 'congestionControl', label: 'Congestion Control', type: 'select', defaultValue: 'bbr', options: [{ label: 'BBR', value: 'bbr' }, { label: 'CUBIC', value: 'cubic' }, { label: 'New Reno', value: 'new_reno' }], nativeKeys: { mihomo: 'congestion-controller', singbox: 'congestion_control' } },
    ...TLS_FIELDS,
  ],
  anytls: [
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'userinfo' } },
    { key: 'clientFingerprint', label: 'Client Fingerprint', type: 'text', defaultValue: 'chrome', nativeKeys: { mihomo: 'client-fingerprint', singbox: 'tls.utls.fingerprint' } },
    { key: 'alpn', label: 'ALPN', type: 'string-array', placeholder: 'h2,http/1.1', nativeKeys: { mihomo: 'alpn', singbox: 'tls.alpn', uri: 'alpn' } },
    { key: 'udp', label: 'UDP Relay', type: 'boolean', nativeKeys: { mihomo: 'udp', uri: 'udp' } },
    ...TLS_FIELDS.filter(field => field.key !== 'tls'),
  ],
  naive: [
    { key: 'username', label: 'Username', type: 'text', nativeKeys: { singbox: 'username', uri: 'username' } },
    { key: 'password', label: 'Password', type: 'password', nativeKeys: { singbox: 'password', uri: 'password' } },
    ...TLS_FIELDS,
  ],
  wireguard: [
    { key: 'privateKey', label: 'Private Key', type: 'password', required: true, nativeKeys: { mihomo: 'private-key', singbox: 'private_key', uri: 'private-key' } },
    { key: 'publicKey', label: 'Peer Public Key', type: 'text', required: true, nativeKeys: { mihomo: 'public-key', singbox: 'peer_public_key', uri: 'public-key' } },
    { key: 'presharedKey', label: 'Pre-shared Key', type: 'password', nativeKeys: { mihomo: 'pre-shared-key', singbox: 'pre_shared_key' } },
    { key: 'ip', label: 'Local Address', type: 'text', placeholder: '10.0.0.2/32', nativeKeys: { mihomo: 'ip', singbox: 'local_address', uri: 'address' } },
  ],
  socks5: [
    { key: 'username', label: 'Username', type: 'text', nativeKeys: { mihomo: 'username', singbox: 'username', uri: 'username' } },
    { key: 'password', label: 'Password', type: 'password', nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'password' } },
    ...TLS_FIELDS,
  ],
  http: [
    { key: 'username', label: 'Username', type: 'text', nativeKeys: { mihomo: 'username', singbox: 'username', uri: 'username' } },
    { key: 'password', label: 'Password', type: 'password', nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'password' } },
  ],
  https: [
    { key: 'username', label: 'Username', type: 'text', nativeKeys: { mihomo: 'username', singbox: 'username', uri: 'username' } },
    { key: 'password', label: 'Password', type: 'password', nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'password' } },
    ...TLS_FIELDS,
  ],
  ssh: [
    { key: 'username', label: 'Username', type: 'text', required: true, nativeKeys: { mihomo: 'username', singbox: 'user', uri: 'username' } },
    { key: 'password', label: 'Password', type: 'password', nativeKeys: { mihomo: 'password', singbox: 'password', uri: 'password' } },
    { key: 'privateKey', label: 'Private Key', type: 'password', nativeKeys: { mihomo: 'private-key', singbox: 'private_key' } },
  ],
  shadowtls: [
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { singbox: 'password', uri: 'userinfo' } },
    { key: 'version', label: 'Version', type: 'number', defaultValue: 3, nativeKeys: { singbox: 'version', uri: 'version' } },
    ...TLS_FIELDS,
  ],
  snell: [
    { key: 'psk', label: 'PSK', type: 'password', required: true, nativeKeys: { mihomo: 'psk', uri: 'userinfo' } },
    { key: 'version', label: 'Version', type: 'number', defaultValue: 4, nativeKeys: { mihomo: 'version', uri: 'version' } },
    { key: 'udp', label: 'UDP Relay', type: 'boolean', defaultValue: true, nativeKeys: { mihomo: 'udp', uri: 'udp' } },
    { key: 'reuse', label: 'Connection Reuse', type: 'boolean', nativeKeys: { mihomo: 'reuse' } },
    { key: 'obfs', label: 'Obfs', type: 'select', options: [{ label: 'None', value: '' }, { label: 'HTTP', value: 'http' }, { label: 'TLS', value: 'tls' }], nativeKeys: { mihomo: 'obfs-opts.mode', uri: 'obfs' } },
    { key: 'obfsHost', label: 'Obfs Host', type: 'text', nativeKeys: { mihomo: 'obfs-opts.host', uri: 'obfs-host' } },
  ],
  mieru: [
    { key: 'username', label: 'Username', type: 'text', required: true, nativeKeys: { mihomo: 'username', uri: 'username' } },
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { mihomo: 'password', uri: 'password' } },
    { key: 'transport', label: 'Transport', type: 'select', defaultValue: 'TCP', options: [{ label: 'TCP', value: 'TCP' }, { label: 'UDP', value: 'UDP' }], nativeKeys: { mihomo: 'transport', uri: 'transport' } },
    { key: 'multiplexing', label: 'Multiplexing', type: 'select', defaultValue: 'MULTIPLEXING_LOW', options: [{ label: 'Off', value: 'MULTIPLEXING_OFF' }, { label: 'Low', value: 'MULTIPLEXING_LOW' }, { label: 'Middle', value: 'MULTIPLEXING_MIDDLE' }, { label: 'High', value: 'MULTIPLEXING_HIGH' }], nativeKeys: { mihomo: 'multiplexing' } },
    { key: 'trafficPattern', label: 'Traffic Pattern', type: 'text', nativeKeys: { mihomo: 'traffic-pattern' } },
  ],
  sudoku: [
    { key: 'key', label: 'Client Key', type: 'password', required: true, nativeKeys: { mihomo: 'key', uri: 'userinfo' } },
    { key: 'aeadMethod', label: 'AEAD Method', type: 'select', defaultValue: 'chacha20-poly1305', options: [{ label: 'ChaCha20-Poly1305', value: 'chacha20-poly1305' }, { label: 'AES-128-GCM', value: 'aes-128-gcm' }, { label: 'None', value: 'none' }], nativeKeys: { mihomo: 'aead-method' } },
    { key: 'paddingMin', label: 'Minimum Padding', type: 'number', defaultValue: 2, nativeKeys: { mihomo: 'padding-min' } },
    { key: 'paddingMax', label: 'Maximum Padding', type: 'number', defaultValue: 7, nativeKeys: { mihomo: 'padding-max' } },
    { key: 'tableType', label: 'Table Type', type: 'select', defaultValue: 'prefer_ascii', options: [{ label: 'Prefer ASCII', value: 'prefer_ascii' }, { label: 'Prefer Entropy', value: 'prefer_entropy' }, { label: 'Upload ASCII', value: 'up_ascii_down_entropy' }, { label: 'Upload Entropy', value: 'up_entropy_down_ascii' }], nativeKeys: { mihomo: 'table-type' } },
  ],
  trusttunnel: [
    { key: 'username', label: 'Username', type: 'text', required: true, nativeKeys: { mihomo: 'username', uri: 'username' } },
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { mihomo: 'password', uri: 'password' } },
    { key: 'quic', label: 'HTTP/3 over QUIC', type: 'boolean', nativeKeys: { mihomo: 'quic', uri: 'quic' } },
    { key: 'alpn', label: 'ALPN', type: 'string-array', nativeKeys: { mihomo: 'alpn', uri: 'alpn' } },
    ...TLS_FIELDS,
  ],
  juicity: [
    { key: 'uuid', label: 'UUID', type: 'text', required: true, nativeKeys: { uri: 'uuid' } },
    { key: 'password', label: 'Password', type: 'password', required: true, nativeKeys: { uri: 'password' } },
    { key: 'alpn', label: 'ALPN', type: 'string-array', defaultValue: ['h3'], nativeKeys: { uri: 'alpn' } },
    ...TLS_FIELDS,
  ],
  masque: [
    { key: 'privateKey', label: 'Private Key', type: 'password', required: true, nativeKeys: { mihomo: 'private-key' } },
    { key: 'publicKey', label: 'Server Public Key', type: 'password', required: true, nativeKeys: { mihomo: 'public-key' } },
    { key: 'ip', label: 'Local IPv4 Address', type: 'text', placeholder: '172.16.0.2/32', nativeKeys: { mihomo: 'ip' } },
    { key: 'ipv6', label: 'Local IPv6 Address', type: 'text', placeholder: 'fd00::2/128', nativeKeys: { mihomo: 'ipv6' } },
    { key: 'network', label: 'Transport', type: 'select', defaultValue: 'quic', options: [{ label: 'HTTP/3', value: 'quic' }, { label: 'HTTP/2', value: 'h2' }, { label: 'HTTP/3 L4 Proxy', value: 'h3-l4proxy' }], nativeKeys: { mihomo: 'network' } },
    { key: 'mtu', label: 'MTU', type: 'number', defaultValue: 1280, nativeKeys: { mihomo: 'mtu' } },
    { key: 'udp', label: 'UDP', type: 'boolean', nativeKeys: { mihomo: 'udp' } },
    { key: 'remoteDnsResolve', label: 'Remote DNS Resolve', type: 'boolean', nativeKeys: { mihomo: 'remote-dns-resolve' } },
    { key: 'dns', label: 'Remote DNS Servers', type: 'string-array', nativeKeys: { mihomo: 'dns' } },
    { key: 'congestionController', label: 'Congestion Controller', type: 'text', nativeKeys: { mihomo: 'congestion-controller' } },
    { key: 'handshakeTimeout', label: 'Handshake Timeout', type: 'number', nativeKeys: { mihomo: 'handshake-timeout' } },
    ...TLS_FIELDS,
  ],
  reality: [],
  direct: [],
  reject: [],
  unknown: [],
} as const satisfies Record<ProxyProtocol, readonly ProtocolFieldDefinition[]>
