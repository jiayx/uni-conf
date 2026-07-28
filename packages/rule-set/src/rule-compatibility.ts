export type ConvertibleRuleSetTarget =
  | 'mihomo'
  | 'singbox'
  | 'surge'
  | 'loon'
  | 'shadowrocket'
  | 'quantumultx'
  | 'egern'

export type RuleSetRuleTarget = ConvertibleRuleSetTarget | 'clash' | 'stash'

export interface RuleSetRuleResolution {
  level: 'full' | 'convert' | 'unsupported'
  type: string
  payload: string
  reason?: 'protocol-to-network' | 'network-to-protocol' | 'unsupported-rule-value'
}

export function resolveRuleSetRuleForTarget(
  type: string,
  payload: string,
  target: RuleSetRuleTarget
): RuleSetRuleResolution {
  const value = payload.trim().toLowerCase()
  if (type === 'NETWORK') {
    if (target === 'singbox' && ['tcp', 'udp', 'icmp'].includes(value)) {
      return { level: 'full', type, payload: value }
    }
    if (['mihomo', 'clash', 'stash'].includes(target) && ['tcp', 'udp'].includes(value)) {
      return { level: 'full', type, payload: value }
    }
    if (target === 'surge' && ['tcp', 'udp'].includes(value)) {
      return { level: 'convert', type: 'PROTOCOL', payload: value.toUpperCase(), reason: 'network-to-protocol' }
    }
    if (target === 'loon' && ['tcp', 'udp'].includes(value)) {
      return { level: 'convert', type: 'PROTOCOL', payload: value.toUpperCase(), reason: 'network-to-protocol' }
    }
    if (target === 'egern' && ['tcp', 'udp'].includes(value)) {
      return { level: 'convert', type: 'PROTOCOL', payload: value, reason: 'network-to-protocol' }
    }
    return { level: 'unsupported', type, payload, reason: 'unsupported-rule-value' }
  }

  if (type === 'PROTOCOL') {
    if (['mihomo', 'clash', 'stash'].includes(target) && ['tcp', 'udp'].includes(value)) {
      return { level: 'convert', type: 'NETWORK', payload: value, reason: 'protocol-to-network' }
    }
    if (target === 'singbox') {
      if (['tcp', 'udp'].includes(value)) {
        return { level: 'convert', type: 'NETWORK', payload: value, reason: 'protocol-to-network' }
      }
      const protocols = ['http', 'tls', 'quic', 'stun', 'dns', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp']
      return protocols.includes(value)
        ? { level: 'full', type, payload: value }
        : { level: 'unsupported', type, payload, reason: 'unsupported-rule-value' }
    }
    if (target === 'surge') {
      const protocols = ['http', 'https', 'tcp', 'udp', 'doh', 'doh3', 'doq', 'quic', 'stun']
      return protocols.includes(value)
        ? { level: 'full', type, payload: value.toUpperCase() }
        : { level: 'unsupported', type, payload, reason: 'unsupported-rule-value' }
    }
    if (target === 'loon') {
      return ['tcp', 'udp'].includes(value)
        ? { level: 'full', type, payload: value.toUpperCase() }
        : { level: 'unsupported', type, payload, reason: 'unsupported-rule-value' }
    }
    if (target === 'egern') {
      return ['tcp', 'udp', 'http', 'https', 'quic', 'stun'].includes(value)
        ? { level: 'full', type, payload: value }
        : { level: 'unsupported', type, payload, reason: 'unsupported-rule-value' }
    }
  }
  return { level: 'unsupported', type, payload, reason: 'unsupported-rule-value' }
}
