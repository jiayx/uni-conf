import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES } from '@uni-conf/shared'
import type { AppSettings, AutoNodeGroupType, DnsMode, ExportNodeNamingMode, Language, ThemePreference } from '@uni-conf/types'

interface SettingsState extends AppSettings {
  setLanguage: (lang: Language) => void
  setTheme: (theme: ThemePreference) => void
  setDnsMode: (dnsMode: DnsMode) => void
  setExportNodeNamingMode: (exportNodeNamingMode: ExportNodeNamingMode) => void
  setShowCompatibilityWarnings: (showCompatibilityWarnings: boolean) => void
  setEnableAutoRefresh: (enableAutoRefresh: boolean) => void
  setAutoRefreshInterval: (autoRefreshInterval: number) => void
  setAutoNodeGroupsEnabled: (autoNodeGroupsEnabled: boolean) => void
  setAutoNodeGroupTypes: (autoNodeGroupTypes: AutoNodeGroupType[]) => void
  setAutoNodeGroupIncludeFlag: (autoNodeGroupIncludeFlag: boolean) => void
  applySettings: (settings: AppSettings) => void
  applyTheme: (theme: ThemePreference) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      language: 'zh',
      theme: 'system',
      routingPolicyTemplate: 'common',
      dnsMode: 'smart',
      exportNodeNamingMode: 'smart',
      showCompatibilityWarnings: true,
      enableAutoRefresh: true,
      autoRefreshInterval: DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES,
      autoNodeGroupsEnabled: true,
      autoNodeGroupTypes: ['url-test'],
      autoNodeGroupIncludeFlag: true,

      setLanguage: (language) => {
        set({ language })
        // i18n change is handled by the component that calls this
      },

      setTheme: (theme) => {
        set({ theme })
        get().applyTheme(theme)
      },

      setDnsMode: (dnsMode) => {
        set({ dnsMode })
      },

      setExportNodeNamingMode: (exportNodeNamingMode) => {
        set({ exportNodeNamingMode })
      },

      setShowCompatibilityWarnings: (showCompatibilityWarnings) => {
        set({ showCompatibilityWarnings })
      },

      setEnableAutoRefresh: (enableAutoRefresh) => {
        set({ enableAutoRefresh })
      },

      setAutoRefreshInterval: (autoRefreshInterval) => {
        set({ autoRefreshInterval })
      },

      setAutoNodeGroupsEnabled: (autoNodeGroupsEnabled) => {
        set({ autoNodeGroupsEnabled })
      },

      setAutoNodeGroupTypes: (autoNodeGroupTypes) => {
        set({ autoNodeGroupTypes })
      },

      setAutoNodeGroupIncludeFlag: (autoNodeGroupIncludeFlag) => {
        set({ autoNodeGroupIncludeFlag })
      },

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
