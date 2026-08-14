import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Input } from '@/components/ui/Input/Input'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { buildAutoNodeGroupTypeSettingsPatch } from '@/core/collections/auto-node-settings'
import { api } from '@/lib/api'
import { clearStoredApiKey } from '@/lib/auth'
import { useSettingsStore } from '@/store/settings.store'
import { DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES, MAX_BACKUP_FILE_BYTES, normalizeDnsRealIpDomainList } from '@uni-conf/shared'
import type { AppSettingsPatch, AutoNodeGroupType, ExportNodeNamingMode, Language, RuleSetConversionPolicy, ThemePreference } from '@uni-conf/types'
import styles from './Settings.module.css'

const EXPORT_NODE_NAMING_PRESETS: Array<{ id: ExportNodeNamingMode; nameKey: string; descriptionKey: string }> = [
  { id: 'smart', nameKey: 'settings.naming_smart', descriptionKey: 'settings.naming_smart_desc' },
  { id: 'original', nameKey: 'settings.naming_original', descriptionKey: 'settings.naming_original_desc' },
  { id: 'region_sequence', nameKey: 'settings.naming_region_sequence', descriptionKey: 'settings.naming_region_sequence_desc' },
  { id: 'source_region_sequence', nameKey: 'settings.naming_source_region_sequence', descriptionKey: 'settings.naming_source_region_sequence_desc' },
]
const AUTO_NODE_GROUP_TYPE_PRESETS: Array<{ id: AutoNodeGroupType; nameKey: string; descriptionKey: string }> = [
  { id: 'url-test', nameKey: 'settings.auto_node_type_url_test', descriptionKey: 'settings.auto_node_type_url_test_desc' },
  { id: 'select', nameKey: 'settings.auto_node_type_select', descriptionKey: 'settings.auto_node_type_select_desc' },
  { id: 'fallback', nameKey: 'settings.auto_node_type_fallback', descriptionKey: 'settings.auto_node_type_fallback_desc' },
]

export function Settings() {
  const { t, i18n } = useTranslation()
  const confirmAction = useConfirmDialog()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const settingsReadyRef = useRef(false)
  const settingsMutationRef = useRef(false)
  const pendingSettingsMutationRef = useRef<{
    patch: AppSettingsPatch
    onFailure?: () => void
  } | null>(null)
  const dataActionRef = useRef<'export' | 'import' | 'clear' | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dataAction, setDataAction] = useState<'export' | 'import' | 'clear' | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<unknown | null>(null)
  const [autoRefreshIntervalDraft, setAutoRefreshIntervalDraft] = useState(DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES)
  const [dnsRealIpDomainsDraft, setDnsRealIpDomainsDraft] = useState('')
  const [dnsRealIpDomainsError, setDnsRealIpDomainsError] = useState<string | null>(null)
  const {
    language,
    theme,
    exportNodeNamingMode,
    dnsRealIpDomains,
    showCompatibilityWarnings,
    ruleSetConversionPolicy,
    enableAutoRefresh,
    autoRefreshInterval,
    autoNodeGroupsEnabled,
    autoNodeGroupTypes,
    autoNodeGroupIncludeFlag,
    applySettings,
  } = useSettingsStore()

  const persistSettings = useCallback(async (patch: AppSettingsPatch, onFailure?: () => void) => {
    if (!settingsReadyRef.current || dataActionRef.current != null) return
    if (settingsMutationRef.current) {
      const pending = pendingSettingsMutationRef.current
      pendingSettingsMutationRef.current = {
        patch: { ...pending?.patch, ...patch },
        onFailure: onFailure ?? pending?.onFailure,
      }
      return
    }
    settingsMutationRef.current = true
    setSaving(true)
    setActionError(null)
    setSuccessMessage(null)
    try {
      const updated = await api.settings.update(patch)
      applySettings(updated)
      setAutoRefreshIntervalDraft(updated.autoRefreshInterval)
      setDnsRealIpDomainsDraft(updated.dnsRealIpDomains.join(', '))
      if (patch.language) await i18n.changeLanguage(updated.language)
    } catch (error) {
      onFailure?.()
      setActionError(error)
    } finally {
      settingsMutationRef.current = false
      setSaving(false)
      const pending = pendingSettingsMutationRef.current
      pendingSettingsMutationRef.current = null
      if (pending) {
        queueMicrotask(() => {
          void persistSettings(pending.patch, pending.onFailure)
        })
      }
    }
  }, [applySettings, i18n])

  useEffect(() => {
    queueMicrotask(() => {
      void api.settings.get()
        .then(settings => {
          applySettings(settings)
          setAutoRefreshIntervalDraft(settings.autoRefreshInterval)
          setDnsRealIpDomainsDraft(settings.dnsRealIpDomains.join(', '))
          void i18n.changeLanguage(settings.language)
        })
        .catch(error => setActionError(error))
        .finally(() => {
          settingsReadyRef.current = true
          setSettingsLoading(false)
        })
    })
  }, [applySettings, i18n])

  const handleLanguage = (lang: Language) => {
    void persistSettings({ language: lang })
  }

  const handleTheme = (nextTheme: ThemePreference) => {
    void persistSettings({ theme: nextTheme })
  }

  const handleExportNodeNamingMode = (nextMode: ExportNodeNamingMode) => {
    void persistSettings({ exportNodeNamingMode: nextMode })
  }

  const handleAutoNodeGroupsEnabled = (enabled: boolean) => {
    void persistSettings({ autoNodeGroupsEnabled: enabled })
  }

  const handleAutoNodeGroupType = (type: AutoNodeGroupType) => {
    const patch = buildAutoNodeGroupTypeSettingsPatch(autoNodeGroupTypes, type)
    void persistSettings(patch)
  }

  const handleAutoNodeGroupIncludeFlag = (includeFlag: boolean) => {
    void persistSettings({ autoNodeGroupIncludeFlag: includeFlag })
  }

  const synchronizeSettings = useCallback(async () => {
    try {
      const updated = await api.settings.get()
      applySettings(updated)
      setAutoRefreshIntervalDraft(updated.autoRefreshInterval)
      setDnsRealIpDomainsDraft(updated.dnsRealIpDomains.join(', '))
      await i18n.changeLanguage(updated.language)
    } catch (error) {
      setActionError(error)
    }
  }, [applySettings, i18n])

  const handleExport = async () => {
    if (!settingsReadyRef.current || dataActionRef.current != null || settingsMutationRef.current) return
    dataActionRef.current = 'export'
    if (!(await confirmAction({ description: t('settings.export_sensitive_confirm') }))) {
      dataActionRef.current = null
      return
    }
    setDataAction('export')
    setActionError(null)
    setSuccessMessage(null)
    try {
      const blob = await api.settings.exportData()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `uni-conf-backup-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setSuccessMessage(t('settings.export_success'))
    } catch (error) {
      setActionError(error)
    } finally {
      dataActionRef.current = null
      setDataAction(null)
    }
  }

  const handleImport = async (file: File | undefined) => {
    if (!file || !settingsReadyRef.current || dataActionRef.current != null || settingsMutationRef.current) return
    dataActionRef.current = 'import'
    setDataAction('import')
    setActionError(null)
    setSuccessMessage(null)
    try {
      if (file.size > MAX_BACKUP_FILE_BYTES) {
        setActionError(t('settings.import_too_large', { size: MAX_BACKUP_FILE_BYTES / 1024 / 1024 }))
        return
      }
      const text = await file.text()
      if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_FILE_BYTES) {
        setActionError(t('settings.import_too_large', { size: MAX_BACKUP_FILE_BYTES / 1024 / 1024 }))
        return
      }
      const data = JSON.parse(text) as unknown
      const validation = await api.settings.validateImportData(data)
      if (!(await confirmAction({
        description: t('settings.import_confirm', { count: validation.totalRows, version: validation.version }),
        danger: true,
      }))) return
      await api.settings.importData(data)
      setSuccessMessage(t('settings.import_success'))
      await synchronizeSettings()
    } catch (error) {
      setActionError(error)
    } finally {
      dataActionRef.current = null
      setDataAction(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleClear = async () => {
    if (!settingsReadyRef.current || dataActionRef.current != null || settingsMutationRef.current) return
    dataActionRef.current = 'clear'
    if (!(await confirmAction({
      description: t('settings.clear_confirm'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) {
      dataActionRef.current = null
      return
    }
    setDataAction('clear')
    setActionError(null)
    setSuccessMessage(null)
    try {
      await api.settings.clearData()
      setSuccessMessage(t('settings.clear_success'))
      await synchronizeSettings()
    } catch (error) {
      setActionError(error)
    } finally {
      dataActionRef.current = null
      setDataAction(null)
    }
  }

  const handleForgetAccessKey = async () => {
    if (!(await confirmAction({
      description: t('settings.access_key_clear_confirm'),
      danger: true,
    }))) return
    clearStoredApiKey()
    window.location.reload()
  }

  const settingsControlsLocked = settingsLoading || dataAction != null
  const actionLocked = settingsLoading || saving || dataAction != null

  return (
    <div className={styles.page}>
      <PageHeader title={t('settings.title')} />
      {actionError != null && <ErrorNotice error={actionError} />}
      {settingsLoading && <div className={styles.status} role="status">{t('common.loading')}</div>}
      {saving && <div className={styles.status} role="status">{t('settings.saving')}</div>}

      {/* Language */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.language')}</h2>
        <div className={styles.optionGroup}>
          {(['zh', 'en'] as Language[]).map(lang => (
            <button
              key={lang}
              type="button"
              className={`${styles.optionBtn} ${language === lang ? styles.active : ''}`}
              aria-pressed={language === lang}
              disabled={settingsControlsLocked}
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
              type="button"
              className={`${styles.optionBtn} ${theme === th ? styles.active : ''}`}
              aria-pressed={theme === th}
              disabled={settingsControlsLocked}
              onClick={() => handleTheme(th)}
            >
              <span className={styles.themeIcon}>
                {th === 'system' ? <MonitorIcon /> : th === 'light' ? <SunIcon /> : <MoonIcon />}
              </span>
              {th === 'system' ? t('settings.theme_system') : th === 'light' ? t('settings.theme_light') : t('settings.theme_dark')}
            </button>
          ))}
        </div>
      </Card>

      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.export_node_naming')}</h2>
        <div className={styles.optionGroup}>
          {EXPORT_NODE_NAMING_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className={`${styles.optionBtn} ${exportNodeNamingMode === preset.id ? styles.active : ''}`}
              onClick={() => handleExportNodeNamingMode(preset.id)}
              disabled={settingsControlsLocked}
              aria-pressed={exportNodeNamingMode === preset.id}
              title={t(preset.descriptionKey)}
            >
              {t(preset.nameKey)}
            </button>
          ))}
        </div>
      </Card>

      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.dns')}</h2>
        <div className={styles.hint}>{t('settings.dns_hint')}</div>
        <Input
          label={t('settings.dns_real_ip_domains')}
          value={dnsRealIpDomainsDraft}
          placeholder="*.example.local, api.example.com"
          error={dnsRealIpDomainsError ?? undefined}
          helperText={t('settings.dns_real_ip_domains_hint')}
          onChange={event => {
            setDnsRealIpDomainsDraft(event.target.value)
            setDnsRealIpDomainsError(null)
          }}
          onBlur={() => {
            const rawDomains = dnsRealIpDomainsDraft
              .split(',')
              .map(domain => domain.trim())
              .filter(Boolean)
            const domains = normalizeDnsRealIpDomainList(rawDomains)
            if (!domains) {
              setDnsRealIpDomainsError(t('settings.dns_real_ip_domains_invalid'))
              return
            }
            const canonicalDraft = domains.join(', ')
            setDnsRealIpDomainsDraft(canonicalDraft)
            if (canonicalDraft === dnsRealIpDomains.join(', ')) return
            void persistSettings(
              { dnsRealIpDomains: domains },
              () => {
                setDnsRealIpDomainsDraft(dnsRealIpDomains.join(', '))
                setDnsRealIpDomainsError(null)
              },
            )
          }}
          disabled={settingsControlsLocked}
        />
      </Card>

      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.auto_node_groups')}</h2>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={autoNodeGroupsEnabled}
            onChange={e => handleAutoNodeGroupsEnabled(e.target.checked)}
            disabled={settingsControlsLocked}
          />
          <span>{t('settings.auto_node_groups_enabled')}</span>
        </label>
        <div className={styles.optionGroup}>
          {AUTO_NODE_GROUP_TYPE_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className={`${styles.optionBtn} ${autoNodeGroupTypes.includes(preset.id) ? styles.active : ''}`}
              onClick={() => handleAutoNodeGroupType(preset.id)}
              disabled={settingsControlsLocked || !autoNodeGroupsEnabled}
              aria-pressed={autoNodeGroupTypes.includes(preset.id)}
              title={t(preset.descriptionKey)}
            >
              {t(preset.nameKey)}
            </button>
          ))}
        </div>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={autoNodeGroupIncludeFlag}
            onChange={e => handleAutoNodeGroupIncludeFlag(e.target.checked)}
            disabled={settingsControlsLocked || !autoNodeGroupsEnabled}
          />
          <span>{t('settings.auto_node_include_flag')}</span>
        </label>
        <div className={styles.hint}>{t('settings.auto_node_groups_hint')}</div>
      </Card>

      {/* Features */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.features')}</h2>
        <div id="rule-set-conversion" className={styles.settingBlock}>
          <div className={styles.settingLabel}>{t('settings.rule_set_conversion_policy')}</div>
          <div className={styles.optionGroup}>
            {(['compatible', 'strict'] as RuleSetConversionPolicy[]).map(policy => (
              <button
                key={policy}
                type="button"
                className={`${styles.optionBtn} ${ruleSetConversionPolicy === policy ? styles.active : ''}`}
                aria-pressed={ruleSetConversionPolicy === policy}
                disabled={settingsControlsLocked}
                onClick={() => {
                  void persistSettings({ ruleSetConversionPolicy: policy })
                }}
              >
                {t(`settings.rule_set_conversion_${policy}`)}
              </button>
            ))}
          </div>
          <div className={styles.hint}>{t(`settings.rule_set_conversion_${ruleSetConversionPolicy}_hint`)}</div>
        </div>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={showCompatibilityWarnings}
            onChange={e => {
              void persistSettings({ showCompatibilityWarnings: e.target.checked })
            }}
            disabled={settingsControlsLocked}
          />
          <span>{t('settings.show_compat_warnings')}</span>
        </label>
        <div className={styles.hint}>{t('settings.show_compat_warnings_hint')}</div>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={enableAutoRefresh}
            onChange={e => {
              void persistSettings({ enableAutoRefresh: e.target.checked })
            }}
            disabled={settingsControlsLocked}
          />
          <span>{t('settings.auto_refresh')}</span>
        </label>
        <div className={styles.hint}>{t('settings.auto_refresh_hint')}</div>
        <Input
          label={t('settings.auto_refresh_interval')}
          type="number"
          min="5"
          value={autoRefreshIntervalDraft}
          onChange={e => {
            const value = Math.max(5, Number(e.target.value) || DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES)
            setAutoRefreshIntervalDraft(value)
          }}
          onBlur={e => {
            const value = Math.max(5, Number(e.target.value) || DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES)
            void persistSettings(
              { autoRefreshInterval: value },
              () => setAutoRefreshIntervalDraft(autoRefreshInterval),
            )
          }}
          disabled={settingsControlsLocked || !enableAutoRefresh}
        />
      </Card>

      {/* Data */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.data')}</h2>
        <div className={styles.hint}>{t('settings.data_sensitive_hint')}</div>
        <div className={styles.actionGroup}>
          <Button
            variant="secondary"
            loading={dataAction === 'export'}
            disabled={settingsLoading || saving || (dataAction != null && dataAction !== 'export')}
            onClick={() => void handleExport()}
          >
            {t('settings.export_data')}
          </Button>
          <Button
            variant="secondary"
            loading={dataAction === 'import'}
            disabled={actionLocked}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('settings.import_data')}
          </Button>
          <Button
            variant="danger"
            loading={dataAction === 'clear'}
            disabled={settingsLoading || saving || (dataAction != null && dataAction !== 'clear')}
            onClick={() => void handleClear()}
          >
            {t('settings.clear_data')}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          className={styles.fileInput}
          type="file"
          accept="application/json,.json"
          disabled={actionLocked}
          onChange={e => void handleImport(e.target.files?.[0])}
        />
        {successMessage && <div className={styles.success} role="status">{successMessage}</div>}
      </Card>

      {/* Access */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.access')}</h2>
        <div className={styles.hint}>{t('settings.access_key_hint')}</div>
        <div className={styles.actionGroup}>
          <Button variant="secondary" disabled={actionLocked} onClick={() => void handleForgetAccessKey()}>
            {t('settings.access_key_clear')}
          </Button>
        </div>
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

// Icon components
function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}
