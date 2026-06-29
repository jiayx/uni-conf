import { describe, expect, it } from 'vitest'
import type { ProxySource } from '@uni-conf/types'
import { shouldRefreshSourceAfterUpdate } from './source-refresh'

function source(overrides: Partial<ProxySource> = {}): ProxySource {
  return {
    id: 'source-1',
    name: 'Example',
    type: 'url',
    url: 'https://example.com/sub',
    format: 'auto',
    enabled: true,
    nodeCount: 0,
    updateInterval: 0,
    tags: [],
    groups: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('shouldRefreshSourceAfterUpdate', () => {
  it('refreshes URL sources when the subscription URL changes', () => {
    expect(shouldRefreshSourceAfterUpdate(source(), { url: 'https://example.com/next' })).toBe(true)
  })

  it('refreshes URL sources when the parser format changes', () => {
    expect(shouldRefreshSourceAfterUpdate(source(), { format: 'mihomo' })).toBe(true)
  })

  it('refreshes URL sources when the User-Agent changes', () => {
    expect(shouldRefreshSourceAfterUpdate(source({ userAgent: 'Surge/5.9.0' }), {
      userAgent: 'clash.meta/v1.19.23',
    })).toBe(true)
  })

  it('does not refresh for unrelated edits or whitespace-only URL changes', () => {
    expect(shouldRefreshSourceAfterUpdate(source(), {
      url: '  https://example.com/sub  ',
      format: 'auto',
      userAgent: undefined,
    })).toBe(false)
  })

  it('does not refresh non-URL sources', () => {
    expect(shouldRefreshSourceAfterUpdate(source({ type: 'manual', url: undefined }), {
      url: 'https://example.com/sub',
      format: 'mihomo',
      userAgent: 'Surge/5.9.0',
    })).toBe(false)
  })
})
