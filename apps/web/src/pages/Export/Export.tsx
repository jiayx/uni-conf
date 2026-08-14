import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal, ModalClose } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { CompatibilityWarningNotice } from '@/components/export/CompatibilityWarningNotice/CompatibilityWarningNotice'
import { TransformationReport } from '@/components/export/TransformationReport/TransformationReport'
import { api } from '@/lib/api'
import { saveExportDownload } from '@/core/export/download-file'
import { maskSubscriptionTokenUrl } from '@/core/sources/source-url-privacy'
import {
  EXPORT_FORMAT_NAMES,
  EXPORT_FORMAT_OPTIONS,
  QUICK_EXPORT_OPTIONS,
} from '@/core/export/formats'
import { exportConfigScopeSummary } from '@/core/export/scope-summary'
import { exportWarningSummaryText, summarizeExportWarnings } from '@/core/export/warning-summary'
import { countContentLines } from '@/core/export/content-preview'
import { highlightExportContent } from '@/core/export/config-syntax'
import {
  buildPublicSubscriptionUrl,
  buildSubscriptionDisplayName,
} from '@/core/export/quick-subscriptions'
import { buildClientImportLink } from '@/core/export/client-import-schemes'
import { writeClipboardText } from '@/core/clipboard/write-text'
import { useRequestedEdit } from '@/core/navigation/use-requested-edit'
import { formValuesEqual, useUnsavedChangesGuard } from '@/core/forms/use-unsaved-changes'
import { describeCompatibleRuleSetFormats, getRemoteRuleSetCompatibilityMode, isRemoteRuleSetCompatible } from '@/core/remote-rules/compatibility'
import {
  getExportClientCapabilities,
  getExportSubscriptionFilename,
  isWorkspaceEntityId,
} from '@uni-conf/shared'
import type { CompatibilityWarning, ExportArtifactValidationResult, ExportConfig, ExportDownloadReadiness, ExportFormat, NodeCollection, ProxyGroup, ProxyRule, RemoteRuleSet, RuleSetConversionPolicy } from '@uni-conf/types'
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
  ruleSetConversionPolicy: 'inherit' | RuleSetConversionPolicy
}

const EMPTY_FORM: ExportForm = {
  name: '',
  format: 'mihomo',
  enabled: true,
  includeCollectionIds: [],
  includeGroupIds: [],
  includeRuleIds: [],
  includeRemoteSetIds: [],
  ruleSetConversionPolicy: 'inherit',
}

export function Export() {
  const { t } = useTranslation()
  const confirmAction = useConfirmDialog()
  const [configs, setConfigs] = useState<ExportConfig[]>([])
  const [globalRuleSetConversionPolicy, setGlobalRuleSetConversionPolicy] =
    useState<RuleSetConversionPolicy | null>(null)
  const [collections, setCollections] = useState<NodeCollection[]>([])
  const [groups, setGroups] = useState<ProxyGroup[]>([])
  const [rules, setRules] = useState<ProxyRule[]>([])
  const [remoteSets, setRemoteSets] = useState<RemoteRuleSet[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ExportForm>(EMPTY_FORM)
  const [initialForm, setInitialForm] = useState<ExportForm>(EMPTY_FORM)
  const [copied, setCopied] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<unknown | null>(null)
  const [formError, setFormError] = useState<unknown | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [resettingId, setResettingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [previewModal, setPreviewModal] = useState<PreviewModalState | null>(null)
  const [subscriptionQr, setSubscriptionQr] = useState<{ title: string; url: string } | null>(null)
  const [revealedUrlScopes, setRevealedUrlScopes] = useState<Set<string>>(() => new Set())
  const selectedFormatCapabilities = getExportClientCapabilities(form.format)
  const formDirty = showModal && !formValuesEqual(form, initialForm)
  useUnsavedChangesGuard(formDirty)
  const previewRequestRef = useRef(0)

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const [nextConfigs, nextCollections, nextGroups, nextRules, nextRemoteSets, nextSettings] = await Promise.all([
        api.export.listConfigs(),
        api.collections.list(),
        api.groups.list(),
        api.rules.list(),
        api.remoteRuleSets.list(),
        api.settings.get().catch(() => null),
      ])
      setConfigs(nextConfigs)
      setCollections(nextCollections)
      setGroups(nextGroups)
      setRules(nextRules)
      setRemoteSets(nextRemoteSets)
      if (nextSettings) setGlobalRuleSetConversionPolicy(nextSettings.ruleSetConversionPolicy)
      setRevealedUrlScopes(new Set())
    } catch (error) {
      setDownloadError(error)
    } finally {
      if (showLoading) setLoading(false)
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
    setInitialForm(EMPTY_FORM)
    setFormError(null)
    setShowModal(true)
  }

  const openDuplicate = (config: ExportConfig) => {
    const nextForm: ExportForm = {
      name: t('export.copy_name', { name: config.name }),
      format: config.format,
      enabled: config.enabled,
      includeCollectionIds: [...config.includeCollectionIds],
      includeGroupIds: [...config.includeGroupIds],
      includeRuleIds: [...config.includeRuleIds],
      includeRemoteSetIds: [...config.includeRemoteSetIds],
      ruleSetConversionPolicy: config.ruleSetConversionPolicy ?? 'inherit',
    }
    setEditingId(null)
    setForm(nextForm)
    setInitialForm(nextForm)
    setFormError(null)
    setShowModal(true)
  }

  const openEdit = (config: ExportConfig) => {
    const nextForm: ExportForm = {
      name: config.name,
      format: config.format,
      enabled: config.enabled,
      includeCollectionIds: config.includeCollectionIds,
      includeGroupIds: config.includeGroupIds,
      includeRuleIds: config.includeRuleIds,
      includeRemoteSetIds: config.includeRemoteSetIds,
      ruleSetConversionPolicy: config.ruleSetConversionPolicy ?? 'inherit',
    }
    setEditingId(config.id)
    setForm(nextForm)
    setInitialForm(nextForm)
    setFormError(null)
    setShowModal(true)
  }

  useRequestedEdit(configs.filter(config => !isDefaultExportConfig(config)), openEdit)

  const closeFormModal = () => {
    setShowModal(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setInitialForm(EMPTY_FORM)
    setFormError(null)
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
      ruleSetConversionPolicy:
        form.ruleSetConversionPolicy === 'inherit' ? null : form.ruleSetConversionPolicy,
    }
    setFormSaving(true)
    setFormError(null)
    try {
      let savedConfig: ExportConfig
      if (editingId) {
        savedConfig = await api.export.updateConfig(editingId, payload)
        setConfigs(current => current.map(config => config.id === savedConfig.id ? savedConfig : config))
      } else {
        savedConfig = await api.export.createConfig(payload)
        setConfigs(current => [...current, savedConfig])
      }
      setShowModal(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    } catch (error) {
      setFormError(error)
    } finally {
      setFormSaving(false)
    }
  }

  const handleDelete = async (config: ExportConfig) => {
    if (!(await confirmAction({
      description: t('export.delete_confirm_named', { name: config.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    setDeletingId(config.id)
    setDownloadError(null)
    setActionNotice(null)
    try {
      await api.export.deleteConfig(config.id)
      setConfigs(current => current.filter(item => item.id !== config.id))
      setRevealedUrlScopes(current => {
        const next = new Set(current)
        next.delete(config.id)
        return next
      })
    } catch (error) {
      setDownloadError(error)
    } finally {
      setDeletingId(null)
    }
  }

  const toggleUrlVisibility = (scope: string) => {
    const revealed = revealedUrlScopes.has(scope)
    setRevealedUrlScopes(current => {
      const next = new Set(current)
      if (revealed) next.delete(scope)
      else next.add(scope)
      return next
    })
  }

  const handleResetToken = async (config: ExportConfig) => {
    const profileName = isDefaultExportConfig(config)
      ? t('export.default_profile_name')
      : config.name
    if (!(await confirmAction({
      title: t('export.reset_token_title'),
      description: t('export.reset_token_confirm_named', { name: profileName }),
      confirmLabel: t('export.reset_token'),
      danger: true,
    }))) return
    setResettingId(config.id)
    setDownloadError(null)
    setActionNotice(null)
    try {
      const updated = await api.export.resetToken(config.id)
      setConfigs(current => current.map(item => item.id === updated.id ? updated : item))
      setRevealedUrlScopes(current => {
        const next = new Set(current)
        next.delete(config.id)
        return next
      })
      setActionNotice(t('export.token_reset_success'))
    } catch (e) {
      setDownloadError(e)
    } finally {
      setResettingId(null)
    }
  }

  const handleToggleEnabled = async (config: ExportConfig) => {
    const nextEnabled = !config.enabled
    const profileName = isDefaultExportConfig(config)
      ? t('export.default_profile_name')
      : config.name
    if (!nextEnabled && !(await confirmAction({
      title: t('export.pause_subscription_title'),
      description: t('export.pause_confirm_named', { name: profileName }),
      confirmLabel: t('export.pause_subscription'),
      danger: true,
    }))) return
    setTogglingId(config.id)
    setDownloadError(null)
    setActionNotice(null)
    try {
      const updated = await api.export.updateConfig(config.id, { enabled: nextEnabled })
      setConfigs(current => current.map(item => item.id === updated.id ? updated : item))
      setActionNotice(t(nextEnabled ? 'export.link_resumed_success' : 'export.link_paused_success'))
    } catch (e) {
      setDownloadError(e)
    } finally {
      setTogglingId(null)
    }
  }

  const handleDownloadFormat = async (config: ExportConfig, format: ExportFormat) => {
    const key = `${config.id}:${format}`
    setDownloadingId(key)
    setDownloadError(null)
    try {
      saveExportDownload(await api.export.downloadFormat(format, config.id))
    } catch (e) {
      setDownloadError(e)
    } finally {
      setDownloadingId(null)
    }
  }

  const handleDownload = async (config: ExportConfig) => {
    await handleDownloadFormat(config, config.format)
  }

  const handlePreviewFormat = async (key: string, title: string, format: ExportFormat, configId?: string) => {
    const requestId = previewRequestRef.current + 1
    previewRequestRef.current = requestId
    const previous = previewModal?.key === key && previewModal.status === 'ready'
      ? previewModal
      : null
    setPreviewModal(previous
      ? { ...previous, refreshing: true, refreshError: undefined }
      : { key, title, format, configId, status: 'loading' })
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
        artifactValidation: result.artifactValidation,
        readiness: result.readiness,
        refreshing: false,
      })
    } catch (e) {
      if (previewRequestRef.current !== requestId) return
      const error = (e as Error).message
      setPreviewModal(previous
        ? { ...previous, refreshing: false, refreshError: error }
        : { key, title, format, configId, status: 'error', error })
    }
  }

  const copyUrl = async (url: string, id: string) => {
    setDownloadError(null)
    try {
      await writeClipboardText(url)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setDownloadError(new Error(t('common.clipboard_copy_failed')))
    }
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

  const defaultConfig = configs.find(isDefaultExportConfig)
  const advancedConfigs = configs.filter(config => !isDefaultExportConfig(config))
  const inheritedConversionPolicyLabel = globalRuleSetConversionPolicy
    ? t('export.conversion_policy_badge_inherit_effective', {
        policy: t(`settings.rule_set_conversion_${globalRuleSetConversionPolicy}`),
      })
    : t('export.conversion_policy_badge_inherit')
  const conversionPolicyLabel = (policy: ExportConfig['ruleSetConversionPolicy']) =>
    policy ? t(`export.conversion_policy_badge_${policy}`) : inheritedConversionPolicyLabel
  const conversionPolicyBadgeVariant = (
    policy: ExportConfig['ruleSetConversionPolicy'],
  ): 'warning' | 'info' | 'default' =>
    policy === 'strict' ? 'warning' : policy === 'compatible' ? 'info' : 'default'

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('export.title')}
        description={t('export.description')}
        actions={<Button onClick={openCreate} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>{t('export.new_config')}</Button>}
      />
      {actionNotice && <div className={styles.success} role="status">{actionNotice}</div>}
      {downloadError != null && <ErrorNotice error={downloadError} className={styles.error} />}
      {loading ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : configs.length === 0 ? (
        <EmptyState title={t('export.empty_title')} description={t('export.empty_description')} action={{ label: t('export.new_config'), onClick: openCreate }} />
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
                    <Badge variant={conversionPolicyBadgeVariant(defaultConfig.ruleSetConversionPolicy)}>
                      {conversionPolicyLabel(defaultConfig.ruleSetConversionPolicy)}
                    </Badge>
                  </div>
                </div>
                <div className={styles.configActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={togglingId === defaultConfig.id}
                    onClick={() => void handleToggleEnabled(defaultConfig)}
                  >{t(defaultConfig.enabled ? 'export.pause_subscription' : 'export.resume_subscription')}</Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={resettingId === defaultConfig.id}
                    onClick={() => void handleResetToken(defaultConfig)}
                  >{t('export.reset_token')}</Button>
                </div>
              </div>
              {!defaultConfig.enabled && <div className={styles.disabledNotice}>{t('export.link_paused_hint')}</div>}
              <div className={styles.urlRow}>
                <div className={styles.urlLabelRow}>
                  <span className={styles.urlLabel}>{t('export.quick_links_label')}</span>
                  <Button variant="ghost" size="sm" onClick={() => toggleUrlVisibility(defaultConfig.id)}>
                    {t(revealedUrlScopes.has(defaultConfig.id) ? 'export.hide_urls' : 'export.reveal_urls')}
                  </Button>
                </div>
                <div className={styles.quickFormatList}>
                  {QUICK_EXPORT_OPTIONS.map(item => {
                    const filename = getExportSubscriptionFilename(item.value)
                    const subUrl = buildPublicSubscriptionUrl(
                      BASE_URL,
                      defaultConfig.token,
                      filename,
                      buildSubscriptionDisplayName(
                        defaultConfig.name,
                        EXPORT_FORMAT_NAMES[item.value],
                      ),
                    )
                    const actionKey = `${defaultConfig.id}:${item.value}`
                    const importLink = buildClientImportLink(
                      item.value,
                      subUrl,
                      buildSubscriptionDisplayName(defaultConfig.name, EXPORT_FORMAT_NAMES[item.value]),
                    )
                    return (
                      <div key={item.value} className={styles.quickFormatRow}>
                        <button
                          type="button"
                          className={styles.quickFormatPreview}
                          disabled={!defaultConfig.enabled}
                          aria-label={t('export.preview_format', {
                            name: t(`export.formats.${item.value}`),
                          })}
                          onClick={() => void handlePreviewFormat(
                            actionKey,
                            t(`export.formats.${item.value}`),
                            item.value,
                          )}
                        >
                          <strong className={styles.quickFormatName}>{t(`export.formats.${item.value}`)}</strong>
                          <code className={styles.urlCode}>{revealedUrlScopes.has(defaultConfig.id) ? subUrl : maskSubscriptionTokenUrl(subUrl)}</code>
                        </button>
                        <div className={styles.quickFormatActions}>
                          {importLink && (defaultConfig.enabled ? (
                            <a
                              className={styles.importLink}
                              href={importLink.url}
                              aria-label={t('export.import_to_app', { app: importLink.appName })}
                            >{t('export.one_click_import')}</a>
                          ) : (
                            <span className={`${styles.importLink} ${styles.importLinkDisabled}`} aria-disabled="true">
                              {t('export.one_click_import')}
                            </span>
                          ))}
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={!defaultConfig.enabled}
                            onClick={() => void copyUrl(subUrl, actionKey)}
                          >{copied === actionKey ? t('common.copied') : t('export.copy_url')}</Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!defaultConfig.enabled}
                            onClick={() => setSubscriptionQr({
                              title: t('export.qr_title', { name: t(`export.formats.${item.value}`) }),
                              url: subUrl,
                            })}
                          >{t('export.scan_to_add')}</Button>
                          <QuickExportMoreMenu
                            disabled={!defaultConfig.enabled || downloadingId === actionKey}
                            onPreview={() => void handlePreviewFormat(
                              actionKey,
                              t(`export.formats.${item.value}`),
                              item.value,
                            )}
                            onDownload={() => void handleDownloadFormat(defaultConfig, item.value)}
                          />
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
            const subUrl = buildPublicSubscriptionUrl(
              BASE_URL,
              cfg.token,
              filename,
              buildSubscriptionDisplayName(cfg.name, EXPORT_FORMAT_NAMES[cfg.format]),
            )
            const importLink = buildClientImportLink(cfg.format, subUrl, cfg.name)
            const scopeText = exportConfigScopeSummary(cfg, collections, groups, rules, remoteSets, t)
            return (
              <Card key={cfg.id} className={styles.configCard}>
                <div className={styles.configHeader}>
                  <div>
                    <div className={styles.configName}>{cfg.name}</div>
                    <div className={styles.badges}>
                      <Badge variant="purple">{cfg.format.toUpperCase()}</Badge>
                      <Badge variant={cfg.enabled ? 'success' : 'default'}>{cfg.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
                      <Badge variant={conversionPolicyBadgeVariant(cfg.ruleSetConversionPolicy)}>
                        {conversionPolicyLabel(cfg.ruleSetConversionPolicy)}
                      </Badge>
                    </div>
                    <div className={styles.scopeText}>{scopeText}</div>
                  </div>
                  <div className={styles.configActions}>
                    <Button
                      variant="secondary" size="sm"
                      disabled={deletingId === cfg.id}
                      loading={togglingId === cfg.id}
                      onClick={() => void handleToggleEnabled(cfg)}
                    >{t(cfg.enabled ? 'export.pause_subscription' : 'export.resume_subscription')}</Button>
                    <Button variant="secondary" size="sm" disabled={deletingId === cfg.id} onClick={() => openEdit(cfg)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={deletingId === cfg.id} onClick={() => openDuplicate(cfg)}>
                      {t('export.duplicate_config')}
                    </Button>
                    <Button
                      variant="secondary" size="sm"
                      disabled={!cfg.enabled || deletingId === cfg.id}
                      loading={previewModal?.key === `${cfg.id}:${cfg.format}` && previewModal.status === 'loading'}
                      onClick={() => void handlePreviewFormat(`${cfg.id}:${cfg.format}`, `${cfg.name} · ${t(`export.formats.${cfg.format}`)}`, cfg.format, cfg.id)}
                    >{t('export.preview_config')}</Button>
                    <Button
                      variant="secondary" size="sm"
                      disabled={!cfg.enabled || deletingId === cfg.id}
                      loading={downloadingId === `${cfg.id}:${cfg.format}`}
                      onClick={() => void handleDownload(cfg)}
                    >{t('export.download')}</Button>
                    <Button
                      variant="secondary" size="sm"
                      disabled={deletingId === cfg.id}
                      loading={resettingId === cfg.id}
                      onClick={() => void handleResetToken(cfg)}
                    >{t('export.reset_token')}</Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={deletingId === cfg.id}
                      aria-label={t('export.delete_config_named', { name: cfg.name })}
                      onClick={() => void handleDelete(cfg)}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
                {!cfg.enabled && <div className={styles.disabledNotice}>{t('export.link_paused_hint')}</div>}
                <div className={styles.urlRow}>
                  <span className={styles.urlLabel}>{t('export.subscription_url')}</span>
                  <div className={styles.urlBox}>
                    <code className={styles.urlCode}>{revealedUrlScopes.has(cfg.id) ? subUrl : maskSubscriptionTokenUrl(subUrl)}</code>
                    {importLink && (cfg.enabled ? (
                      <a
                        className={styles.importLink}
                        href={importLink.url}
                        aria-label={t('export.import_to_app', { app: importLink.appName })}
                      >{t('export.one_click_import')}</a>
                    ) : (
                      <span className={`${styles.importLink} ${styles.importLinkDisabled}`} aria-disabled="true">
                        {t('export.one_click_import')}
                      </span>
                    ))}
                    <Button
                      variant="secondary" size="sm"
                      disabled={!cfg.enabled}
                      onClick={() => void copyUrl(subUrl, cfg.id)}
                    >{copied === cfg.id ? t('common.copied') : t('export.copy_url')}</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!cfg.enabled}
                      onClick={() => setSubscriptionQr({
                        title: t('export.qr_title', { name: cfg.name }),
                        url: subUrl,
                      })}
                    >{t('export.scan_to_add')}</Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleUrlVisibility(cfg.id)}>
                      {t(revealedUrlScopes.has(cfg.id) ? 'export.hide_url' : 'export.reveal_url')}
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Modal
        open={showModal}
        dirty={formDirty}
        onOpenChange={open => {
          if (!open) closeFormModal()
        }}
        title={editingId ? t('export.edit_config') : t('export.new_config')}
        closeDisabled={formSaving}
        footer={<><ModalClose><Button variant="secondary" disabled={formSaving}>{t('common.cancel')}</Button></ModalClose><Button loading={formSaving} onClick={() => void handleSave()}>{t('common.save')}</Button></>}
      >
        {formError != null && <ErrorNotice error={formError} className={styles.error} />}
        <Input label={t('export.name_optional')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('export.name_placeholder')} />
        <div>
          <label className={styles.selectLabel} htmlFor="export-profile-format">{t('export.format')}</label>
          <select id="export-profile-format" className={styles.select} value={form.format} onChange={e => handleFormatChange(e.target.value as ExportFormat)}>
            {EXPORT_FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className={styles.formatCapabilityHint}>
            {selectedFormatCapabilities.outputKind === 'node-subscription'
              ? t('export.format_node_subscription_capability_hint', {
                  protocols: selectedFormatCapabilities.nodeProtocols.join(', '),
                })
              : t('export.format_full_config_capability_hint', {
                  protocols: selectedFormatCapabilities.nodeProtocols.join(', '),
                  dnsCapability: t('export.dns_capability_unified'),
                })}
          </div>
        </div>
        <div>
          <label className={styles.selectLabel} htmlFor="export-profile-conversion-policy">
            {t('export.conversion_policy')}
          </label>
          <select
            id="export-profile-conversion-policy"
            className={styles.select}
            value={form.ruleSetConversionPolicy}
            onChange={e => setForm(f => ({
              ...f,
              ruleSetConversionPolicy: e.target.value as ExportForm['ruleSetConversionPolicy'],
            }))}
          >
            <option value="inherit">{t('export.conversion_policy_inherit')}</option>
            <option value="compatible">{t('settings.rule_set_conversion_compatible')}</option>
            <option value="strict">{t('settings.rule_set_conversion_strict')}</option>
          </select>
          <div className={styles.formatCapabilityHint}>
            {form.ruleSetConversionPolicy === 'inherit' && globalRuleSetConversionPolicy
              ? t('export.conversion_policy_hint_inherit_effective', {
                  policy: t(`settings.rule_set_conversion_${globalRuleSetConversionPolicy}`),
                })
              : t(`export.conversion_policy_hint_${form.ruleSetConversionPolicy}`)}
          </div>
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
              }) + ` ${t('export.auto_conversion_hint')}`}
              options={remoteSets.map(item => {
                const compatibilityMode = getRemoteRuleSetCompatibilityMode(form.format, item)
                const compatible = compatibilityMode !== 'unsupported'
                const formatLabel = item.presetSource === 'quixotic'
                  ? t('export.remote_set_dynamic_preset')
                  : item.presetSource
                    ? t('export.remote_set_builtin_format', { format: item.format })
                    : item.format
                return {
                  id: item.id,
                  label: item.name,
                  description: compatibilityMode === 'converted'
                    ? t('export.remote_set_converted_desc', { label: formatLabel, format: form.format })
                    : compatible
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
        open={Boolean(subscriptionQr)}
        onOpenChange={open => {
          if (!open) setSubscriptionQr(null)
        }}
        title={subscriptionQr?.title ?? ''}
        description={t('export.qr_security_hint')}
        size="sm"
      >
        {subscriptionQr && (
          <div className={styles.qrCode}>
            <QRCodeSVG
              value={subscriptionQr.url}
              size={240}
              level="M"
              marginSize={2}
              title={t('export.qr_image_label')}
            />
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(previewModal)}
        onOpenChange={open => {
          if (!open) setPreviewModal(null)
        }}
        title={previewModal?.title ?? ''}
        size="lg"
      >
        {previewModal && (
          <PreviewModalContent
            preview={previewModal}
            onRefresh={() => void handlePreviewFormat(
              previewModal.key,
              previewModal.title,
              previewModal.format,
              previewModal.configId,
            )}
          />
        )}
      </Modal>
    </div>
  )
}

function isDefaultExportConfig(config: ExportConfig): boolean {
  return isWorkspaceEntityId(config.id, DEFAULT_EXPORT_CONFIG_ID)
}

function QuickExportMoreMenu({
  disabled,
  onPreview,
  onDownload,
}: {
  disabled: boolean
  onPreview: () => void
  onDownload: () => void
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={styles.moreTrigger} disabled={disabled}>
        <span>{t('export.more_actions')}</span>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.moreMenu} align="end" sideOffset={6}>
          <DropdownMenu.Item className={styles.moreMenuItem} onSelect={onPreview}>
            {t('export.preview_config')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={styles.moreMenuItem} onSelect={onDownload}>
            {t('export.download')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type PreviewModalState =
  | { key: string; title: string; format: ExportFormat; configId?: string; status: 'loading' }
  | {
      key: string
      title: string
      format: ExportFormat
      configId?: string
      status: 'ready'
      content: string
      contentType: string
      warnings: CompatibilityWarning[]
      artifactValidation: ExportArtifactValidationResult
      readiness: ExportDownloadReadiness
      refreshing?: boolean
      refreshError?: string
    }
  | { key: string; title: string; format: ExportFormat; configId?: string; status: 'error'; error: string }

function PreviewModalContent({
  preview,
  onRefresh,
}: {
  preview: PreviewModalState
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<unknown | null>(null)
  const [highlighted, setHighlighted] = useState<{ key: string; html: string | null } | null>(null)
  const highlightKey = preview.status === 'ready'
    ? `${preview.format}\u0000${preview.content}`
    : ''
  const lineCount = useMemo(
    () => preview.status === 'ready' ? countContentLines(preview.content) : 0,
    [preview],
  )

  useEffect(() => {
    if (preview.status !== 'ready') return
    let active = true
    void highlightExportContent(preview.content, preview.format)
      .then(html => {
        if (active) setHighlighted({ key: highlightKey, html })
      })
      .catch(() => {
        if (active) setHighlighted({ key: highlightKey, html: null })
      })
    return () => {
      active = false
    }
  }, [highlightKey, preview])

  const handleCopy = async () => {
    if (
      preview.status !== 'ready'
      || !preview.readiness.ready
      || preview.refreshing
      || preview.refreshError
    ) return
    setCopyError(null)
    try {
      await writeClipboardText(preview.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(new Error(t('common.clipboard_copy_failed')))
    }
  }

  if (preview.status === 'loading') {
    return <div className={styles.previewModalEmpty}>{t('preview.generating')}</div>
  }

  if (preview.status === 'error') {
    return (
      <div className={`${styles.validation} ${styles.validationBlocked}`}>
        <span>{preview.error}</span>
        <Button variant="secondary" size="sm" onClick={onRefresh}>{t('common.retry')}</Button>
      </div>
    )
  }

  const summary = summarizeExportWarnings(preview.warnings)
  const canUsePreview = preview.readiness.ready && !preview.refreshing && !preview.refreshError
  const diagnosticWarnings = preview.warnings.filter(warning => !warning.transformation)

  return (
    <>
      <div className={styles.previewModalHeader}>
        <div>
          <span>{preview.contentType} · {t('preview.line_count', { count: lineCount })}</span>
          <span className={preview.artifactValidation.valid ? styles.structureValid : styles.structureInvalid}>
            {preview.artifactValidation.valid
              ? t('preview.structure_valid', { kind: preview.artifactValidation.kind.toUpperCase() })
              : t('preview.structure_invalid', { count: preview.artifactValidation.issues.length })}
          </span>
        </div>
        <div className={styles.previewModalActions}>
          <Button variant="secondary" size="sm" loading={preview.refreshing} onClick={onRefresh}>
            {t('common.refresh')}
          </Button>
          <Button variant="ghost" size="sm" disabled={!canUsePreview} onClick={() => void handleCopy()}>{copied ? t('common.copied') : t('common.copy')}</Button>
        </div>
      </div>
      {(preview.refreshError || !preview.readiness.ready) && (
        <div className={`${styles.validation} ${styles.validationBlocked}`}>
          <strong>
            {preview.refreshError
              ? t('preview.stale_title')
              : t('export.validation_blocked')}
          </strong>
          <span>
            {preview.refreshError
              ? t('preview.stale_after_refresh_error')
              : exportWarningSummaryText(summary, t, preview.readiness)}
          </span>
        </div>
      )}
      {preview.refreshError && <ErrorNotice error={new Error(preview.refreshError)} />}
      {copyError != null && <ErrorNotice error={copyError} />}
      <TransformationReport warnings={preview.warnings} />
      {diagnosticWarnings.length > 0 && (
        <div className={styles.validationWarnings}>
          {diagnosticWarnings.map((warning, index) => (
            <CompatibilityWarningNotice key={`${warning.level}-${index}`} warning={warning} className={styles.validationWarning} />
          ))}
        </div>
      )}
      <div className={styles.previewModalCode}>
        {highlighted?.key === highlightKey && highlighted.html
          ? (
              <div
                className={styles.previewModalSyntax}
                dangerouslySetInnerHTML={{ __html: highlighted.html }}
              />
            )
          : <pre>{preview.content}</pre>}
      </div>
    </>
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
