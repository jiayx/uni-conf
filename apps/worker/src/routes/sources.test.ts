import { describe, it, expect } from 'vitest'
import { detectCountry } from '@uni-conf/shared'
import { parseClashGroups, parseClashYaml } from './sources'

// Mock Clash YAML with multiple node formats
const MOCK_CLASH_YAML = `
port: 7890
socks-port: 7891
proxies:
    - { name: '剩余流量：111 GB', type: trojan, server: 10.255.255.255, port: 443, password: test-pwd, udp: true }
    - { name: '🇭🇰 HK 01', type: anytls, server: example.relay.org, port: 443, password: test-pwd, alpn: [h2, http/1.1], skip-cert-verify: false, udp: true, client-fingerprint: firefox, sni: example.moe }
    - { name: '🇭🇰 HK 02', type: anytls, server: example.relay.org, port: 443, password: test-pwd, alpn: [h2, http/1.1], skip-cert-verify: false, udp: true, client-fingerprint: ios, sni: example2.moe }
    - { name: '🇯🇵 JP 01', type: anytls, server: aws-nrt.example.moe, port: 443, password: test-pwd, alpn: [h2, http/1.1], skip-cert-verify: false, udp: true, client-fingerprint: safari, sni: example3.moe }
    - name: US Server 01
      type: vmess
      server: us.example.com
      port: 443
      uuid: 12345678-1234-1234-1234-123456789012
      alterId: 0
      cipher: auto
    - name: SG Server 01
      type: trojan
      server: sg.example.com
      port: 443
      password: test-password
      udp: true
proxy-groups:
  - name: Proxy
    type: select
`

describe('Clash YAML Parser', () => {
  it('should parse inline format nodes (flow-style)', () => {
    const inlineYaml = `
proxies:
    - { name: 'Node 1', type: trojan, server: server1.com, port: 443, password: pwd1 }
    - { name: 'Node 2', type: anytls, server: server2.com, port: 443, password: pwd2 }
    - { name: 'Node 3', type: vmess, server: server3.com, port: 443, uuid: test-uuid }
`
    const nodes = parseClashYaml(inlineYaml)
    expect(nodes.length).toBe(3)
    expect(nodes[0]!.name).toBe('Node 1')
    expect(nodes[0]!.protocol).toBe('trojan')
    expect(nodes[1]!.name).toBe('Node 2')
    expect(nodes[1]!.protocol).toBe('anytls')
    expect(nodes[2]!.name).toBe('Node 3')
    expect(nodes[2]!.protocol).toBe('vmess')
  })

  it('should parse block format nodes (multi-line)', () => {
    const blockYaml = `
proxies:
    - name: US Server 01
      type: vmess
      server: us.example.com
      port: 443
      uuid: 12345678-1234-1234-1234-123456789012
    - name: SG Server 01
      type: trojan
      server: sg.example.com
      port: 443
      password: test-password
`
    const nodes = parseClashYaml(blockYaml)
    expect(nodes.length).toBe(2)
    expect(nodes[0]!.name).toBe('US Server 01')
    expect(nodes[0]!.protocol).toBe('vmess')
    expect(nodes[1]!.name).toBe('SG Server 01')
    expect(nodes[1]!.protocol).toBe('trojan')
  })

  it('should parse mixed format (inline + block)', () => {
    const nodes = parseClashYaml(MOCK_CLASH_YAML)
    expect(nodes.length).toBeGreaterThanOrEqual(6)

    // Check inline format nodes
    expect(nodes.some(n => n.name === '🇭🇰 HK 01')).toBe(true)
    expect(nodes.some(n => n.name === '🇯🇵 JP 01')).toBe(true)

    // Check block format nodes
    expect(nodes.some(n => n.name === 'US Server 01')).toBe(true)
    expect(nodes.some(n => n.name === 'SG Server 01')).toBe(true)
  })

  it('should support anytls protocol', () => {
    const nodes = parseClashYaml(MOCK_CLASH_YAML)
    const anytlsNodes = nodes.filter(n => n.protocol === 'anytls')
    expect(anytlsNodes.length).toBeGreaterThan(0)
  })

  it('should parse upstream proxy groups from Clash YAML', () => {
    const groupsYaml = `
proxies:
    - { name: '🇺🇸 US 01', type: trojan, server: us1.example.com, port: 443, password: pwd }
    - { name: '🇺🇸 US 02', type: trojan, server: us2.example.com, port: 443, password: pwd }
    - { name: '🇯🇵 JP 01', type: trojan, server: jp1.example.com, port: 443, password: pwd }
proxy-groups:
    - { name: 'US Auto', type: url-test, proxies: ['🇺🇸 US 01', '🇺🇸 US 02', DIRECT] }
    - name: Streaming
      type: select
      proxies:
        - 🇺🇸 US 01
        - 🇯🇵 JP 01
        - REJECT
`
    const groups = parseClashGroups(groupsYaml)

    expect(groups).toEqual([
      { name: 'US Auto', type: 'url-test', memberNames: ['🇺🇸 US 01', '🇺🇸 US 02'] },
      { name: 'Streaming', type: 'select', memberNames: ['🇺🇸 US 01', '🇯🇵 JP 01'] },
    ])
  })

  it('should detect countries from flags and region codes in subscription node names', () => {
    const regionalYaml = `
proxies:
    - { name: '🇩🇪 [三网]DE 02', type: trojan, server: de.example.com, port: 443, password: pwd }
    - { name: '🇨🇦 [三网]CA 01', type: trojan, server: ca.example.com, port: 443, password: pwd }
    - { name: '🇭🇰 [三网]HK 01', type: anytls, server: hk.example.com, port: 443, password: pwd }
`
    const nodes = parseClashYaml(regionalYaml)

    expect(nodes).toHaveLength(3)
    expect(nodes.map(node => [node.name, node.countryCode, node.country])).toEqual([
      ['🇩🇪 [三网]DE 02', 'DE', 'Germany'],
      ['🇨🇦 [三网]CA 01', 'CA', 'Canada'],
      ['🇭🇰 [三网]HK 01', 'HK', 'Hong Kong'],
    ])
  })

  it('should detect countries from standalone region codes without flags', () => {
    expect(detectCountry('[三网]DE 02')).toEqual({ country: 'Germany', countryCode: 'DE' })
    expect(detectCountry('[三网]CA 01')).toEqual({ country: 'Canada', countryCode: 'CA' })
    expect(detectCountry('[三网]HK 01')).toEqual({ country: 'Hong Kong', countryCode: 'HK' })
  })

  it('should handle edge cases with YAML parser', () => {
    const edgeCasesYaml = `
proxies:
    # Comments should be ignored
    - { name: "Node's Name", type: trojan, server: server.com, port: 443 }
    - name: "Name: with: colons"
      type: vmess
      server: example.com
      port: 443
    - { name: '包含{括号}的', type: ss, server: test.com, port: 8388 }
`
    const nodes = parseClashYaml(edgeCasesYaml)
    expect(nodes.length).toBe(3)
    expect(nodes[0]!.name).toBe("Node's Name")
    expect(nodes[1]!.name).toBe("Name: with: colons")
    expect(nodes[2]!.name).toBe('包含{括号}的')
  })

  it('should handle invalid YAML gracefully', () => {
    const invalidYaml = `
proxies:
    - { name: 'Unclosed bracket', type: trojan, server: test.com, port: 443
`
    const nodes = parseClashYaml(invalidYaml)
    // Should return empty array instead of throwing
    expect(Array.isArray(nodes)).toBe(true)
  })
})
