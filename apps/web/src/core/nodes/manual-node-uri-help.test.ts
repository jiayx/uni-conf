import { describe, expect, it } from 'vitest'
import { MANUAL_NODE_URI_PLACEHOLDER } from './manual-node-uri-help'

describe('manual node URI help text', () => {
  it('keeps the placeholder compact while covering common URI entry', () => {
    expect(MANUAL_NODE_URI_PLACEHOLDER).toContain('ss://...')
    expect(MANUAL_NODE_URI_PLACEHOLDER.split(' / ')).toHaveLength(6)
  })
})
