import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppSettings, Language, ThemePreference } from '@uni-conf/types'

interface SettingsState extends AppSettings {
  setLanguage: (lang: Language) => void
  setTheme: (theme: ThemePreference) => void
  setShowCompatibilityWarnings: (showCompatibilityWarnings: boolean) => void
  setEnableAutoRefresh: (enableAutoRefresh: boolean) => void
  setAutoRefreshInterval: (autoRefreshInterval: number) => void
  applySettings: (settings: AppSettings) => void
  applyTheme: (theme: ThemePreference) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      language: 'zh',
      theme: 'system',
      showCompatibilityWarnings: true,
      enableAutoRefresh: false,
      autoRefreshInterval: 60,

      setLanguage: (language) => {
        set({ language })
        // i18n change is handled by the component that calls this
      },

      setTheme: (theme) => {
        set({ theme })
        get().applyTheme(theme)
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
