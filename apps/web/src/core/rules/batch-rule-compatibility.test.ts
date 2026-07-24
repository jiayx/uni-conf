import { describe, expect, it } from 'vitest'
import { summarizeBatchRuleCompatibility } from './batch-rule-compatibility'

describe('summarizeBatchRuleCompatibility', () => {
  it('aggregates payload-aware conversions, omissions, and unsupported rules', () => {
    const summaries = summarizeBatchRuleCompatibility([
      { type: 'PORT', payload: '443', noResolve: true },
      { type: 'DOMAIN-SUFFIX', payload: 'example.com' },
      { type: 'NETWORK', payload: 'icmp' },
    ], ['mihomo', 'singbox', 'quantumultx'])

    expect(summaries).toEqual([
      {
        format: 'mihomo',
        total: 3,
        full: 1,
        convert: 1,
        partial: 0,
        unsupported: 1,
        optionOmitted: 1,
      },
      {
        format: 'singbox',
        total: 3,
        full: 3,
        convert: 0,
        partial: 0,
        unsupported: 0,
        optionOmitted: 1,
      },
      {
        format: 'quantumultx',
        total: 3,
        full: 0,
        convert: 1,
        partial: 0,
        unsupported: 2,
        optionOmitted: 1,
      },
    ])
  })
})
