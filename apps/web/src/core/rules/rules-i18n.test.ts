import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const i18nDir = join(process.cwd(), 'src/i18n')

const REQUIRED_RULE_KEYS = [
  'title',
  'new',
  'reorder_hint',
  'batch_add',
  'empty_title',
  'empty_description',
  'edit',
  'default_target',
  'batch_text',
  'batch_help',
  'delete_confirm',
  'payload_required',
  'no_valid_rules',
  'batch_issue_unsupported_type',
  'batch_issue_missing_payload',
  'batch_issue_unknown_target',
  'batch_issue_unsupported_option',
  'batch_issue_more',
  'batch_issue_fix_all',
  'batch_limit',
  'batch_save_failed',
  'save_failed',
  'delete_rule',
]

describe('manual rule i18n keys', () => {
  it('has labels that keep manual rules framed as optional overrides', () => {
    for (const locale of ['zh', 'en']) {
      const messages = readMessages(locale)
      for (const key of REQUIRED_RULE_KEYS) {
        expect(messages.rules[key], `${locale}: rules.${key}`).toBeTruthy()
      }
    }
  })
})

function readMessages(locale: string): { rules: Record<string, string> } {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8')) as {
    rules: Record<string, string>
  }
}
