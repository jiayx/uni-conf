import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const i18nDir = join(process.cwd(), 'src/i18n')

const REQUIRED_SETTINGS_KEYS = [
  'export_node_naming',
  'naming_smart',
  'naming_smart_desc',
  'naming_original',
  'naming_region_sequence',
  'naming_source_region_sequence',
  'auto_node_groups',
  'auto_node_groups_enabled',
  'auto_node_include_flag',
  'auto_node_groups_hint',
  'auto_node_type_url_test',
  'auto_node_type_url_test_desc',
  'auto_node_type_select',
  'auto_node_type_fallback',
  'saving',
]

describe('settings i18n keys', () => {
  it('has labels for automatic node-group zero-setup controls', () => {
    for (const locale of ['zh', 'en']) {
      const messages = readMessages(locale)
      for (const key of REQUIRED_SETTINGS_KEYS) {
        expect(messages.settings[key], `${locale}: settings.${key}`).toBeTruthy()
      }
    }
  })
})

function readMessages(locale: string): { settings: Record<string, string> } {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8')) as {
    settings: Record<string, string>
  }
}
