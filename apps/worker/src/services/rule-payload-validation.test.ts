import { describe, expect, it } from 'vitest'
import {
  parseRulePortPayload,
  resolveRuleForExport,
  supportsRuleNoResolve,
  validateAndNormalizeRulePayload,
} from '@uni-conf/shared'

describe('manual rule payload validation', () => {
  it('validates IPv4, IPv6, and source CIDR families', () => {
    expect(validateAndNormalizeRulePayload('IP-CIDR', '10.0.0.0/8'))
      .toEqual({ valid: true, payload: '10.0.0.0/8' })
    expect(validateAndNormalizeRulePayload('IP-CIDR', '2001:db8::/32'))
      .toMatchObject({ valid: false, code: 'invalid-ipv4-cidr' })
    expect(validateAndNormalizeRulePayload('IP-CIDR6', '2001:db8::/32'))
      .toEqual({ valid: true, payload: '2001:db8::/32' })
    expect(validateAndNormalizeRulePayload('IP-CIDR6', '2001:::1/129'))
      .toMatchObject({ valid: false, code: 'invalid-ipv6-cidr' })
    expect(validateAndNormalizeRulePayload('SRC-IP-CIDR', '192.0.2.5/32'))
      .toEqual({ valid: true, payload: '192.0.2.5/32' })
  })

  it('normalizes ports, ASNs, networks, and protocol tokens', () => {
    expect(validateAndNormalizeRulePayload('PORT', ' 443 '))
      .toEqual({ valid: true, payload: '443' })
    expect(validateAndNormalizeRulePayload('SRC-PORT', '9000:8000'))
      .toMatchObject({ valid: false, code: 'invalid-port' })
    expect(validateAndNormalizeRulePayload('PORT', '8000:9000'))
      .toEqual({ valid: true, payload: '8000-9000' })
    expect(validateAndNormalizeRulePayload('IP-ASN', 'as13335'))
      .toEqual({ valid: true, payload: '13335' })
    expect(validateAndNormalizeRulePayload('NETWORK', ' TCP '))
      .toEqual({ valid: true, payload: 'tcp' })
    expect(validateAndNormalizeRulePayload('NETWORK', 'quic'))
      .toMatchObject({ valid: false, code: 'invalid-network' })
    expect(validateAndNormalizeRulePayload('PROTOCOL', 'HTTP_3'))
      .toEqual({ valid: true, payload: 'http_3' })
  })

  it('rejects malformed regular expressions and accepts MATCH without a payload', () => {
    expect(validateAndNormalizeRulePayload('DOMAIN-REGEX', '[invalid'))
      .toMatchObject({ valid: false, code: 'invalid-domain-regex' })
    expect(validateAndNormalizeRulePayload('MATCH', 'ignored'))
      .toEqual({ valid: true, payload: '' })
  })

  it('parses sing-box-compatible single ports and ranges', () => {
    expect(parseRulePortPayload('443')).toEqual({ kind: 'single', port: 443 })
    expect(parseRulePortPayload('8000-9000')).toEqual({ kind: 'range', range: '8000:9000' })
    expect(parseRulePortPayload('0')).toBeNull()
    expect(parseRulePortPayload('9000-8000')).toBeNull()
  })

  it('resolves value-dependent NETWORK and PROTOCOL compatibility', () => {
    expect(resolveRuleForExport('NETWORK', 'tcp', 'surge')).toMatchObject({
      level: 'convert',
      type: 'PROTOCOL',
      payload: 'TCP',
    })
    expect(resolveRuleForExport('NETWORK', 'tcp', 'loon')).toMatchObject({
      level: 'convert',
      type: 'PROTOCOL',
      payload: 'TCP',
    })
    expect(resolveRuleForExport('NETWORK', 'icmp', 'mihomo')).toMatchObject({
      level: 'unsupported',
    })
    expect(resolveRuleForExport('NETWORK', 'icmp', 'singbox')).toMatchObject({
      level: 'full',
      type: 'NETWORK',
      payload: 'icmp',
    })
    expect(resolveRuleForExport('PROTOCOL', 'tcp', 'mihomo')).toMatchObject({
      level: 'convert',
      type: 'NETWORK',
      payload: 'tcp',
    })
    expect(resolveRuleForExport('PROTOCOL', 'tcp', 'singbox')).toMatchObject({
      level: 'convert',
      type: 'NETWORK',
      payload: 'tcp',
    })
    expect(resolveRuleForExport('PROTOCOL', 'http', 'singbox')).toMatchObject({
      level: 'full',
      type: 'PROTOCOL',
      payload: 'http',
    })
    expect(resolveRuleForExport('PROTOCOL', 'https', 'singbox')).toMatchObject({
      level: 'unsupported',
    })
    expect(resolveRuleForExport('PROTOCOL', 'https', 'surge')).toMatchObject({
      level: 'full',
      payload: 'HTTPS',
    })
    expect(resolveRuleForExport('PROTOCOL', 'udp', 'loon')).toMatchObject({
      level: 'full',
      payload: 'UDP',
    })
    expect(resolveRuleForExport('PROTOCOL', 'http', 'loon')).toMatchObject({
      level: 'unsupported',
    })
  })

  it('maps portable port spellings and scopes no-resolve to target IP rules', () => {
    expect(resolveRuleForExport('PORT', '443', 'mihomo')).toMatchObject({
      level: 'convert',
      type: 'DST-PORT',
    })
    expect(resolveRuleForExport('PORT', '443', 'surge')).toMatchObject({
      level: 'convert',
      type: 'DEST-PORT',
    })
    expect(resolveRuleForExport('PORT', '443', 'loon')).toMatchObject({
      level: 'convert',
      type: 'DEST-PORT',
    })
    expect(resolveRuleForExport('PORT', '443', 'shadowrocket')).toMatchObject({
      level: 'convert',
      type: 'DST-PORT',
    })
    expect(resolveRuleForExport('PORT', '443', 'quantumultx')).toMatchObject({
      level: 'unsupported',
    })
    expect(resolveRuleForExport('IP-ASN', '13335', 'loon')).toMatchObject({
      level: 'convert',
      type: 'IPASN',
    })
    expect(resolveRuleForExport('DOMAIN-SUFFIX', 'example.com', 'quantumultx')).toMatchObject({
      level: 'convert',
      type: 'HOST-SUFFIX',
      reason: 'target-rule-spelling',
    })
    expect(resolveRuleForExport('RULE-SET', 'remote-tag', 'loon')).toMatchObject({
      level: 'unsupported',
    })
    expect(resolveRuleForExport('RULE-SET', 'remote-tag', 'quantumultx')).toMatchObject({
      level: 'unsupported',
    })
    expect(resolveRuleForExport('SRC-IP-CIDR', '10.0.0.0/8', 'surge')).toMatchObject({
      level: 'convert',
      type: 'SRC-IP',
    })
    expect(supportsRuleNoResolve('IP-CIDR', 'mihomo')).toBe(true)
    expect(supportsRuleNoResolve('PORT', 'mihomo')).toBe(false)
    expect(supportsRuleNoResolve('IP-CIDR', 'singbox')).toBe(false)
  })
})
