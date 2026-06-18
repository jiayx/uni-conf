import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Input } from '@/components/ui/Input/Input'
import { api } from '@/lib/api'
import { useSettingsStore } from '@/store/settings.store'
import type { AppSettings, Language, ThemePreference } from '@uni-conf/types'
import styles from './Settings.module.css'

export function Settings() {
  const { t, i18n } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const {
    language,
    theme,
    showCompatibilityWarnings,
    enableAutoRefresh,
    autoRefreshInterval,
    setLanguage,
    setTheme,
    setShowCompatibilityWarnings,
    setEnableAutoRefresh,
    setAutoRefreshInterval,
    applySettings,
  } = useSettingsStore()

  const persistSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSaving(true)
    try {
      const updated = await api.settings.update(patch)
      applySettings(updated)
      if (patch.language) void i18n.changeLanguage(updated.language)
      setStatus(null)
    } catch (e) {
      setStatus((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [applySettings, i18n])

  useEffect(() => {
    queueMicrotask(() => {
      void api.settings.get()
        .then(settings => {
          applySettings(settings)
          void i18n.changeLanguage(settings.language)
        })
        .catch(e => setStatus((e as Error).message))
    })
  }, [applySettings, i18n])

  const handleLanguage = (lang: Language) => {
    setLanguage(lang)
    void i18n.changeLanguage(lang)
    void persistSettings({ language: lang })
  }

  const handleTheme = (nextTheme: ThemePreference) => {
    setTheme(nextTheme)
    void persistSettings({ theme: nextTheme })
  }

  const handleExport = async () => {
    try {
      const blob = await api.settings.exportData()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `uni-conf-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setStatus(t('settings.export_success'))
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    if (!confirm(t('settings.import_confirm'))) return
    try {
      const text = await file.text()
      await api.settings.importData(JSON.parse(text) as unknown)
      setStatus(t('settings.import_success'))
    } catch (e) {
      setStatus((e as Error).message)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleClear = async () => {
    if (!confirm(t('settings.clear_confirm'))) return
    try {
      await api.settings.clearData()
      setStatus(t('settings.clear_success'))
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader title={t('settings.title')} />

      {/* Language */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.language')}</h2>
        <div className={styles.optionGroup}>
          {(['zh', 'en'] as Language[]).map(lang => (
            <button
              key={lang}
              className={`${styles.optionBtn} ${language === lang ? styles.active : ''}`}
              onClick={() => handleLanguage(lang)}
            >
              {lang === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </Card>

      {/* Theme */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.theme')}</h2>
        <div className={styles.optionGroup}>
          {(['system', 'light', 'dark'] as ThemePreference[]).map(th => (
            <button
              key={th}
              className={`${styles.optionBtn} ${theme === th ? styles.active : ''}`}
              onClick={() => handleTheme(th)}
            >
              {th === 'system' ? `🖥 ${t('settings.theme_system')}` : th === 'light' ? `☀️ ${t('settings.theme_light')}` : `🌙 ${t('settings.theme_dark')}`}
            </button>
          ))}
        </div>
      </Card>

      {/* Features */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.features')}</h2>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={showCompatibilityWarnings}
            onChange={e => {
              const checked = e.target.checked
              setShowCompatibilityWarnings(checked)
              void persistSettings({ showCompatibilityWarnings: checked })
            }}
          />
          <span>{t('settings.show_compat_warnings')}</span>
        </label>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={enableAutoRefresh}
            onChange={e => {
              const checked = e.target.checked
              setEnableAutoRefresh(checked)
              void persistSettings({ enableAutoRefresh: checked })
            }}
          />
          <span>{t('settings.auto_refresh')}</span>
        </label>
        <Input
          label={t('settings.auto_refresh_interval')}
          type="number"
          min="5"
          value={autoRefreshInterval}
          onChange={e => {
            const value = Math.max(5, Number(e.target.value) || 60)
            setAutoRefreshInterval(value)
          }}
          onBlur={e => {
            const value = Math.max(5, Number(e.target.value) || 60)
            void persistSettings({ autoRefreshInterval: value })
          }}
          disabled={!enableAutoRefresh}
        />
      </Card>

      {/* Data */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.data')}</h2>
        <div className={styles.actionGroup}>
          <Button variant="secondary" onClick={() => void handleExport()}>
            {t('settings.export_data')}
          </Button>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            {t('settings.import_data')}
          </Button>
          <Button variant="danger" onClick={() => void handleClear()}>
            {t('settings.clear_data')}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          className={styles.fileInput}
          type="file"
          accept="application/json,.json"
          onChange={e => void handleImport(e.target.files?.[0])}
        />
        {status && <div className={styles.status}>{status}</div>}
        {saving && <div className={styles.status}>Saving...</div>}
      </Card>

      {/* About */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.about')}</h2>
        <div className={styles.aboutGrid}>
          <div className={styles.aboutItem}>
            <span className={styles.aboutLabel}>{t('settings.version')}</span>
            <span className={styles.aboutValue}>0.1.0</span>
          </div>
          <div className={styles.aboutItem}>
            <span className={styles.aboutLabel}>Slogan</span>
            <span className={styles.aboutValue}>Manage once, export everywhere.</span>
          </div>
        </div>
      </Card>
    </div>
  )
}
