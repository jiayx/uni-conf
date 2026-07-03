import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Input } from '@/components/ui/Input/Input'
import { buildAutoNodeGroupTypeSettingsPatch } from '@/core/collections/auto-node-settings'
import { api } from '@/lib/api'
import { useSettingsStore } from '@/store/settings.store'
import { DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES, DNS_MODE_PRESETS } from '@uni-conf/shared'
import type { AppSettingsPatch, AutoNodeGroupType, DnsMode, ExportNodeNamingMode, Language, ThemePreference } from '@uni-conf/types'
import styles from './Settings.module.css'

const EXPORT_NODE_NAMING_PRESETS: Array<{ id: ExportNodeNamingMode; name: string; description: string }> = [
  { id: 'smart', name: '智能命名', description: '国家/地区 + 来源 + 序号，适合多订阅混合导出' },
  { id: 'original', name: '保留原名', description: '导出时保留订阅或节点组处理后的名称' },
  { id: 'region_sequence', name: '地区 + 序号', description: '例如 HK - 01' },
  { id: 'source_region_sequence', name: '来源 + 地区 + 序号', description: '例如 Airport A - HK - 01' },
]
const AUTO_NODE_GROUP_TYPE_PRESETS: Array<{ id: AutoNodeGroupType; name: string; description: string }> = [
  { id: 'url-test', name: '自动测速', description: '按国家/地区和标签节点池生成延迟优先的出口节点组' },
  { id: 'select', name: '手动选择', description: '按国家/地区和标签节点池生成可手动切换的出口节点组' },
  { id: 'fallback', name: '故障转移', description: '按国家/地区和标签节点池生成失败后自动切换的出口节点组' },
]

export function Settings() {
  const { t, i18n } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const {
    language,
    theme,
    dnsMode,
    exportNodeNamingMode,
    showCompatibilityWarnings,
    enableAutoRefresh,
    autoRefreshInterval,
    autoNodeGroupsEnabled,
    autoNodeGroupTypes,
    autoNodeGroupIncludeFlag,
    setLanguage,
    setTheme,
    setDnsMode,
    setExportNodeNamingMode,
    setShowCompatibilityWarnings,
    setEnableAutoRefresh,
    setAutoRefreshInterval,
    setAutoNodeGroupsEnabled,
    setAutoNodeGroupTypes,
    setAutoNodeGroupIncludeFlag,
    applySettings,
  } = useSettingsStore()

  const persistSettings = useCallback(async (patch: AppSettingsPatch) => {
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

  const handleDnsMode = (nextDnsMode: DnsMode) => {
    setDnsMode(nextDnsMode)
    void persistSettings({ dnsMode: nextDnsMode })
  }

  const handleExportNodeNamingMode = (nextMode: ExportNodeNamingMode) => {
    setExportNodeNamingMode(nextMode)
    void persistSettings({ exportNodeNamingMode: nextMode })
  }

  const handleAutoNodeGroupsEnabled = (enabled: boolean) => {
    setAutoNodeGroupsEnabled(enabled)
    void persistSettings({ autoNodeGroupsEnabled: enabled })
  }

  const handleAutoNodeGroupType = (type: AutoNodeGroupType) => {
    const patch = buildAutoNodeGroupTypeSettingsPatch(autoNodeGroupTypes, type)
    setAutoNodeGroupTypes(patch.autoNodeGroupTypes)
    setAutoNodeGroupsEnabled(patch.autoNodeGroupsEnabled)
    void persistSettings(patch)
  }

  const handleAutoNodeGroupIncludeFlag = (includeFlag: boolean) => {
    setAutoNodeGroupIncludeFlag(includeFlag)
    void persistSettings({ autoNodeGroupIncludeFlag: includeFlag })
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
              <span className={styles.themeIcon}>
                {th === 'system' ? <MonitorIcon /> : th === 'light' ? <SunIcon /> : <MoonIcon />}
              </span>
              {th === 'system' ? t('settings.theme_system') : th === 'light' ? t('settings.theme_light') : t('settings.theme_dark')}
            </button>
          ))}
        </div>
      </Card>

      {/* DNS */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>DNS 模式</h2>
        <div className={styles.optionGroup}>
          {DNS_MODE_PRESETS.map(preset => (
            <button
              key={preset.id}
              className={`${styles.optionBtn} ${dnsMode === preset.id ? styles.active : ''}`}
              onClick={() => handleDnsMode(preset.id)}
              disabled={saving}
              title={preset.description}
            >
              {preset.name}
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
              className={`${styles.optionBtn} ${exportNodeNamingMode === preset.id ? styles.active : ''}`}
              onClick={() => handleExportNodeNamingMode(preset.id)}
              disabled={saving}
              title={preset.description}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </Card>

      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>自动节点组</h2>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={autoNodeGroupsEnabled}
            onChange={e => handleAutoNodeGroupsEnabled(e.target.checked)}
            disabled={saving}
          />
          <span>节点变化后自动按国家/地区和标签节点池同步节点组</span>
        </label>
        <div className={styles.optionGroup}>
          {AUTO_NODE_GROUP_TYPE_PRESETS.map(preset => (
            <button
              key={preset.id}
              className={`${styles.optionBtn} ${autoNodeGroupTypes.includes(preset.id) ? styles.active : ''}`}
              onClick={() => handleAutoNodeGroupType(preset.id)}
              disabled={saving || !autoNodeGroupsEnabled}
              title={preset.description}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={autoNodeGroupIncludeFlag}
            onChange={e => handleAutoNodeGroupIncludeFlag(e.target.checked)}
            disabled={saving || !autoNodeGroupsEnabled}
          />
          <span>自动生成的国家/地区节点组名称包含旗帜 Emoji</span>
        </label>
        <div className={styles.hint}>具体国家/地区、标签节点池和订阅源节点组仍在“节点组”的自动生成面板里选择。</div>
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
            const value = Math.max(5, Number(e.target.value) || DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES)
            setAutoRefreshInterval(value)
          }}
          onBlur={e => {
            const value = Math.max(5, Number(e.target.value) || DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES)
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
