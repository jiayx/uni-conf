import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const i18nDir = join(process.cwd(), 'src/i18n')

const REQUIRED_GROUP_KEYS = [
  'description',
  'template_title',
  'template_meta',
  'foundation_title',
  'foundation_meta',
  'foundation_rule_targets',
  'global_node_outlets',
  'auto_outlet_candidates',
  'default_outlet',
  'system_recommended',
  'empty_title',
  'empty_description',
  'auto_members_title',
  'auto_members_text',
]

describe('group i18n keys', () => {
  it('has labels for zero-setup policy template guidance', () => {
    for (const locale of ['zh', 'en']) {
      const messages = readMessages(locale)
      for (const key of REQUIRED_GROUP_KEYS) {
        expect(messages.groups[key], `${locale}: groups.${key}`).toBeTruthy()
      }
    }
  })
})

function readMessages(locale: string): { groups: Record<string, string> } {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8')) as { groups: Record<string, string> }
}
