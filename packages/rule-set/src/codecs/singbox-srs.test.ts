import { describe, expect, it } from 'vitest'
import { convertRuleSetContent } from '../conversion'
import { parseSingboxSrs } from './singbox-srs'

const PRIVATE_DOMAIN_SRS = `
U1JTAnjajJBBayRFFMcrQxbl4SGioIJgBIUVnUdVzfZk5uSAeHA97WK5MBKhUl2Zrkx1V6eqensTEbKfwD2sX2DBSw3BkxcP4m0/gOzFqyezZy+L2NKZYEQJ7P/B7/+v94qieBtkQF4akH+0tdHz1RNCfj4hhAzow8GAvHD/dbJJXj4h5I2+NTu/uUnIY7J9Hru/jn57/M2bh+R613V/krcI2dh+ZWu2dT58kZDXxE1x6+PbD0la69tHKaVH330+SCmdCjFPKyFu94PlLdGns/O2EO8LIQ5+n/+axOyjO30jrVK6mX4QYv5jSml1dmf+YECEELPZbHZ/cE0I8cm7nz3Ynom1Pr1wkZ6s/afvV0/O/jhOadV1T5+ePUunq67rnqXT5uBUiIvfreaJEHLQx1+uSZXrhS0rH2sVjS29dFIZrXTwqGyNzqlKWZRRV9pJjbIsC3QeoSobj7HApb8rS8ytVqY69KExzhkTwI61N7q657SHONo3h3pv2bhF7vP9KOsy19FoFWVVmAVG6cORs4gGlHG5bQDMcWOwdVw11snGyqN7rcNCgitgAYU0ttJu2KKtVamXlvJ9GPo6j3lRehP8UfQmOrAVIGIFIJsKUC8wLLXWtjaU5tqg1G10sQlVrAEsIiDaENvGhuBlAzWlk6nco3yU7Uym0kDropN6z0VEAADKdqY049OxCr4usG48UMaAMc4ZY04i2jZ4XKt/27VRtlJSShkf3cjGO5Ppv9KEZuxGG1S7RETK+Hr6f46vtkvyER9xzjm7KBxjlmWtc1hHmjPGAOAqXmWX/K84G3HkhfVNtV7N1WJIwYLSku6xjMpQ9svMmMIY6ISD47pCQHs3GJoBYhYoNwhLCkifsxhsbrz95RdyeLx7vScdToe7X9EPxuzri+Puex++05G/AwAA//890DV1
`

const PRIVATE_IP_SRS = `
U1JTAnjaXIyxDcJAFEN9kUWR6hQGYAgWYAx6bgEmOMZJpOzAVWlYgkHgjCyqfBdPT/7WTzgk/DPRJCRxtI22cgFYqsTqrrpbOsClS1wzwPUksfnaANtgG8R2vcEQ2+zrLHGbAG5H27nAEF+4wxDf/iJJGSGxSPkTF1/tk/sjLPozLBR/KAa/AAAA//8zL2jw
`

const COMPREHENSIVE_V5_SRS = `
U1JTBXjaTJBNT/JAHMT/s/R5gAJSEF8OHjx4M7Z/3hLdz6E3QlLLQqqtrbyEevPjmEbvJl68+6HWVFpgDpuZSXb3lxFEgkBnEKWlF5dWkziLmdqUGXzc3aZpRwVx6CbKXiae706TqVotzBLKj+plHc0nBqzxXM1UMrJV4oZxoC7+bR4hgmESkWFqrf9vO+scjU/a01+h91QGDSuodplZ9pi5CnyZqF5n+YaZayjnX9VhOavF3Ln3n5y8aqEydqJ46diXDdS8KCywTtAce1G4xRzZbUHisHMkCMb3G+gUORt2bHwM490iqh+gnt+7WvtTv4kWs+x2Za8n+305GMjhUAMQVExIrxvzkKZps5gwcD1/FgWaaLeH8UPPlB1aE34DAAD//xUpXhM=
`

describe('parseSingboxSrs', () => {
  it('matches the official sing-box decompiler for domain matchers', () => {
    const result = parseSingboxSrs(decodeBase64(PRIVATE_DOMAIN_SRS))

    expect(result.version).toBe(2)
    expect(result.rules).toHaveLength(1)
    expect(result.rules[0]).toMatchObject({
      domain: expect.arrayContaining(['asusrouter.com', 'routerlogin.com']),
      domain_suffix: expect.arrayContaining(['localhost', 'home.arpa']),
      domain_regex: ['^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'],
    })
  })

  it('restores merged IPv4 and IPv6 sets as minimal CIDRs', () => {
    const result = parseSingboxSrs(decodeBase64(PRIVATE_IP_SRS))

    expect(result.rules).toEqual([{
      ip_cidr: [
        '0.0.0.0/8',
        '10.0.0.0/8',
        '100.64.0.0/10',
        '127.0.0.0/8',
        '169.254.0.0/16',
        '172.16.0.0/12',
        '192.0.0.0/24',
        '192.0.2.0/24',
        '192.88.99.0/24',
        '192.168.0.0/16',
        '198.18.0.0/15',
        '198.51.100.0/24',
        '203.0.113.0/24',
        '224.0.0.0/3',
        '::/127',
        'fc00::/7',
        'fe80::/10',
        'ff00::/8',
      ],
    }])
  })

  it('parses version 5 conditions and nested logical rules', () => {
    const result = parseSingboxSrs(decodeBase64(COMPREHENSIVE_V5_SRS))

    expect(result).toMatchObject({
      version: 5,
      rules: [
        {
          query_type: [1, 28],
          network: ['tcp', 'udp'],
          domain: ['exact.example'],
          domain_suffix: ['suffix.example'],
          source_ip_cidr: ['10.0.0.0/8'],
          ip_cidr: ['2001:db8::/32'],
          package_name_regex: ['^com\\.example\\.'],
          network_type: ['wifi', 'ethernet'],
          network_is_expensive: true,
          network_is_constrained: true,
          network_interface_address: {
            wifi: ['192.168.1.0/24'],
            cellular: ['2001:db8:1::/48'],
          },
          default_interface_address: ['172.16.0.0/12'],
          invert: true,
        },
        {
          type: 'logical',
          mode: 'or',
          rules: [
            { domain: ['logical.example'] },
            { ip_cidr: ['203.0.113.0/24'] },
          ],
          invert: true,
        },
      ],
    })
  })

  it('feeds SRS rules into semantics-preserving cross-client conversion', () => {
    const result = convertRuleSetContent(
      { format: 'singbox', behavior: 'ipcidr' },
      'mihomo',
      decodeBase64(PRIVATE_IP_SRS),
    )

    expect(result.convertedRuleCount).toBe(18)
    expect(result.content).toContain('10.0.0.0/8')
    expect(result.content).toContain('fc00::/7')

    const domains = convertRuleSetContent(
      { format: 'singbox', behavior: 'domain' },
      'mihomo',
      decodeBase64(PRIVATE_DOMAIN_SRS),
    )
    expect(domains.convertedRuleCount).toBeGreaterThan(100)
    expect(domains.content).toContain('+.localhost')
    expect(domains.skippedRuleTypes).toEqual({ 'DOMAIN-REGEX': 1 })
  })

  it('rejects corrupt and future-version containers', () => {
    expect(() => parseSingboxSrs(new Uint8Array([0x53, 0x52, 0x53, 0x01, 0x00])))
      .toThrow()
    expect(() => parseSingboxSrs(new Uint8Array([0x53, 0x52, 0x53, 0x06, 0x00])))
      .toThrow('Unsupported SRS version 6')
  })
})

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value.trim()), character => character.charCodeAt(0))
}
