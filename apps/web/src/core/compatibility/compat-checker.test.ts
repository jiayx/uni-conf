import { describe, expect, it } from 'vitest'
import type { ProxyRule } from '@uni-conf/types'
import { EXPORT_SUBSCRIPTION_FORMATS } from '@uni-conf/shared'
import { checkAllCompatibility, checkRuleCompatibility } from './compat-checker'

const createdAt = '2026-01-01T00:00:00.000Z'

describe('rule compatibility checker', () => {
  it('fills compatibility from the shared export format matrix', () => {
    const [rule] = checkAllCompatibility([
      {
        id: 'rule-geo',
        type: 'GEOSITE',
        payload: 'openai',
        targetGroupId: 'builtin-ai',
        enabled: true,
        order: 1,
        compatibility: [],
        createdAt,
        updatedAt: createdAt,
      } satisfies ProxyRule,
    ])

    expect(rule?.compatibility.map((item) => item.client)).toEqual(EXPORT_SUBSCRIPTION_FORMATS)
    expect(rule?.compatibility.find((item) => item.client === 'mihomo')?.level).toBe('full')
    expect(rule?.compatibility.find((item) => item.client === 'shadowrocket')?.level).toBe('unsupported')
    expect(rule?.compatibility.find((item) => item.client === 'nodes_raw')?.level).toBe('unsupported')
  })

  it('uses the rule payload when protocol semantics differ by client', () => {
    const protocolTcp = {
      id: 'protocol-tcp',
      type: 'PROTOCOL',
      payload: 'tcp',
      targetGroupId: 'builtin-proxy',
      enabled: true,
      order: 1,
      compatibility: [],
      createdAt,
      updatedAt: createdAt,
    } satisfies ProxyRule
    const protocolHttp = { ...protocolTcp, id: 'protocol-http', payload: 'http' }
    const networkIcmp = {
      ...protocolTcp,
      id: 'network-icmp',
      type: 'NETWORK',
      payload: 'icmp',
    } satisfies ProxyRule

    expect(checkRuleCompatibility(protocolTcp, 'mihomo').level).toBe('convert')
    expect(checkRuleCompatibility(protocolHttp, 'mihomo').level).toBe('unsupported')
    expect(checkRuleCompatibility(protocolHttp, 'singbox').level).toBe('full')
    expect(checkRuleCompatibility(networkIcmp, 'mihomo').level).toBe('unsupported')
    expect(checkRuleCompatibility(networkIcmp, 'singbox').level).toBe('full')
  })
})
