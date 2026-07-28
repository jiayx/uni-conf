import { describe, expect, it } from 'vitest'
import { resolveRuleSetRuleForTarget } from './rule-compatibility'

describe('rule compatibility', () => {
  it('uses one resolver for transport networks and sniffed protocols', () => {
    expect(resolveRuleSetRuleForTarget('NETWORK', 'tcp', 'surge')).toEqual({
      level: 'convert',
      type: 'PROTOCOL',
      payload: 'TCP',
      reason: 'network-to-protocol',
    })
    expect(resolveRuleSetRuleForTarget('PROTOCOL', 'tls', 'singbox')).toEqual({
      level: 'full',
      type: 'PROTOCOL',
      payload: 'tls',
    })
    expect(resolveRuleSetRuleForTarget('PROTOCOL', 'tls', 'mihomo')).toMatchObject({
      level: 'unsupported',
      reason: 'unsupported-rule-value',
    })
  })
})
