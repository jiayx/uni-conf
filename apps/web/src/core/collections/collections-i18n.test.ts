import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const i18nDir = join(process.cwd(), 'src/i18n')

const REQUIRED_COLLECTION_KEYS = [
  'description',
  'auto_generate',
  'empty_title',
  'empty_description',
  'auto_label',
  'manual_label',
  'group_type',
  'group_type_select',
  'group_type_url_test',
  'group_type_fallback',
  'auto_generate_title',
  'include_flag',
  'recognized_countries',
  'no_recognized_countries',
  'recognized_tag_pools',
  'no_recognized_tag_pools',
  'source_groups',
  'no_source_groups',
  'already_added',
  'source_group_node_count',
  'auto_generate_help',
]

describe('collection i18n keys', () => {
  it('has labels for automatic node-group generation guidance', () => {
    for (const locale of ['zh', 'en']) {
      const messages = readMessages(locale)
      for (const key of REQUIRED_COLLECTION_KEYS) {
        expect(messages.collections[key], `${locale}: collections.${key}`).toBeTruthy()
      }
      expect(messages.common.apply, `${locale}: common.apply`).toBeTruthy()
    }
  })
})

function readMessages(locale: string): {
  common: Record<string, string>
  collections: Record<string, string>
} {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8')) as {
    common: Record<string, string>
    collections: Record<string, string>
  }
}
