import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES, DEFAULT_ROUTING_POLICY_SCENARIOS } from '@uni-conf/shared'
import type { AppSettings, ThemePreference } from '@uni-conf/types'

interface SettingsState extends AppSettings {
  applySettings: (settings: AppSettings) => void
  applyTheme: (theme: ThemePreference) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      language: 'zh',
      theme: 'system',
      unmatchedTrafficPolicy: 'proxy',
      routingPolicyScenarios: [...DEFAULT_ROUTING_POLICY_SCENARIOS],
      exportNodeNamingMode: 'smart',
      dnsRealIpDomains: [],
      showCompatibilityWarnings: true,
      ruleSetConversionPolicy: 'compatible',
      enableAutoRefresh: true,
      autoRefreshInterval: DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES,
      autoNodeGroupsEnabled: true,
      autoNodeGroupTypes: ['url-test'],
      autoNodeGroupIncludeFlag: true,

      applySettings: (settings) => {
        set(settings)
        get().applyTheme(settings.theme)
      },

      applyTheme: (theme) => {
        const html = document.documentElement
        if (theme === 'system') {
          html.removeAttribute('data-theme')
        } else {
          html.setAttribute('data-theme', theme)
        }
      },
    }),
    { name: 'uni-conf-settings' }
  )
)
