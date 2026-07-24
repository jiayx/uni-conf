import { describe, expect, it } from 'vitest'
import {
  parseManualRuleLine,
  parseManualRules,
  parseManualRulesWithDiagnostics,
  resolveManualRuleGroupId,
} from './manual-rules'

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

  it('reports exact invalid source line numbers for all-or-nothing batch import', () => {
    expect(parseManualRulesWithDiagnostics(`
      # comment
      DOMAIN-SUFFIX,example.com,PROXY
      UNKNOWN,invalid.example,PROXY

      DOMAIN-SUFFIX
      MATCH,DIRECT
    `, 'builtin-proxy', groups, 20)).toEqual({
      candidateCount: 4,
      invalidLineNumbers: [4, 6],
      issues: [
        { lineNumber: 4, reason: 'unsupported-type', detail: 'UNKNOWN' },
        { lineNumber: 6, reason: 'missing-payload', detail: 'DOMAIN-SUFFIX' },
      ],
      rules: [
        expect.objectContaining({ payload: 'example.com', order: 20 }),
        expect.objectContaining({ type: 'MATCH', targetGroupId: 'builtin-direct', order: 23 }),
      ],
    })
  })

  it('rejects an explicit unknown target instead of silently using the fallback', () => {
    expect(parseManualRulesWithDiagnostics(
      'DOMAIN-SUFFIX,sensitive.example,TYPO-DIRECT',
      'builtin-proxy',
      groups,
      0,
    )).toMatchObject({
      rules: [],
      invalidLineNumbers: [1],
      issues: [
        { lineNumber: 1, reason: 'unknown-target', detail: 'TYPO-DIRECT' },
      ],
    })
  })

  it('accepts an omitted target but rejects unknown extra options', () => {
    expect(parseManualRuleLine(
      'IP-CIDR,10.0.0.0/8,,no-resolve',
      'builtin-direct',
      groups,
      0,
    )).toEqual(expect.objectContaining({
      targetGroupId: 'builtin-direct',
      noResolve: true,
    }))
    expect(parseManualRulesWithDiagnostics(
      'DOMAIN-SUFFIX,example.com,PROXY,script',
      'builtin-direct',
      groups,
      0,
    )).toMatchObject({
      rules: [],
      issues: [
        { lineNumber: 1, reason: 'unsupported-option', detail: 'script' },
      ],
    })
  })

  it('rejects malformed payloads and normalizes portable values', () => {
    expect(parseManualRulesWithDiagnostics(
      [
        'IP-CIDR,999.1.1.1/24,DIRECT',
        'PORT,9000-8000,PROXY',
        'DOMAIN-REGEX,[invalid,PROXY',
      ].join('\n'),
      'builtin-direct',
      groups,
      0,
    )).toMatchObject({
      rules: [],
      invalidLineNumbers: [1, 2, 3],
      issues: [
        { lineNumber: 1, reason: 'invalid-payload', detail: 'invalid-ipv4-cidr' },
        { lineNumber: 2, reason: 'invalid-payload', detail: 'invalid-port' },
        { lineNumber: 3, reason: 'invalid-payload', detail: 'invalid-domain-regex' },
      ],
    })
    expect(parseManualRuleLine(
      'PORT,8000:9000,PROXY',
      'builtin-direct',
      groups,
      0,
    )).toEqual(expect.objectContaining({
      payload: '8000-9000',
    }))
  })

  it('resolves targets by id or display name and ignores no-resolve', () => {
    expect(resolveManualRuleGroupId('custom-ai', groups)).toBe('custom-ai')
    expect(resolveManualRuleGroupId('AI', groups)).toBe('custom-ai')
    expect(resolveManualRuleGroupId('no-resolve', groups)).toBeUndefined()
  })
})
