import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const i18nDir = join(process.cwd(), 'src/i18n')

const REQUIRED_EXPORT_KEYS = [
  'title',
  'description',
  'new_config',
  'edit_config',
  'empty_title',
  'empty_description',
  'default_full_title',
  'default_full_text',
  'advanced_scope',
  'scope_collections',
  'scope_groups',
  'scope_rules',
  'scope_remote_sets',
  'scope_all_enabled',
  'scope_selected',
  'compatible_remote_sets_hint',
  'validation_checking',
  'validation_ready',
  'validation_blocked',
  'validation_warning_summary',
  'validation_blocked_summary',
  'validation_summary_with_lines',
  'validation_more',
]

describe('export i18n keys', () => {
  it('has labels for default complete-export guidance', () => {
    for (const locale of ['zh', 'en']) {
      const messages = readMessages(locale)
      for (const key of REQUIRED_EXPORT_KEYS) {
        expect(messages.export[key], `${locale}: export.${key}`).toBeTruthy()
      }
    }
  })
})

function readMessages(locale: string): { export: Record<string, string> } {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8')) as {
    export: Record<string, string>
  }
}
