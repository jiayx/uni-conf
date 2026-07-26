import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { Badge } from '@/components/ui/Badge/Badge'
import { Card } from '@/components/ui/Card/Card'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { summarizeDashboardSourceCreateResults } from '@/core/sources/dashboard-source-create'
import { buildCreateSourcePayload, resolveCreateSourceUserAgent, resolveUpdateSourceUserAgent } from '@/core/sources/source-form'
import { buildImportSourcePayload, isImportContentValid, isImportContentWithinSizeLimit, isImportFileWithinSizeLimit } from '@/core/sources/source-import'
import { shouldRefreshSourceAfterUpdate } from '@/core/sources/source-refresh'
import { maskSubscriptionUrl } from '@/core/sources/source-url-privacy'
import { parseSubscriptionUrls } from '@/core/sources/subscription-urls'
import { useSourcesStore } from '@/store/sources.store'
import { api, ApiError } from '@/lib/api'
import { useRequestedEdit } from '@/core/navigation/use-requested-edit'
import { formValuesEqual, useUnsavedChangesGuard } from '@/core/forms/use-unsaved-changes'
import { MAX_SOURCE_CONTENT_BYTES, SOURCE_FORMATS } from '@uni-conf/shared'
import type { ProxySource, SourceFormat, SourceImportConflictResolution, SourceImportDiffSection, SourceImportPreview, SourceImportRun } from '@uni-conf/types'
import styles from './Sources.module.css'

const FORMAT_OPTIONS: SourceFormat[] = [...SOURCE_FORMATS]

interface SourceForm {
  name: string
  url: string
  format: SourceFormat
  updateInterval: number
  userAgent: string
  customUserAgent: string
  notes: string
  refreshAfterCreate: boolean
}

interface ImportForm {
  name: string
  content: string
  format: SourceFormat
  nodeImportMode: 'all' | 'new-only'
}

const EMPTY_SOURCE_FORM: SourceForm = {
  name: '',
  url: '',
  format: 'auto',
  updateInterval: 0,
  userAgent: '',
  customUserAgent: '',
  notes: '',
  refreshAfterCreate: true,
}

const EMPTY_IMPORT_FORM: ImportForm = {
  name: '',
  content: '',
  format: 'auto',
  nodeImportMode: 'all',
}

const USER_AGENT_OPTIONS = [
  { value: '', labelKey: 'sources.user_agent_default' },
  { value: 'clash.meta/v1.19.23', labelKey: 'sources.user_agent_clash_meta' },
  { value: 'Quantumult%20X/1.4.1', label: 'Quantumult X' },
  { value: 'Surge/5.9.0', label: 'Surge' },
  { value: 'Shadowrocket/1850', label: 'Shadowrocket' },
  { value: 'Loon/308', label: 'Loon' },
  { value: 'Stash/2.4.3', label: 'Stash' },
  { value: 'clash-verge/v1.3.8', label: 'Clash Verge' },
  { value: 'ClashX/1.95.1', label: 'ClashX' },
  { value: 'ClashForWindows/0.20.39', label: 'Clash for Windows' },
  { value: 'ClashForAndroid/2.5.12', label: 'Clash for Android' },
  { value: 'v2rayNG/1.8.5', label: 'v2rayNG' },
  { value: 'custom', labelKey: 'sources.user_agent_custom' },
]

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

export function Sources() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const confirmAction = useConfirmDialog()
  const {
    sources,
    loading,
    error: loadError,
    refreshResults,
    refreshErrors,
    fetchSources,
    addSource,
    importSource,
    updateSource,
    deleteSource,
    refreshSource,
  } = useSourcesStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [editingSource, setEditingSource] = useState<ProxySource | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [form, setForm] = useState<SourceForm>(EMPTY_SOURCE_FORM)
  const [initialForm, setInitialForm] = useState<SourceForm>(EMPTY_SOURCE_FORM)
  const [formError, setFormError] = useState<unknown | null>(null)
  const [actionError, setActionError] = useState<unknown | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [rowAction, setRowAction] = useState<{ id: string; type: 'toggle' | 'delete' } | null>(null)
  const [importForm, setImportForm] = useState<ImportForm>(EMPTY_IMPORT_FORM)
  const [initialImportForm, setInitialImportForm] = useState<ImportForm>(EMPTY_IMPORT_FORM)
  const [importError, setImportError] = useState<unknown | null>(null)
  const [importPreview, setImportPreview] = useState<SourceImportPreview | null>(null)
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, SourceImportConflictResolution>>({})
  const [importing, setImporting] = useState(false)
  const [importNotice, setImportNotice] = useState<{ kind: 'success' | 'warning'; message: string } | null>(null)
  const [importRuns, setImportRuns] = useState<SourceImportRun[]>([])
  const [undoingImportId, setUndoingImportId] = useState<string | null>(null)
  const [retryPreviewingImportId, setRetryPreviewingImportId] = useState<string | null>(null)
  const [nodeRetryPreviewingImportId, setNodeRetryPreviewingImportId] = useState<string | null>(null)
  const [structuredRetryRun, setStructuredRetryRun] = useState<SourceImportRun | null>(null)
  const [nodeRetryRun, setNodeRetryRun] = useState<SourceImportRun | null>(null)
  const [revealedSourceIds, setRevealedSourceIds] = useState<Set<string>>(() => new Set())
  const importFileInputRef = useRef<HTMLInputElement>(null)
  const sourceFormDirty = (showAddModal || showEditModal) && !formValuesEqual(form, initialForm)
  const importFormDirty = showImportModal && (
    !formValuesEqual(importForm, initialImportForm)
    || Object.keys(conflictResolutions).length > 0
  )
  const canAddSources = parseSubscriptionUrls(form.url).length > 0
  const confirmDiscardSourceForm = useUnsavedChangesGuard(sourceFormDirty)
  const confirmDiscardImportForm = useUnsavedChangesGuard(importFormDirty)
  const refreshAttentionMode = searchParams.get('attention') === 'refresh'
  const refreshFailureSources = sources.filter(source =>
    Boolean(refreshErrors[source.id] || source.lastRefreshError)
  )
  const visibleSources = refreshAttentionMode ? refreshFailureSources : sources

  const clearRefreshAttentionFilter = () => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('attention')
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    void fetchSources()
    void api.sources.listImports().then(setImportRuns).catch(setActionError)
  }, [fetchSources])

  const handleAdd = async () => {
    const urls = parseSubscriptionUrls(form.url)
    if (urls.length === 0) { setFormError(t('sources.url_required')); return }
    setFormError(null)
    setFormSaving(true)
    // When userAgent is empty string (Default), send undefined to use backend default
    // When userAgent is 'custom', use customUserAgent
    // Otherwise use the selected preset
    const finalUserAgent = resolveCreateSourceUserAgent(form.userAgent, form.customUserAgent)
    try {
      const results = await Promise.allSettled(
        urls.map(url => addSource(buildCreateSourcePayload({
          name: urls.length === 1 ? form.name.trim() || undefined : undefined,
          url,
          format: form.format,
          updateInterval: form.updateInterval,
          userAgent: finalUserAgent,
          notes: form.notes,
          refreshAfterCreate: form.refreshAfterCreate,
        })))
      )
      const summary = summarizeDashboardSourceCreateResults(urls, results)
      if (summary.nextInput || summary.error) {
        setForm(f => ({ ...f, url: summary.nextInput }))
        if (summary.error?.kind === 'save-failed') {
          const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
          setFormError(withContextMessage(
            firstFailure?.reason,
            t('sources.save_failed_count', { count: summary.error.count ?? 0, message: summary.error.message }),
          ))
        } else if (summary.error?.kind === 'refresh-failed') {
          setFormError(new Error(`${t('sources.refresh_failed')}: ${summary.error.message}`))
        }
        return
      }
      setShowAddModal(false)
      setForm(EMPTY_SOURCE_FORM)
    } finally {
      setFormSaving(false)
    }
  }

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return
    if (!isImportFileWithinSizeLimit(file.size)) {
      setImportError(t('sources.import_content_too_large', { size: MAX_SOURCE_CONTENT_BYTES / 1024 / 1024 }))
      setImportPreview(null)
      if (importFileInputRef.current) importFileInputRef.current.value = ''
      return
    }
    const text = await file.text()
    if (!isImportContentWithinSizeLimit(text)) {
      setImportError(t('sources.import_content_too_large', { size: MAX_SOURCE_CONTENT_BYTES / 1024 / 1024 }))
      setImportPreview(null)
      if (importFileInputRef.current) importFileInputRef.current.value = ''
      return
    }
    setImportError(null)
    setImportPreview(null)
    setConflictResolutions({})
    setImportForm(f => ({ ...f, content: text, name: f.name || file.name.replace(/\.[^.]+$/, '') }))
    if (importFileInputRef.current) importFileInputRef.current.value = ''
  }

  const handleImport = async () => {
    if (!isImportContentValid(importForm.content)) {
      setImportError(t('sources.import_content_required'))
      return
    }
    if (!isImportContentWithinSizeLimit(importForm.content)) {
      setImportError(t('sources.import_content_too_large', { size: MAX_SOURCE_CONTENT_BYTES / 1024 / 1024 }))
      return
    }
    setImportError(null)
    setImporting(true)
    try {
      const payload = buildImportSourcePayload({
        ...importForm,
        name: importForm.name.trim() || t('sources.import_default_name'),
      })
      setImportPreview(await api.sources.previewImport(payload))
      setConflictResolutions({})
    } catch (e) {
      setImportError(e)
    } finally {
      setImporting(false)
    }
  }

  const confirmImport = async () => {
    setImportError(null)
    setImportNotice(null)
    setImporting(true)
    try {
      const result = await importSource(buildImportSourcePayload({
        ...importForm,
        name: importForm.name.trim() || t('sources.import_default_name'),
        importStructured: true,
        structuredConflictResolutions: conflictResolutions,
      }))
      const warnings = [
        result.refreshError ? `${t('sources.refresh_failed')}: ${result.refreshError}` : '',
        result.structuredImportError
          ? t('sources.structured_import_failed', { error: result.structuredImportError })
          : '',
      ].filter(Boolean)
      setImportNotice(warnings.length > 0
        ? { kind: 'warning', message: warnings.join(' ') }
        : { kind: 'success', message: t('sources.import_success') })
      if (result.importRun) {
        setImportRuns((runs) => [result.importRun!, ...runs.filter((run) => run.id !== result.importRun!.id)])
      }
      setShowImportModal(false)
      setImportForm(EMPTY_IMPORT_FORM)
      setImportPreview(null)
      setConflictResolutions({})
    } catch (e) {
      setImportError(e)
    } finally {
      setImporting(false)
    }
  }

  const handleRefresh = async (id: string) => {
    setRefreshingId(id)
    setActionError(null)
    try {
      await refreshSource(id)
    } catch (error) {
      setActionError(error)
    } finally {
      setRefreshingId(null)
    }
  }

  const handleUndoImport = async (run: SourceImportRun) => {
    if (!run.canUndo || !(await confirmAction({
      description: t('sources.import_history_undo_confirm', { name: run.sourceName }),
      confirmLabel: t('common.confirm'),
      danger: true,
    }))) return
    setUndoingImportId(run.id)
    try {
      const updated = await api.sources.undoImport(run.id)
      setImportRuns((runs) => runs.map((item) => item.id === updated.id ? updated : item))
      await fetchSources()
      setImportNotice({ kind: 'success', message: t('sources.import_history_undo_success') })
    } catch (error) {
      setImportNotice({ kind: 'warning', message: t('sources.import_history_undo_failed', { error: (error as Error).message }) })
    } finally {
      setUndoingImportId(null)
    }
  }

  const handlePreviewStructuredRetry = async (run: SourceImportRun) => {
    setRetryPreviewingImportId(run.id)
    setImportError(null)
    try {
      const preview = await api.sources.previewStructuredRetry(run.id)
      setStructuredRetryRun(run)
      setImportPreview(preview)
      setConflictResolutions({})
      setShowImportModal(true)
    } catch (error) {
      setImportNotice({ kind: 'warning', message: t('sources.import_retry_failed', { error: (error as Error).message }) })
    } finally {
      setRetryPreviewingImportId(null)
    }
  }

  const handlePreviewNodeRetry = async (run: SourceImportRun) => {
    setNodeRetryPreviewingImportId(run.id)
    setImportError(null)
    try {
      const preview = await api.sources.previewNodeRetry(run.id)
      setNodeRetryRun(run)
      setImportPreview(preview)
      setShowImportModal(true)
    } catch (error) {
      setImportNotice({ kind: 'warning', message: t('sources.import_node_retry_failed', { error: (error as Error).message }) })
    } finally {
      setNodeRetryPreviewingImportId(null)
    }
  }

  const confirmStructuredRetry = async () => {
    if (!structuredRetryRun) return
    setImporting(true)
    setImportError('')
    try {
      const result = await api.sources.retryStructuredImport(structuredRetryRun.id, conflictResolutions)
      setImportRuns((runs) => runs.map((run) => run.id === result.importRun.id ? result.importRun : run))
      setImportNotice({ kind: 'success', message: t('sources.import_retry_success') })
      setShowImportModal(false)
      setStructuredRetryRun(null)
      setImportPreview(null)
      setConflictResolutions({})
    } catch (error) {
      setImportError(withContextMessage(error, t('sources.import_retry_failed', { error: (error as Error).message })))
    } finally {
      setImporting(false)
    }
  }

  const confirmNodeRetry = async () => {
    if (!nodeRetryRun) return
    setImporting(true)
    setImportError('')
    try {
      const result = await api.sources.retryNodeImport(nodeRetryRun.id)
      setImportRuns((runs) => runs.map((run) => run.id === result.importRun.id ? result.importRun : run))
      await fetchSources()
      setImportNotice({ kind: 'success', message: t('sources.import_node_retry_success') })
      closeImportModal()
    } catch (error) {
      setImportError(withContextMessage(error, t('sources.import_node_retry_failed', { error: (error as Error).message })))
    } finally {
      setImporting(false)
    }
  }

  const closeImportModal = () => {
    setShowImportModal(false)
    setImportError('')
    setImportPreview(null)
    setConflictResolutions({})
    setStructuredRetryRun(null)
    setNodeRetryRun(null)
    setImportForm(EMPTY_IMPORT_FORM)
    setInitialImportForm(EMPTY_IMPORT_FORM)
  }

  const requestCloseImportModal = async () => {
    if (!(await confirmDiscardImportForm())) return
    closeImportModal()
  }

  const handleToggle = async (source: ProxySource) => {
    setRowAction({ id: source.id, type: 'toggle' })
    setActionError(null)
    try {
      await updateSource(source.id, { enabled: !source.enabled })
    } catch (error) {
      setActionError(error)
    } finally {
      setRowAction(null)
    }
  }

  const toggleSourceUrl = async (source: ProxySource) => {
    const isRevealed = revealedSourceIds.has(source.id)
    if (!isRevealed && !(await confirmAction({ description: t('sources.reveal_url_confirm') }))) return
    setRevealedSourceIds(current => {
      const next = new Set(current)
      if (isRevealed) next.delete(source.id)
      else next.add(source.id)
      return next
    })
  }

  const handleDeleteSource = async (source: ProxySource) => {
    if (!(await confirmAction({
      description: t('sources.delete_confirm'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    setRowAction({ id: source.id, type: 'delete' })
    setActionError(null)
    try {
      await deleteSource(source.id)
      setRevealedSourceIds(current => {
        const next = new Set(current)
        next.delete(source.id)
        return next
      })
    } catch (error) {
      setActionError(error)
    } finally {
      setRowAction(null)
    }
  }

  const handleEdit = (source: ProxySource) => {
    setFormError(null)
    setEditingSource(source)
    // Parse userAgent to determine if it's custom
    const isPreset = USER_AGENT_OPTIONS.some(opt => opt.value === source.userAgent)
    const nextForm: SourceForm = {
      name: source.name,
      url: source.url || '',
      format: source.format,
      updateInterval: source.updateInterval || 0,
      userAgent: isPreset ? (source.userAgent || '') : (source.userAgent ? 'custom' : ''),
      customUserAgent: isPreset ? '' : (source.userAgent || ''),
      notes: source.notes || '',
      refreshAfterCreate: false,
    }
    setForm(nextForm)
    setInitialForm(nextForm)
    setShowEditModal(true)
  }

  useRequestedEdit(sources.filter(source => source.type === 'url'), handleEdit)

  const handleUpdate = async () => {
    if (!editingSource) return
    if (!form.url) { setFormError(t('sources.url_required')); return }
    setFormError(null)
    setFormSaving(true)
    // When userAgent is empty string (Default), explicitly pass empty string to clear it
    // When userAgent is 'custom', use customUserAgent
    // Otherwise use the selected preset
    const finalUserAgent = resolveUpdateSourceUserAgent(form.userAgent, form.customUserAgent)
    const update = {
      name: form.name,
      url: form.url,
      format: form.format,
      updateInterval: form.updateInterval,
      userAgent: finalUserAgent,
      notes: form.notes,
    }
    try {
      const shouldRefreshAfterUpdate = shouldRefreshSourceAfterUpdate(editingSource, update)
      await updateSource(editingSource.id, update)
      if (shouldRefreshAfterUpdate) {
        await handleRefresh(editingSource.id)
      }
      setShowEditModal(false)
      setEditingSource(null)
      setForm(EMPTY_SOURCE_FORM)
    } catch (error) {
      setFormError(error)
    } finally {
      setFormSaving(false)
    }
  }

  const openAddModal = () => {
    setFormError(null)
    setForm(EMPTY_SOURCE_FORM)
    setInitialForm(EMPTY_SOURCE_FORM)
    setShowAddModal(true)
  }

  const openImportModal = () => {
    setImportForm(EMPTY_IMPORT_FORM)
    setInitialImportForm(EMPTY_IMPORT_FORM)
    setImportError(null)
    setImportPreview(null)
    setConflictResolutions({})
    setShowImportModal(true)
  }

  const closeSourceFormModal = async (kind: 'add' | 'edit') => {
    if (!(await confirmDiscardSourceForm())) return
    if (kind === 'add') setShowAddModal(false)
    else {
      setShowEditModal(false)
      setEditingSource(null)
    }
    setForm(EMPTY_SOURCE_FORM)
    setInitialForm(EMPTY_SOURCE_FORM)
    setFormError(null)
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('sources.title')}
        actions={
          <>
            <Button variant="secondary" onClick={openImportModal} icon={<ImportIcon />}>
              {t('sources.import_config')}
            </Button>
            <Button onClick={openAddModal} icon={<PlusIcon />}>
              {t('sources.add_url')}
            </Button>
          </>
        }
      />
      {loadError != null && <ErrorNotice error={loadError} />}
      {actionError != null && <ErrorNotice error={actionError} />}

      {importNotice && (
        <div
          className={importNotice.kind === 'success' ? styles.importSuccess : styles.importWarning}
          role="status"
          aria-live="polite"
        >
          {importNotice.message}
        </div>
      )}

      {importRuns.length > 0 && (
        <details className={styles.importHistory}>
          <summary>{t('sources.import_history_title', { count: importRuns.length })}</summary>
          <div className={styles.importHistoryList}>
            {importRuns.map((run) => (
              <div className={styles.importHistoryItem} key={run.id}>
                <div className={styles.importHistoryMain}>
                  <strong>{run.sourceName}</strong>
                  <span>{t(`sources.import_history_status_${run.status}`)}</span>
                </div>
                <div className={styles.importHistoryMeta}>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                  <span>{t('sources.import_history_counts', {
                    nodes: run.nodeCount,
                    rules: run.ruleCount,
                    sets: run.remoteRuleSetCount,
                  })}</span>
                  {(run.skippedExistingCount > 0 || run.skippedRuleCount > 0) && (
                    <span>{t('sources.import_history_skipped', {
                      nodes: run.skippedExistingCount,
                      rules: run.skippedRuleCount,
                    })}</span>
                  )}
                  {run.conflictCount > 0 && <span>{t('sources.import_history_conflicts', { count: run.conflictCount })}</span>}
                  {run.nodeImportMode === 'new-only' && <span>{t('sources.import_history_new_only')}</span>}
                </div>
                {run.refreshError && <div className={styles.importHistoryError}>{t('sources.import_history_node_error')}: {run.refreshError}</div>}
                {run.structuredError && <div className={styles.importHistoryError}>{t('sources.import_history_structured_error')}: {run.structuredError}</div>}
                <div className={styles.importHistoryActions}>
                  {run.canUndo && run.status === 'partial' && run.refreshError && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={nodeRetryPreviewingImportId === run.id}
                      onClick={() => void handlePreviewNodeRetry(run)}
                    >
                      {t('sources.import_history_retry_nodes')}
                    </Button>
                  )}
                  {run.canUndo && run.status === 'partial' && run.structuredError && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={retryPreviewingImportId === run.id}
                      onClick={() => void handlePreviewStructuredRetry(run)}
                    >
                      {t('sources.import_history_retry_structured')}
                    </Button>
                  )}
                  {run.canUndo && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={undoingImportId === run.id}
                      onClick={() => void handleUndoImport(run)}
                    >
                      {t('sources.import_history_undo')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {refreshAttentionMode && sources.length > 0 && (
        <div className={styles.attentionFilter} role="status">
          <div>
            <strong>{t('sources.refresh_attention_title')}</strong>
            <span>{t('sources.refresh_attention_summary', { count: refreshFailureSources.length })}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={clearRefreshAttentionFilter}>
            {t('sources.refresh_attention_clear')}
          </Button>
        </div>
      )}

      {loading && sources.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<SubscriptionIcon />}
          title={t('sources.empty_title')}
          description={t('sources.empty_description')}
          action={{ label: t('sources.add_url'), onClick: openAddModal }}
        />
      ) : visibleSources.length === 0 ? (
        <EmptyState
          title={t('sources.refresh_attention_empty_title')}
          description={t('sources.refresh_attention_empty_description')}
          action={{
            label: t('sources.refresh_attention_clear'),
            onClick: clearRefreshAttentionFilter,
          }}
        />
      ) : (
        <div className={styles.grid}>
          {visibleSources.map(source => (
            <Card key={source.id} className={styles.sourceCard}>
              <div className={styles.cardHeader}>
                <div className={styles.titleRow}>
                  <button
                    type="button"
                    className={`${styles.toggleBtn} ${source.enabled ? styles.enabled : styles.disabled}`}
                    aria-label={source.enabled
                      ? t('sources.disable_source', { name: source.name })
                      : t('sources.enable_source', { name: source.name })}
                    aria-busy={rowAction?.id === source.id && rowAction.type === 'toggle'}
                    disabled={rowAction?.id === source.id || refreshingId === source.id}
                    onClick={() => void handleToggle(source)}
                    title={source.enabled ? t('common.disable') : t('common.enable')}
                  />
                  <div className={styles.cardTitle}>{source.name}</div>
                </div>
                <div className={styles.cardActions}>
                  {source.type === 'url' && (
                    <>
                      <Button
                        variant="ghost" size="sm"
                        disabled={rowAction?.id === source.id || refreshingId === source.id}
                        aria-label={t('sources.edit_source', { name: source.name })}
                        onClick={() => handleEdit(source)}
                        title={t('common.edit')}
                      >
                        <EditIcon />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        loading={refreshingId === source.id}
                        disabled={rowAction?.id === source.id}
                        aria-label={t('sources.refresh_source', { name: source.name })}
                        onClick={() => void handleRefresh(source.id)}
                        title={t('sources.refresh_now')}
                      >
                        <RefreshIcon />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost" size="sm"
                    loading={rowAction?.id === source.id && rowAction.type === 'delete'}
                    disabled={rowAction?.id === source.id || refreshingId === source.id}
                    aria-label={t('sources.delete_source', { name: source.name })}
                    onClick={() => void handleDeleteSource(source)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
              <div className={styles.cardMeta}>
                <Badge variant={source.enabled ? 'success' : 'default'}>
                  {source.enabled ? t('common.enabled') : t('common.disabled')}
                </Badge>
                <Badge variant="info">{source.format.toUpperCase()}</Badge>
                {source.type !== 'url' && <Badge variant="default">{t('sources.imported_source')}</Badge>}
              </div>
              {source.type === 'url' && (
                <div className={styles.urlRow}>
                  <div className={styles.cardUrl}>
                    {revealedSourceIds.has(source.id) ? (source.url ?? '') : maskSubscriptionUrl(source.url ?? '')}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void toggleSourceUrl(source)}
                    aria-label={revealedSourceIds.has(source.id) ? t('sources.hide_url') : t('sources.reveal_url')}
                  >
                    {revealedSourceIds.has(source.id) ? t('sources.hide_url') : t('sources.reveal_url')}
                  </Button>
                </div>
              )}
              <div className={styles.cardStats}>
                <span>{t('sources.node_count')}: <strong>{source.nodeCount}</strong></span>
                {source.lastUpdated && (
                  <span>{t('sources.last_updated')}: {new Date(source.lastUpdated).toLocaleString()}</span>
                )}
              </div>
              {(source.totalBytes !== undefined || source.expireTime !== undefined) && (
                <div className={styles.subscriptionInfo}>
                  {source.totalBytes !== undefined && (
                    <span>
                      {t('sources.traffic')}: <strong>{formatBytes((source.downloadBytes || 0) + (source.uploadBytes || 0))} / {formatBytes(source.totalBytes)}</strong>
                    </span>
                  )}
                  {source.expireTime !== undefined && (
                    <span>
                      {t('sources.expire')}: <strong>{new Date(source.expireTime * 1000).toLocaleDateString()}</strong>
                    </span>
                  )}
                </div>
              )}
              {refreshResults[source.id] && (
                <div className={styles.refreshStatus}>
                  {t('sources.refresh_success', { count: refreshResults[source.id].nodeCount })}
                  <span>
                    +{refreshResults[source.id].addedCount} / ~{refreshResults[source.id].updatedCount ?? 0} / -{refreshResults[source.id].removedCount}
                  </span>
                </div>
              )}
              {source.type === 'url' && (refreshErrors[source.id] || source.lastRefreshError) && (
                <div className={styles.refreshError}>
                  {t('sources.refresh_failed')}: {refreshErrors[source.id] || source.lastRefreshError}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showAddModal}
        onOpenChange={open => {
          if (!open) void closeSourceFormModal('add')
        }}
        title={t('sources.add_url')}
        closeDisabled={formSaving}
        footer={
          <>
            <Button variant="secondary" disabled={formSaving} onClick={() => void closeSourceFormModal('add')}>{t('common.cancel')}</Button>
            <Button loading={formSaving} disabled={!canAddSources} onClick={() => void handleAdd()}>{t('sources.save_and_generate')}</Button>
          </>
        }
      >
        {formError != null && <ErrorNotice error={formError} className={styles.formError} />}
        <label className={styles.textareaField}>
          <span>{t('sources.url')}</span>
          <textarea
            className={styles.textarea}
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder={t('sources.url_placeholder')}
            required
          />
        </label>
        <details className={styles.advanced}>
          <summary>{t('sources.advanced_options')}</summary>
          <div className={styles.advancedBody}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={form.refreshAfterCreate}
                onChange={e => setForm(f => ({ ...f, refreshAfterCreate: e.target.checked }))}
              />
              <span>{t('sources.refresh_now')}</span>
            </label>
            <Input
              label={t('sources.name_optional')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t('sources.name_auto_placeholder')}
            />
            <div>
              <label className={styles.selectLabel} htmlFor="add-source-format">{t('sources.format')}</label>
              <select
                id="add-source-format"
                className={styles.select}
                value={form.format}
                onChange={e => setForm(f => ({ ...f, format: e.target.value as SourceFormat }))}
              >
                {FORMAT_OPTIONS.map(format => (
                  <option key={format} value={format}>{t(`sources.format_${format}`)}</option>
                ))}
              </select>
            </div>
            <Input
              label={t('sources.update_interval')}
              type="number"
              min="0"
              value={form.updateInterval}
              onChange={e => setForm(f => ({ ...f, updateInterval: Number(e.target.value) }))}
              helperText={t('sources.update_interval_hint')}
            />
            <div>
              <label className={styles.selectLabel} htmlFor="add-source-user-agent">{t('sources.user_agent')}</label>
              <select
                id="add-source-user-agent"
                className={styles.select}
                value={form.userAgent}
                onChange={e => setForm(f => ({ ...f, userAgent: e.target.value }))}
              >
                {USER_AGENT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.labelKey ? t(opt.labelKey) : opt.label}</option>
                ))}
              </select>
            </div>
            {form.userAgent === 'custom' && (
              <Input
                label={t('sources.custom_user_agent')}
                value={form.customUserAgent}
                onChange={e => setForm(f => ({ ...f, customUserAgent: e.target.value }))}
                placeholder="YourClient/1.0.0"
              />
            )}
            <Input
              label={t('common.notes')}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder={t('common.notes')}
            />
          </div>
        </details>
      </Modal>

      <Modal
        open={showEditModal}
        onOpenChange={open => {
          if (!open) void closeSourceFormModal('edit')
        }}
        title={t('common.edit') + ' - ' + editingSource?.name}
        closeDisabled={formSaving}
        footer={
          <>
            <Button variant="secondary" disabled={formSaving} onClick={() => void closeSourceFormModal('edit')}>{t('common.cancel')}</Button>
            <Button loading={formSaving} onClick={() => void handleUpdate()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError != null && <ErrorNotice error={formError} className={styles.formError} />}
        <Input
          label={t('sources.name_optional')}
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder={t('sources.name_auto_placeholder')}
        />
        <Input
          label={t('sources.url')}
          value={form.url}
          onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
          placeholder={t('sources.url_single_placeholder')}
        />
        <div>
          <label className={styles.selectLabel} htmlFor="edit-source-format">{t('sources.format')}</label>
          <select
            id="edit-source-format"
            className={styles.select}
            value={form.format}
            onChange={e => setForm(f => ({ ...f, format: e.target.value as SourceFormat }))}
          >
            {FORMAT_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{t(`sources.format_${opt}`)}</option>
            ))}
          </select>
        </div>
        <Input
          label={t('sources.update_interval')}
          type="number"
          min="0"
          value={form.updateInterval}
          onChange={e => setForm(f => ({ ...f, updateInterval: Number(e.target.value) }))}
          helperText={t('sources.update_interval_hint')}
        />
        <div>
          <label className={styles.selectLabel} htmlFor="edit-source-user-agent">{t('sources.user_agent')}</label>
          <select
            id="edit-source-user-agent"
            className={styles.select}
            value={form.userAgent}
            onChange={e => setForm(f => ({ ...f, userAgent: e.target.value }))}
          >
            {USER_AGENT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.labelKey ? t(opt.labelKey) : opt.label}</option>
            ))}
          </select>
          <div className={styles.helperText}>
            {t('sources.user_agent_recommendation')}
          </div>
        </div>
        {form.userAgent === 'custom' && (
          <Input
            label={t('sources.custom_user_agent')}
            value={form.customUserAgent}
            onChange={e => setForm(f => ({ ...f, customUserAgent: e.target.value }))}
            placeholder="YourClient/1.0.0"
          />
        )}
        <Input
          label={t('common.notes')}
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder={t('common.notes')}
        />
      </Modal>

      <Modal
        open={showImportModal}
        onOpenChange={(open) => {
          if (!open) void requestCloseImportModal()
        }}
        title={nodeRetryRun
          ? t('sources.import_node_retry_title')
          : structuredRetryRun ? t('sources.import_retry_title') : t('sources.import_config')}
        footer={
          <>
            <Button variant="secondary" onClick={() => void requestCloseImportModal()}>{t('common.cancel')}</Button>
            <Button
              loading={importing}
              disabled={Boolean(!structuredRetryRun && !nodeRetryRun && importPreview && importForm.nodeImportMode === 'new-only' && importPreview.diff.nodes.counts.new === 0)}
              onClick={() => void (nodeRetryRun
                ? confirmNodeRetry()
                : structuredRetryRun ? confirmStructuredRetry() : importPreview ? confirmImport() : handleImport())}
            >
              {nodeRetryRun
                ? t('sources.import_node_retry_confirm')
                : structuredRetryRun ? t('sources.import_retry_confirm') : importPreview ? t('sources.import_confirm') : t('sources.import_preview')}
            </Button>
          </>
        }
      >
        {importError != null && importError !== '' && <ErrorNotice error={importError} className={styles.formError} />}
        {!structuredRetryRun && !nodeRetryRun && <div className={styles.quickHint}>
          <div className={styles.quickHintTitle}>{t('sources.import_hint_title')}</div>
          <div className={styles.quickHintText}>{t('sources.import_hint_text')}</div>
        </div>}
        {importPreview && (
          <div className={styles.quickHint}>
            <div className={styles.quickHintTitle}>{t('sources.import_preview_title')}</div>
            {nodeRetryRun && <div className={styles.quickHintText}>{t('sources.import_node_retry_hint', { name: nodeRetryRun.sourceName })}</div>}
            {!structuredRetryRun && importPreview.nodeCount > 0 && <div className={styles.quickHintText}>
              {t('sources.import_preview_summary', {
                format: importPreview.detectedFormat,
                nodes: importPreview.nodeCount,
                excluded: importPreview.excludedCount,
                groups: importPreview.sourceGroupCount,
              })}
            </div>}
            {!structuredRetryRun && importPreview.nodeCount === 0 && (
              <div className={styles.quickHintText}>{t('sources.import_preview_structured_only', { format: importPreview.detectedFormat })}</div>
            )}
            {structuredRetryRun && <div className={styles.quickHintText}>{t('sources.import_retry_hint', { name: structuredRetryRun.sourceName })}</div>}
            {!nodeRetryRun && <div className={styles.quickHintText}>
              {t('sources.import_preview_structured', {
                rules: importPreview.structured.rules,
                sets: importPreview.structured.remoteRuleSets,
                skipped: importPreview.structured.skippedRules,
              })}
            </div>}
            {!nodeRetryRun && (importPreview.structured.duplicateRules > 0 || importPreview.structured.duplicateRemoteRuleSets > 0) && (
              <div className={styles.quickHintText}>
                {t('sources.import_preview_duplicates', {
                  rules: importPreview.structured.duplicateRules,
                  sets: importPreview.structured.duplicateRemoteRuleSets,
                })}
              </div>
            )}
            {!nodeRetryRun && (importPreview.structured.conflictingRules > 0 || importPreview.structured.conflictingRemoteRuleSets > 0) && (
              <div className={styles.importConflictNotice}>
                {t('sources.import_preview_conflicts', {
                  rules: importPreview.structured.conflictingRules,
                  sets: importPreview.structured.conflictingRemoteRuleSets,
                })}
              </div>
            )}
            {!nodeRetryRun && importPreview.structured.unmappedTargets.length > 0 && (
              <div className={styles.quickHintText}>
                {t('sources.import_preview_unmapped', { targets: importPreview.structured.unmappedTargets.join(', ') })}
              </div>
            )}
            {!nodeRetryRun && (importPreview.structured.hasDns || importPreview.structured.clientSettingKeys.length > 0) && (
              <div className={styles.quickHintText}>{t('sources.import_preview_limit')}</div>
            )}
            <div className={styles.importDiffList}>
              {!structuredRetryRun && <ImportDiffSection title={t('sources.import_diff_nodes')} section={importPreview.diff.nodes} />}
              {!nodeRetryRun && <ImportDiffSection
                title={t('sources.import_diff_rules')}
                section={importPreview.diff.rules}
                conflictResolutions={conflictResolutions}
                onConflictResolutionChange={(key, resolution) => setConflictResolutions(current => ({ ...current, [key]: resolution }))}
              />}
              {!nodeRetryRun && <ImportDiffSection
                title={t('sources.import_diff_remote_sets')}
                section={importPreview.diff.remoteRuleSets}
                conflictResolutions={conflictResolutions}
                onConflictResolutionChange={(key, resolution) => setConflictResolutions(current => ({ ...current, [key]: resolution }))}
              />}
            </div>
            {!structuredRetryRun && !nodeRetryRun && importPreview.nodeCount > 0 && <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={importForm.nodeImportMode === 'new-only'}
                onChange={event => setImportForm(current => ({
                  ...current,
                  nodeImportMode: event.target.checked ? 'new-only' : 'all',
                }))}
              />
              <span>{t('sources.import_new_nodes_only')}</span>
            </label>}
            {!structuredRetryRun && !nodeRetryRun && importForm.nodeImportMode === 'new-only' && importPreview.diff.nodes.counts.new === 0 && (
              <div className={styles.importConflictNotice}>{t('sources.import_no_new_nodes')}</div>
            )}
          </div>
        )}
        {!structuredRetryRun && !nodeRetryRun && <>
        <label className={styles.textareaField}>
          <span>{t('sources.import_content')}</span>
          <textarea
            className={styles.textarea}
            value={importForm.content}
            onChange={e => { setImportPreview(null); setConflictResolutions({}); setImportForm(f => ({ ...f, content: e.target.value })) }}
            placeholder={t('sources.import_content_placeholder')}
            rows={10}
          />
        </label>
        <Button variant="secondary" size="sm" onClick={() => importFileInputRef.current?.click()}>
          {t('sources.import_from_file')}
        </Button>
        <input
          ref={importFileInputRef}
          type="file"
          accept=".yaml,.yml,.json,.conf,.txt"
          className={styles.fileInput}
          onChange={e => void handleImportFile(e.target.files?.[0])}
        />
        <Input
          label={t('sources.name_optional')}
          value={importForm.name}
          onChange={e => setImportForm(f => ({ ...f, name: e.target.value }))}
          placeholder={t('sources.import_name_placeholder')}
        />
        <div>
          <label className={styles.selectLabel} htmlFor="import-source-format">{t('sources.format')}</label>
          <select
            id="import-source-format"
            className={styles.select}
            value={importForm.format}
            onChange={e => { setImportPreview(null); setConflictResolutions({}); setImportForm(f => ({ ...f, format: e.target.value as SourceFormat })) }}
          >
            {FORMAT_OPTIONS.map(format => (
              <option key={format} value={format}>{t(`sources.format_${format}`)}</option>
            ))}
          </select>
        </div>
        </>}
      </Modal>
    </div>
  )
}

function ImportDiffSection({
  title,
  section,
  conflictResolutions,
  onConflictResolutionChange,
}: {
  title: string
  section: SourceImportDiffSection
  conflictResolutions?: Record<string, SourceImportConflictResolution>
  onConflictResolutionChange?: (key: string, resolution: SourceImportConflictResolution) => void
}) {
  const { t } = useTranslation()
  if (section.total === 0) return null
  const counts = section.counts

  return (
    <details className={styles.importDiffSection} open={counts.conflict > 0 || counts.unmapped > 0}>
      <summary>
        <span>{title} ({section.total})</span>
        <span className={styles.importDiffCounts}>
          {(['new', 'duplicate', 'conflict', 'unmapped'] as const).map(status => counts[status] > 0 && (
            <span key={status} className={styles[`diff_${status}`]}>{t(`sources.import_diff_${status}`)} {counts[status]}</span>
          ))}
        </span>
      </summary>
      <div className={styles.importDiffItems}>
        {section.items.map(item => (
          <div key={item.key} className={styles.importDiffItem}>
            <div className={styles.importDiffItemHeader}>
              <strong>{item.label}</strong>
              <span className={styles[`diff_${item.status}`]}>{t(`sources.import_diff_${item.status}`)}</span>
            </div>
            {item.target && <div className={styles.importDiffTarget}>{t('sources.import_diff_target')}: {item.target}</div>}
            {item.changes.map(change => (
              <div key={`${item.key}-${change.field}`} className={styles.importDiffChange}>
                {t(`sources.import_diff_field_${change.field}`, { defaultValue: change.field })}: {change.before ?? '—'} → {change.after ?? '—'}
              </div>
            ))}
            {item.status === 'conflict' && item.resolvable && onConflictResolutionChange && (
              <label className={styles.importConflictResolution}>
                <span>{t('sources.import_conflict_resolution')}</span>
                <select
                  className={styles.select}
                  value={conflictResolutions?.[item.key] ?? 'keep-existing'}
                  onChange={event => onConflictResolutionChange(item.key, event.target.value as SourceImportConflictResolution)}
                >
                  <option value="keep-existing">{t('sources.import_conflict_keep')}</option>
                  <option value="use-imported">{t('sources.import_conflict_use_imported')}</option>
                </select>
              </label>
            )}
            {item.status === 'conflict' && item.resolvable === false && (
              <div className={styles.importConflictUnresolvable}>{t('sources.import_conflict_not_resolvable')}</div>
            )}
          </div>
        ))}
        {section.truncated && <div className={styles.importDiffTruncated}>{t('sources.import_diff_truncated', { count: section.total - section.items.length })}</div>}
      </div>
    </details>
  )
}

function withContextMessage(error: unknown, message: string): Error {
  return error instanceof ApiError
    ? new ApiError(message, error.status, error.code, error.requestId)
    : new Error(message)
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function ImportIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}
function EditIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}
function RefreshIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
}
function TrashIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
}
function SubscriptionIcon() {
  return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
}
