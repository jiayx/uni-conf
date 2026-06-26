import { describe, expect, it } from 'vitest'
import { parseManualRuleLine, parseManualRules, resolveManualRuleGroupId } from './manual-rules'

const groups = [
  { id: 'builtin-proxy', name: 'PROXY' },
  { id: 'builtin-direct', name: 'DIRECT' },
  { id: 'custom-ai', name: 'AI' },
]

describe('manual rule parsing', () => {
  it('parses Clash-style lines and resolves explicit target groups', () => {
    expect(parseManualRules(`
      # local override
      DOMAIN-SUFFIX,example.com,PROXY
      DOMAIN,api.example.com,custom-ai
      IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
    `, 'builtin-proxy', groups, 10)).toEqual([
      expect.objectContaining({ type: 'DOMAIN-SUFFIX', payload: 'example.com', targetGroupId: 'builtin-proxy', noResolve: false, order: 10 }),
      expect.objectContaining({ type: 'DOMAIN', payload: 'api.example.com', targetGroupId: 'custom-ai', noResolve: false, order: 11 }),
      expect.objectContaining({ type: 'IP-CIDR', payload: '10.0.0.0/8', targetGroupId: 'builtin-direct', noResolve: true, order: 12 }),
    ])
  })

  it('uses the selected fallback target when a line omits policy', () => {
    expect(parseManualRuleLine('DOMAIN-SUFFIX,example.org', 'builtin-proxy', groups, 0)).toEqual(expect.objectContaining({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.org',
      targetGroupId: 'builtin-proxy',
    }))
  })

  it('handles MATCH and ignores invalid or incomplete rules', () => {
    expect(parseManualRules(`
      MATCH,PROXY
      UNKNOWN,example.com,PROXY
      DOMAIN-SUFFIX
    `, 'builtin-direct', groups, 0)).toEqual([
      expect.objectContaining({ type: 'MATCH', payload: '', targetGroupId: 'builtin-proxy' }),
    ])
  })

  it('resolves targets by id or display name and ignores no-resolve', () => {
    expect(resolveManualRuleGroupId('custom-ai', groups)).toBe('custom-ai')
    expect(resolveManualRuleGroupId('AI', groups)).toBe('custom-ai')
    expect(resolveManualRuleGroupId('no-resolve', groups)).toBeUndefined()
  })
})
