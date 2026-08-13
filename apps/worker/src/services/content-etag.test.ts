import { describe, expect, it } from 'vitest'
import { buildContentEtag, requestMatchesEtag } from './content-etag'

describe('content ETags', () => {
  it('is deterministic and changes with generated content', async () => {
    expect(await buildContentEtag('same')).toBe(await buildContentEtag('same'))
    expect(await buildContentEtag('same')).not.toBe(await buildContentEtag('different'))
  })

  it('matches strong, weak, wildcard, and comma-separated validators', () => {
    const etag = '"abc"'
    expect(requestMatchesEtag(new Request('https://example.com', { headers: { 'If-None-Match': etag } }), etag)).toBe(true)
    expect(requestMatchesEtag(new Request('https://example.com', { headers: { 'If-None-Match': `"old", W/${etag}` } }), etag)).toBe(true)
    expect(requestMatchesEtag(new Request('https://example.com', { headers: { 'If-None-Match': '*' } }), etag)).toBe(true)
    expect(requestMatchesEtag(new Request('https://example.com', { headers: { 'If-None-Match': '"old"' } }), etag)).toBe(false)
  })
})
