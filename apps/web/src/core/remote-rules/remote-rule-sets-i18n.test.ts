import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const i18nDir = join(process.cwd(), 'src/i18n')

const REQUIRED_REMOTE_RULE_SET_KEYS = [
  'title',
  'description',
  'add_supplement',
  'foundation_title',
  'foundation_meta',
  'empty_title',
  'empty_description',
  'target',
  'section_meta',
  'rule_target',
  'target_disabled',
  'system_disabled_notice',
  'source_selection_label',
  'subscription_sources',
  'subscription_rule_set',
  'select_subscription_rule_set',
  'no_subscription_rule_sets',
  'subscription_source_linked',
  'subscription_linked',
  'subscription_missing',
  'unreferenced',
  'already_added',
  'preset_help',
  'default_target',
  'required_error',
  'save_error',
  'source_override_discover',
  'source_override_discovered',
  'configure_native_sources',
  'configure_managed_sources_title',
  'managed_sources_help',
  'managed_preset_source_help',
  'disabled_target_error',
  'all_enabled',
  'behavior_domain',
  'behavior_classical',
]

describe('remote rule set i18n keys', () => {
  it('has labels for zero-setup routing policy guidance', () => {
    for (const locale of ['zh', 'en']) {
      const messages = readMessages(locale)
      for (const key of REQUIRED_REMOTE_RULE_SET_KEYS) {
        expect(messages.remoteRuleSets[key], `${locale}: remoteRuleSets.${key}`).toBeTruthy()
      }
    }
  })
})

function readMessages(locale: string): { remoteRuleSets: Record<string, string> } {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8')) as {
    remoteRuleSets: Record<string, string>
  }
}
