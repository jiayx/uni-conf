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
  'preset_label',
  'preset_help',
  'default_target',
  'required_error',
  'save_error',
  'source_override_validate',
  'source_override_validate_label',
  'source_override_validate_all',
  'source_override_discover',
  'source_override_discovered',
  'source_override_validate_after_discovery',
  'source_override_input_errors_blocked',
  'source_override_risk_compatible',
  'source_override_validation_summary',
  'source_health_pending',
  'source_health_stale',
  'source_health_stale_notice',
  'source_health_default',
  'source_health_summary',
  'source_health_more_issues',
  'validate_all_sources',
  'revalidate_all_sources',
  'preview_issue_resolution_label',
  'preview_issue_resolution_repair-source-rule',
  'preview_issue_resolution_use-native-source',
  'preview_issue_resolution_remove-unsupported-option',
  'preview_configure_native_source',
  'configure_native_sources',
  'configure_managed_sources_title',
  'managed_sources_help',
  'managed_preset_source_help',
  'source_override_validation_error',
  'source_override_error_unsafe_url',
  'source_override_error_invalid_format',
  'source_override_error_invalid_behavior',
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
