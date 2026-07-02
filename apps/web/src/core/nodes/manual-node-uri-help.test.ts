import { describe, expect, it } from 'vitest'
import { URI_SCHEME_TO_PROTOCOL } from '@uni-conf/types'
import {
  MANUAL_NODE_URI_HELP_TEXT,
  MANUAL_NODE_URI_PLACEHOLDER,
} from './manual-node-uri-help'

describe('manual node URI help text', () => {
  it('is generated from the shared protocol URI scheme registry', () => {
    for (const scheme of Object.keys(URI_SCHEME_TO_PROTOCOL)) {
      expect(MANUAL_NODE_URI_HELP_TEXT).toContain(`${scheme}://`)
    }
  })

  it('keeps the placeholder compact while covering common URI entry', () => {
    expect(MANUAL_NODE_URI_PLACEHOLDER).toContain('ss://...')
    expect(MANUAL_NODE_URI_PLACEHOLDER.split(' / ')).toHaveLength(6)
  })
})

