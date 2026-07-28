import { describe, expect, it } from 'vitest'
import { detectRuleSetFormat } from './detect'

describe('detectRuleSetFormat', () => {
  it('detects sing-box JSON source rule sets', () => {
    expect(detectRuleSetFormat('{"version":3,"rules":[{"domain":["example.com"]}]}')).toEqual({
      format: 'singbox',
      encoding: 'json',
      confidence: 'high',
    })
  })

  it('detects Mihomo YAML and infers its behavior', () => {
    expect(detectRuleSetFormat('payload:\n  - +.example.com\n  - example.org\n')).toEqual({
      format: 'mihomo',
      encoding: 'yaml',
      behavior: 'domain',
      confidence: 'high',
    })
  })

  it('detects Egern YAML', () => {
    expect(detectRuleSetFormat('domain_suffix_set:\n  - example.com\n')).toEqual({
      format: 'egern',
      encoding: 'yaml',
      confidence: 'high',
    })
  })

  it('falls back to generic text with inferred behavior', () => {
    expect(detectRuleSetFormat('10.0.0.0/8\n192.168.0.0/16\n')).toEqual({
      format: 'text',
      encoding: 'text',
      behavior: 'ipcidr',
      confidence: 'medium',
    })
  })

  it('detects UTF-8 rule sets received as response bytes', () => {
    const bytes = new TextEncoder().encode('payload:\n  - +.example.com\n')
    expect(detectRuleSetFormat(bytes)).toMatchObject({
      format: 'mihomo',
      encoding: 'yaml',
      behavior: 'domain',
    })
  })
})
