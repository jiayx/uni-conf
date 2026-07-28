import { describe, expect, it } from 'vitest'
import { convertRuleSetContent } from '../conversion'
import { parseMihomoMrs } from './mihomo-mrs'

const PRIVATE_DOMAIN_MRS = `
KLUv/WS/A8UWANJxoEMgcZMAjzjacTgBoAPBY4YwQu1oBAg8FsDiUBqbjDKJtDJJaXMS6USSdr6OIa3rXABlWbII2nIKyqcdOeYe5mCZhral/XjYf0PRXyeoNfWfali1Drb/X3S6n3oDNfwqUv+xpfVsSMX2wEmr28PHv7u7v2U2NH3KxOn/H2P8QIz9Xo6iqGsep2maMlNm4mxGNFOE/0VcpXERYlNww9mMaKgImSlCCOfkJuauff/vTOPsP2+McZpifOzujvDZhj2EZa1VGs5EQc5IhP//474eOi++3OvkbEaozAQ9k7NpCLHubzPTNLtxWLP/f/tj+NI2fDHXdL670g+EXbG2lFKRdhD9r23+V///ZX9xzTBLptXMCn1wfxrLGsJTJmhF1Kowew7CpZetM3TQQ933M/Tb3ArLtNu8dqumy71uHuq/2c+t1etvL4uWTXxQDV09cUUrph8Lm41TPtkHdDeRh6rUlAx+Ru/KRWtGNfZarffW3rRM5aoVtZ9bs0Mmegg/26zrz+5DljVP56UXxfO2uqp7j9nqmUYrWqt5Z2bZiisMZ5dlQfRTzQkAXs4hL0vZoqGUs0vXdaSWnLMNG11HyjkHjhol0ooWOWpkD1m65CxBSuQGKk5KJh2RAhgMBoNx+YBPRY2cZUsuZZBSTpAlCWKUcybJnE9ILE6ktKQs5QekXJIcpJQpcs4kWcpSxiAlKX/kEhIpJcmJ/EyYkFiQJTLBG308FwcalOjous6BCAIFJF5osOzoFkAB76F4LyoAPF5UFIR4MWMEjRsrEmJ0Hcp7byQiYwNj9EJudB6DEgZEnocIAp0XYEMIpsCTAfJGFV7H894HyHsPBaXz3mjAh+dxwYRCJyCggoNkAjkPxFsx7+5ibRrnhmRADC0g5t1drE3j3CABTHZ/YaFQ2LmQelA0lmIYQGc+wt6cnwNuBisT+2nWhpSwjc4DNYTs6Epvc+uLZ8RjuOINPw8f/w==
`

const PRIVATE_IP_MRS = `
KLUv/UQAXgFlBAAyxRIdsIcE3hPUdTHL5lAYiMObvTADG99dOvJMI3FT6gG9iPyQXawoPcFO2AkmTAEEIXW7pZYy5o8PgQEw8uVruzUc4Dltb2//0aUYCoQpoDDOtQWQw7AFXbLKHGWRW8EU7KUApwPHg2xH5iCTlSXXWUdWLpeTy8nlKj+yfWYDJGzHVdFB2nM9ngz2B7hjQis=
`

describe('parseMihomoMrs', () => {
  it('decodes an official Mihomo domain MRS trie', () => {
    const result = parseMihomoMrs(decodeBase64(PRIVATE_DOMAIN_MRS), { expectedBehavior: 'domain' })

    expect(result.behavior).toBe('domain')
    expect(result.declaredRuleCount).toBe(130)
    expect(result.rules).toHaveLength(130)
    expect(result.rules).toContain('+.10.in-addr.arpa')
    expect(result.rules).toContain('+.localhost.ptlogin2.qq.com')
  })

  it('decodes official IPv4 and IPv6 MRS ranges as minimal CIDRs', () => {
    const result = parseMihomoMrs(decodeBase64(PRIVATE_IP_MRS), { expectedBehavior: 'ipcidr' })

    expect(result.behavior).toBe('ipcidr')
    expect(result.declaredRuleCount).toBe(18)
    expect(result.rules).toEqual([
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
    ])
  })

  it('rejects a behavior mismatch', () => {
    expect(() => parseMihomoMrs(decodeBase64(PRIVATE_IP_MRS), { expectedBehavior: 'domain' }))
      .toThrow('expected domain')
  })

  it('feeds decoded MRS rules into cross-client conversion', () => {
    const result = convertRuleSetContent(
      { format: 'mrs', behavior: 'ipcidr' },
      'singbox',
      decodeBase64(PRIVATE_IP_MRS),
    )

    expect(result.convertedRuleCount).toBe(18)
    expect(JSON.parse(result.content)).toMatchObject({
      version: 3,
      rules: expect.arrayContaining([
        { ip_cidr: ['10.0.0.0/8'] },
        { ip_cidr: ['fc00::/7'] },
      ]),
    })
  })
})

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value.trim()), character => character.charCodeAt(0))
}
