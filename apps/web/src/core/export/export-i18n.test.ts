import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const i18nDir = join(process.cwd(), 'src/i18n')

const REQUIRED_EXPORT_KEYS = [
  'title',
  'description',
  'default_profile_name',
  'all_formats',
  'quick_links_label',
  'advanced_profiles',
  'dns_address_mode',
  'dns_address_fake_ip',
  'dns_address_real_ip',
  'dns_resolution_mode',
  'dns_resolution_single',
  'dns_resolution_split',
  'dns_native_fake_ip_hint',
  'dns_managed_real_ip_exceptions',
  'dns_extra_real_ip_domains',
  'dns_extra_real_ip_domains_hint',
  'dns_badge_fake_ip_single',
  'dns_badge_fake_ip_split',
  'dns_badge_real_ip_single',
  'dns_badge_real_ip_split',
  'dns_capability_native',
  'dns_capability_selectable',
  'conversion_policy',
  'conversion_policy_inherit',
  'conversion_policy_hint_inherit',
  'conversion_policy_hint_inherit_effective',
  'conversion_policy_hint_compatible',
  'conversion_policy_hint_strict',
  'conversion_policy_badge_inherit',
  'conversion_policy_badge_inherit_effective',
  'conversion_policy_badge_compatible',
  'conversion_policy_badge_strict',
  'duplicate_config',
  'copy_name',
  'new_config',
  'edit_config',
  'empty_title',
  'empty_description',
  'format_full_config_capability_hint',
  'format_node_subscription_capability_hint',
  'advanced_scope',
  'scope_collections',
  'scope_groups',
  'scope_rules',
  'scope_remote_sets',
  'scope_summary_all',
  'scope_summary_custom',
  'scope_summary_count',
  'scope_summary_collections',
  'scope_summary_groups',
  'scope_summary_rules',
  'scope_summary_remote_sets',
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
  it('has labels for actionable export controls and capability guidance', () => {
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
