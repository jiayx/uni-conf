import { describe, expect, it } from 'vitest'
import { buildPrivateCacheKey } from './private-cache-key'

describe('buildPrivateCacheKey', () => {
  it('uses a versioned SHA-256 digest without exposing sensitive input', async () => {
    const key = await buildPrivateCacheKey('converted-rule-set', 2, 'https://rules.example.com/list?token=secret')
    expect(key).toMatch(/^converted-rule-set:v2:[a-f0-9]{64}$/)
    expect(key).not.toContain('rules.example.com')
    expect(key).not.toContain('secret')
  })

  it('separates namespaces, versions, and inputs', async () => {
    const keys = await Promise.all([
      buildPrivateCacheKey('converted-rule-set', 1, 'same'),
      buildPrivateCacheKey('converted-rule-set', 2, 'same'),
      buildPrivateCacheKey('rule-set-reachable', 1, 'same'),
      buildPrivateCacheKey('converted-rule-set', 2, 'different'),
    ])
    expect(new Set(keys)).toHaveLength(keys.length)
  })
})
