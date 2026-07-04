import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { api } from '@/lib/api'
import { saveExportDownload } from '@/core/export/download-file'
import { EXPORT_FORMAT_OPTIONS, QUICK_EXPORT_OPTIONS } from '@/core/export/formats'
import { exportConfigScopeSummary } from '@/core/export/scope-summary'
import { exportWarningSummaryText, summarizeExportWarnings } from '@/core/export/warning-summary'
import { describeCompatibleRuleSetFormats, isRemoteRuleSetCompatible } from '@/core/remote-rules/compatibility'
import { getExportSubscriptionFilename } from '@uni-conf/shared'
import type { CompatibilityWarning, ExportConfig, ExportFormat, NodeCollection, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types'
import styles from './Export.module.css'

const BASE_URL = window.location.origin
const DEFAULT_EXPORT_CONFIG_ID = 'default-mihomo'

interface ExportForm {
  name: string
  format: ExportFormat
  enabled: boolean
  includeCollectionIds: string[]
  includeGroupIds: string[]
  includeRuleIds: string[]
  includeRemoteSetIds: string[]
}

const EMPTY_FORM: ExportForm = {
  name: '',
  format: 'mihomo',
  enabled: true,
  includeCollectionIds: [],
  includeGroupIds: [],
  includeRuleIds: [],
  includeRemoteSetIds: [],
}

export function Export() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [configs, setConfigs] = useState<ExportConfig[]>([])
  const [collections, setCollections] = useState<NodeCollection[]>([])
  const [groups, setGroups] = useState<ProxyGroup[]>([])
  const [rules, setRules] = useState<ProxyRule[]>([])
  const [remoteSets, setRemoteSets] = useState<RemoteRuleSet[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ExportForm>(EMPTY_FORM)
  const [copied, setCopied] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [validationById, setValidationById] = useState<Record<string, ExportValidationState>>({})
  const [previewModal, setPreviewModal] = useState<PreviewModalState | null>(null)
  const previewRequestRef = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextConfigs, nextCollections, nextGroups, nextRules, nextRemoteSets] = await Promise.all([
        api.export.listConfigs(),
        api.collections.list(),
        api.groups.list(),
        api.rules.list(),
        api.remoteRuleSets.list(),
      ])
      setConfigs(nextConfigs)
      setCollections(nextCollections)
      setGroups(nextGroups)
      setRules(nextRules)
      setRemoteSets(nextRemoteSets)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  const openEdit = (config: ExportConfig) => {
    setEditingId(config.id)
    setForm({
      name: config.name,
      format: config.format,
      enabled: config.enabled,
      includeCollectionIds: config.includeCollectionIds,
      includeGroupIds: config.includeGroupIds,
      includeRuleIds: config.includeRuleIds,
      includeRemoteSetIds: config.includeRemoteSetIds,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    const payload = {
      name: form.name,
      format: form.format,
      enabled: form.enabled,
      includeCollectionIds: form.includeCollectionIds,
      includeGroupIds: form.includeGroupIds,
      includeRuleIds: form.includeRuleIds,
      includeRemoteSetIds: form.includeRemoteSetIds,
    }
    if (editingId) {
      await api.export.updateConfig(editingId, payload)
    } else {
      await api.export.createConfig(payload)
    }
    setShowModal(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    await load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('export.delete_confirm'))) return
    await api.export.deleteConfig(id)
    await load()
  }

  const handleDownloadFormat = async (config: ExportConfig, format: ExportFormat) => {
    const key = `${config.id}:${format}`
    setDownloadingId(key)
    setDownloadError(null)
    try {
      saveExportDownload(await api.export.downloadFormat(format, config.id))
    } catch (e) {
      setDownloadError((e as Error).message)
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDownload = async (config: ExportConfig) => {
    await handleDownloadFormat(config, config.format)
  }

  const openFullPreview = (format: ExportFormat, configId?: string) => {
    const params = new URLSearchParams({ format })
    if (configId) params.set('configId', configId)
    void navigate(`/preview?${params.toString()}`)
  }

  const handlePreviewFormat = async (key: string, title: string, format: ExportFormat, configId?: string) => {
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    setPreviewModal({ key, title, format, configId, status: 'loading' })
    try {
      const result = await api.export.previewFormat(format, configId)
      if (previewRequestRef.current !== requestId) return
      setPreviewModal({
        key,
        title,
        format,
        configId,
        status: 'ready',
        content: result.content,
        contentType: result.contentType,
        warnings: result.warnings ?? [],
      })
    } catch (e) {
      if (previewRequestRef.current !== requestId) return
      setPreviewModal({ key, title, format, configId, status: 'error', error: (e as Error).message })
    }
  }

  const handleValidate = async (config: ExportConfig) => {
    setCheckingId(config.id)
    setValidationById(current => ({
      ...current,
      [config.id]: { status: 'checking' },
    }))
    try {
      const result = await api.export.previewFormat(config.format, config.id)
      setValidationById(current => ({
        ...current,
        [config.id]: {
          status: 'ready',
          warnings: result.warnings ?? [],
          lineCount: result.content.split('\n').length,
        },
      }))
    } catch (e) {
      setValidationById(current => ({
        ...current,
        [config.id]: { status: 'error', error: (e as Error).message },
      }))
    } finally {
      setCheckingId(null)
    }
  }

  const copyUrl = (url: string, id: string) => {
    void navigator.clipboard.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleFormatChange = (format: ExportFormat) => {
    setForm(f => ({
      ...f,
      format,
      includeRemoteSetIds: f.includeRemoteSetIds.filter(id => {
        const remoteSet = remoteSets.find(item => item.id === id)
        return remoteSet ? isRemoteRuleSetCompatible(format, remoteSet) : false
      }),
    }))
  }

  const defaultConfig = configs.find(cfg => cfg.id === DEFAULT_EXPORT_CONFIG_ID)
  const advancedConfigs = configs.filter(cfg => cfg.id !== DEFAULT_EXPORT_CONFIG_ID)

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('export.title')}
        description={t('export.description')}
        actions={<Button onClick={openCreate} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>{t('export.new_config')}</Button>}
      />
      {downloadError && <div className={styles.error}>{downloadError}</div>}
      {loading ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : configs.length === 0 ? (
        <EmptyState title={t('export.empty_title')} description={t('export.empty_description')} action={{ label: t('export.new_config'), onClick: () => setShowModal(true) }} />
      ) : (
        <div className={styles.list}>
          {defaultConfig && (
            <Card className={styles.configCard}>
              <div className={styles.configHeader}>
                <div>
                  <div className={styles.configName}>{t('export.default_profile_name')}</div>
                  <div className={styles.badges}>
                    <Badge variant="purple">{t('export.all_formats')}</Badge>
                    <Badge variant={defaultConfig.enabled ? 'success' : 'default'}>{defaultConfig.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
                  </div>
                  <div className={styles.scopeText}>{exportConfigScopeSummary(defaultConfig, collections, groups, rules, remoteSets, t)}</div>
                </div>
              </div>
              <div className={styles.urlRow}>
                <span className={styles.urlLabel}>{t('export.quick_links_label')}</span>
                <div className={styles.quickFormatList}>
                  {QUICK_EXPORT_OPTIONS.map(item => {
                    const filename = getExportSubscriptionFilename(item.value)
                    const subUrl = `${BASE_URL}/sub/${defaultConfig.token}/${filename}`
                    const actionKey = `${defaultConfig.id}:${item.value}`
                    return (
                      <div key={item.value} className={styles.quickFormatRow}>
                        <strong className={styles.quickFormatName}>{t(`export.formats.${item.value}`)}</strong>
                        <code className={styles.urlCode}>{subUrl}</code>
                        <div className={styles.quickFormatActions}>
                          <Button
                            variant="ghost" size="sm"
                            loading={previewModal?.key === actionKey && previewModal.status === 'loading'}
                            onClick={() => void handlePreviewFormat(actionKey, t(`export.formats.${item.value}`), item.value)}
                          >{t('common.preview')}</Button>
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => copyUrl(subUrl, actionKey)}
                          >{copied === actionKey ? t('common.copied') : t('common.copy')}</Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={downloadingId === actionKey}
                            onClick={() => void handleDownloadFormat(defaultConfig, item.value)}
                          >
                            {t('common.download')}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </Card>
          )}
          {advancedConfigs.length > 0 && <div className={styles.sectionLabel}>{t('export.advanced_profiles')}</div>}
          {advancedConfigs.map(cfg => {
            const filename = getExportSubscriptionFilename(cfg.format)
            const subUrl = `${BASE_URL}/sub/${cfg.token}/${filename}`
            const scopeText = exportConfigScopeSummary(cfg, collections, groups, rules, remoteSets, t)
            const validation = validationById[cfg.id]
            return (
              <Card key={cfg.id} className={styles.configCard}>
                <div className={styles.configHeader}>
                  <div>
                    <div className={styles.configName}>{cfg.name}</div>
                    <div className={styles.badges}>
                      <Badge variant="purple">{cfg.format.toUpperCase()}</Badge>
                      <Badge variant={cfg.enabled ? 'success' : 'default'}>{cfg.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
                    </div>
                    <div className={styles.scopeText}>{scopeText}</div>
                  </div>
                  <div className={styles.configActions}>
                    <Button variant="secondary" size="sm" onClick={() => openEdit(cfg)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="secondary" size="sm"
                      loading={checkingId === cfg.id}
                      onClick={() => void handleValidate(cfg)}
                    >{t('export.validate')}</Button>
                    <Button
                      variant="secondary" size="sm"
                      loading={previewModal?.key === `${cfg.id}:${cfg.format}` && previewModal.status === 'loading'}
                      onClick={() => void handlePreviewFormat(`${cfg.id}:${cfg.format}`, `${cfg.name} · ${t(`export.formats.${cfg.format}`)}`, cfg.format, cfg.id)}
                    >{t('common.preview')}</Button>
                    <Button
                      variant="secondary" size="sm"
                      loading={downloadingId === `${cfg.id}:${cfg.format}`}
                      onClick={() => void handleDownload(cfg)}
                    >{t('common.download')}</Button>
                    <Button variant="danger" size="sm" onClick={() => void handleDelete(cfg.id)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
                <div className={styles.urlRow}>
                  <span className={styles.urlLabel}>{t('export.subscription_url')}</span>
                  <div className={styles.urlBox}>
                    <code className={styles.urlCode}>{subUrl}</code>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => copyUrl(subUrl, cfg.id)}
                    >{copied === cfg.id ? t('common.copied') : t('common.copy')}</Button>
                  </div>
                </div>
                {validation && <ExportValidationResult validation={validation} />}
              </Card>
            )
          })}
        </div>
      )}
      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editingId ? t('export.edit_config') : t('export.new_config')}
        footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button><Button onClick={() => void handleSave()}>{t('common.save')}</Button></>}
      >
        <div className={styles.defaultScopeHint}>
          <div className={styles.defaultScopeTitle}>{t('export.default_full_title')}</div>
          <div className={styles.defaultScopeText}>
            {t('export.default_full_text')}
          </div>
        </div>
        <Input label={t('export.name_optional')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('export.name_placeholder')} />
        <div>
          <label className={styles.selectLabel}>{t('export.format')}</label>
          <select className={styles.select} value={form.format} onChange={e => handleFormatChange(e.target.value as ExportFormat)}>
            {EXPORT_FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          <span>{t('export.enable_config')}</span>
        </label>
        <details className={styles.advanced}>
          <summary>{t('export.advanced_scope')}</summary>
          <div className={styles.advancedBody}>
            <MultiSelect
              label={t('export.scope_collections')}
              emptyText={t('export.scope_collections_all')}
              options={collections.map(item => ({ id: item.id, label: item.name }))}
              value={form.includeCollectionIds}
              onChange={includeCollectionIds => setForm(f => ({ ...f, includeCollectionIds }))}
            />
            <MultiSelect
              label={t('export.scope_groups')}
              emptyText={t('export.scope_groups_all')}
              options={groups.map(item => ({ id: item.id, label: item.name }))}
              value={form.includeGroupIds}
              onChange={includeGroupIds => setForm(f => ({ ...f, includeGroupIds }))}
            />
            <MultiSelect
              label={t('export.scope_rules')}
              emptyText={t('export.scope_rules_all')}
              options={rules.map(item => ({ id: item.id, label: `${item.type}, ${item.payload}` }))}
              value={form.includeRuleIds}
              onChange={includeRuleIds => setForm(f => ({ ...f, includeRuleIds }))}
            />
            <MultiSelect
              label={t('export.scope_remote_sets')}
              emptyText={t('export.scope_remote_sets_all')}
              hint={t('export.compatible_remote_sets_hint', {
                format: form.format,
                formats: describeCompatibleRuleSetFormats(form.format, t),
              })}
              options={remoteSets.map(item => {
                const compatible = isRemoteRuleSetCompatible(form.format, item)
                const formatLabel = item.presetSource === 'quixotic'
                  ? t('export.remote_set_dynamic_preset')
                  : item.presetSource === 'uni-conf'
                    ? t('export.remote_set_builtin_format', { format: item.format })
                    : item.format
                return {
                  id: item.id,
                  label: item.name,
                  description: compatible
                    ? t('export.remote_set_compatible_desc', { label: formatLabel, format: form.format })
                    : t('export.remote_set_incompatible_desc', { label: formatLabel, format: form.format }),
                  disabled: !compatible,
                }
              })}
              value={form.includeRemoteSetIds}
              onChange={includeRemoteSetIds => setForm(f => ({ ...f, includeRemoteSetIds }))}
            />
          </div>
        </details>
      </Modal>
      <Modal
        open={Boolean(previewModal)}
        onOpenChange={open => {
          if (!open) setPreviewModal(null)
        }}
        title={previewModal?.title ?? t('preview.title')}
        size="lg"
      >
        {previewModal && (
          <PreviewModalContent
            preview={previewModal}
            onOpenFull={() => openFullPreview(previewModal.format, previewModal.configId)}
          />
        )}
      </Modal>
    </div>
  )
}

type ExportValidationState =
  | { status: 'checking' }
  | { status: 'ready'; warnings: CompatibilityWarning[]; lineCount: number }
  | { status: 'error'; error: string }

type PreviewModalState =
  | { key: string; title: string; format: ExportFormat; configId?: string; status: 'loading' }
  | { key: string; title: string; format: ExportFormat; configId?: string; status: 'ready'; content: string; contentType: string; warnings: CompatibilityWarning[] }
  | { key: string; title: string; format: ExportFormat; configId?: string; status: 'error'; error: string }

function PreviewModalContent({
  preview,
  onOpenFull,
}: {
  preview: PreviewModalState
  onOpenFull: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (preview.status !== 'ready') return
    void navigator.clipboard.writeText(preview.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (preview.status === 'loading') {
    return <div className={styles.previewModalEmpty}>{t('preview.generating')}</div>
  }

  if (preview.status === 'error') {
    return <div className={`${styles.validation} ${styles.validationBlocked}`}>{preview.error}</div>
  }

  const summary = summarizeExportWarnings(preview.warnings)
  const visibleWarnings = preview.warnings.slice(0, 3)

  return (
    <>
      <div className={styles.previewModalHeader}>
        <div>
          <span>{preview.contentType} · {t('preview.line_count', { count: preview.content.split('\n').length })}</span>
        </div>
        <div className={styles.previewModalActions}>
          <Button variant="ghost" size="sm" onClick={handleCopy}>{copied ? t('common.copied') : t('common.copy')}</Button>
          <Button variant="secondary" size="sm" onClick={onOpenFull}>{t('preview.title')}</Button>
        </div>
      </div>
      <div className={`${styles.validation} ${summary.canUseConfig ? styles.validationReady : styles.validationBlocked}`}>
        <strong>{summary.canUseConfig ? t('export.validation_ready') : t('export.validation_blocked')}</strong>
        <span>{exportWarningSummaryText(summary, t)}</span>
      </div>
      {visibleWarnings.length > 0 && (
        <div className={styles.validationWarnings}>
          {visibleWarnings.map((warning, index) => (
            <div key={`${warning.level}-${index}`} className={styles.validationWarning}>{warning.message}</div>
          ))}
          {preview.warnings.length > visibleWarnings.length && (
            <div className={styles.validationMore}>{t('export.validation_more', { count: preview.warnings.length - visibleWarnings.length })}</div>
          )}
        </div>
      )}
      <pre className={styles.previewModalCode}>{preview.content}</pre>
    </>
  )
}

function ExportValidationResult({ validation }: { validation: ExportValidationState }) {
  const { t } = useTranslation()

  if (validation.status === 'checking') {
    return <div className={styles.validation}>{t('export.validation_checking')}</div>
  }

  if (validation.status === 'error') {
    return (
      <div className={`${styles.validation} ${styles.validationBlocked}`}>
        <strong>{t('export.validation_blocked')}</strong>
        <span>{validation.error}</span>
      </div>
    )
  }

  const summary = summarizeExportWarnings(validation.warnings)
  const visibleWarnings = validation.warnings.slice(0, 3)

  return (
    <div className={`${styles.validation} ${summary.canUseConfig ? styles.validationReady : styles.validationBlocked}`}>
      <strong>{summary.canUseConfig ? t('export.validation_ready') : t('export.validation_blocked')}</strong>
      <span>{t('export.validation_summary_with_lines', {
        summary: exportWarningSummaryText(summary, t),
        lineCount: validation.lineCount,
      })}</span>
      {visibleWarnings.length > 0 && (
        <div className={styles.validationWarnings}>
          {visibleWarnings.map((warning, index) => (
            <div key={`${warning.level}-${index}`} className={styles.validationWarning}>
              {warning.message}
            </div>
          ))}
          {validation.warnings.length > visibleWarnings.length && (
            <div className={styles.validationMore}>
              {t('export.validation_more', { count: validation.warnings.length - visibleWarnings.length })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface MultiSelectOption {
  id: string
  label: string
  description?: string
  disabled?: boolean
}

interface MultiSelectProps {
  label: string
  emptyText: string
  hint?: string
  options: MultiSelectOption[]
  value: string[]
  onChange: (value: string[]) => void
}

function MultiSelect({ label, emptyText, hint, options, value, onChange }: MultiSelectProps) {
  const { t } = useTranslation()
  const selected = new Set(value)
  const toggle = (option: MultiSelectOption) => {
    if (option.disabled) return
    const id = option.id
    onChange(selected.has(id) ? value.filter(item => item !== id) : [...value, id])
  }

  return (
    <div className={styles.selector}>
      <div className={styles.selectorHeader}>
        <span className={styles.selectLabel}>{label}</span>
        {value.length > 0 && (
          <button className={styles.clearButton} type="button" onClick={() => onChange([])}>
            {t('export.scope_reset_all')}
          </button>
        )}
      </div>
      {hint && <div className={styles.selectorHint}>{hint}</div>}
      {options.length === 0 ? (
        <div className={styles.selectorEmpty}>{t('common.empty')}</div>
      ) : (
        <div className={styles.optionList}>
          <label className={styles.optionItem}>
            <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
            <span>{emptyText}</span>
          </label>
          {options.map(option => (
            <label key={option.id} className={`${styles.optionItem} ${option.disabled ? styles.optionDisabled : ''}`}>
              <input
                type="checkbox"
                checked={selected.has(option.id)}
                disabled={option.disabled}
                onChange={() => toggle(option)}
              />
              <span className={styles.optionContent}>
                <span className={styles.optionLabel}>{option.label}</span>
                {option.description && <span className={styles.optionDescription}>{option.description}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
