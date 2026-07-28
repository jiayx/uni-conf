import { describe, expect, it } from 'vitest'
import { inspectRuleSetContent, inspectRuleSetValues, parseRuleSetForInspection } from './inspection'

describe('rule set inspection', () => {
  it('parses Egern sets without losing their source field', () => {
    const parsed = parseRuleSetForInspection('domain_suffix_set:\n  - example.com\n', 'egern')
    expect(parsed.mode).toBe('structured')
    expect(parsed.rules).toHaveLength(1)
    expect(inspectRuleSetValues(parsed.rules ?? [], 'domain')).toEqual([])
    expect(inspectRuleSetValues(parsed.rules ?? [], 'ipcidr')).toEqual([
      { code: 'invalid_rule', line: 1 },
    ])
  })

  it('reports malformed structured documents with neutral error codes', () => {
    expect(parseRuleSetForInspection('{"version":3}', 'singbox')).toEqual({
      mode: 'structured',
      error: 'invalid_structure',
    })
    expect(parseRuleSetForInspection('{', 'singbox')).toEqual({
      mode: 'structured',
      error: 'invalid_json',
    })
  })

  it('validates plain CIDR rules with their original line order', () => {
    const parsed = parseRuleSetForInspection('10.0.0.0/8\nnot-a-cidr\n', 'text')
    expect(inspectRuleSetValues(parsed.rules ?? [], 'ipcidr')).toEqual([
      { code: 'invalid_rule', line: 2 },
    ])
  })

  it('recognizes, parses, and validates response bytes through one entry point', () => {
    const content = new TextEncoder().encode(JSON.stringify({
      version: 3,
      rules: [{ domain_suffix: ['example.com'] }],
    }))
    expect(inspectRuleSetContent(content, {
      format: 'text',
      behavior: 'domain',
      contentType: 'application/json',
    })).toMatchObject({
      detected: { format: 'singbox', encoding: 'json' },
      mode: 'structured',
      rules: [{ domain_suffix: ['example.com'] }],
      issues: [],
    })
  })
})
