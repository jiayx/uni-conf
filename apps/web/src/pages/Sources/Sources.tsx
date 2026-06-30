import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { Badge } from '@/components/ui/Badge/Badge'
import { Card } from '@/components/ui/Card/Card'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { shouldRefreshSourceAfterUpdate } from '@/core/sources/source-refresh'
import { parseSubscriptionUrls } from '@/core/sources/subscription-urls'
import { useSourcesStore } from '@/store/sources.store'
import { SOURCE_FORMATS } from '@uni-conf/shared'
import type { ProxySource, SourceFormat } from '@uni-conf/types'
import styles from './Sources.module.css'

const SOURCE_FORMAT_LABELS: Record<SourceFormat, string> = {
  auto: 'Auto detect',
  mihomo: 'Mihomo / Clash.Meta',
  clash: 'Clash',
  singbox: 'sing-box',
  base64: 'Base64 nodes',
  surge: 'Surge',
  loon: 'Loon',
  quantumultx: 'Quantumult X',
  shadowrocket: 'Shadowrocket',
  raw: 'Raw URI lines',
}

const FORMAT_OPTIONS: { value: SourceFormat; label: string }[] = SOURCE_FORMATS.map(value => ({
  value,
  label: SOURCE_FORMAT_LABELS[value],
}))

const USER_AGENT_OPTIONS = [
  { value: '', label: 'Default (clash.meta)' },
  { value: 'clash.meta/v1.19.23', label: 'Clash Meta (Recommended)' },
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
  { value: 'custom', label: 'Custom...' },
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
  const {
    sources,
    loading,
    refreshResults,
    refreshErrors,
    fetchSources,
    addSource,
    updateSource,
    deleteSource,
    refreshSource,
  } = useSourcesStore()
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingSource, setEditingSource] = useState<ProxySource | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    url: '',
    format: 'auto' as SourceFormat,
    updateInterval: 0,
    userAgent: '',
    customUserAgent: '',
    notes: '',
    refreshAfterCreate: true
  })
  const [formError, setFormError] = useState('')

  useEffect(() => { void fetchSources() }, [fetchSources])

  const handleAdd = async () => {
    const urls = parseSubscriptionUrls(form.url)
    if (urls.length === 0) { setFormError(t('sources.url_required')); return }
    setFormError('')
    // When userAgent is empty string (Default), send undefined to use backend default
    // When userAgent is 'custom', use customUserAgent
    // Otherwise use the selected preset
    const finalUserAgent = form.userAgent === 'custom'
      ? form.customUserAgent
      : (form.userAgent || undefined)
    const failedUrls: string[] = []
    for (const url of urls) {
      try {
        await addSource({
          name: urls.length === 1 ? form.name.trim() || undefined : undefined,
          type: 'url',
          url,
          format: form.format,
          enabled: true,
          tags: [],
          updateInterval: form.updateInterval,
          userAgent: finalUserAgent,
          notes: form.notes,
          refreshAfterCreate: form.refreshAfterCreate,
        })
      } catch {
        failedUrls.push(url)
      }
    }
    if (failedUrls.length > 0) {
      setForm(f => ({ ...f, url: failedUrls.join('\n') }))
      setFormError(`${failedUrls.length} 个订阅源保存失败，请检查后重试`)
      return
    }
    setShowAddModal(false)
    setForm({ name: '', url: '', format: 'auto', updateInterval: 0, userAgent: '', customUserAgent: '', notes: '', refreshAfterCreate: true })
  }

  const handleRefresh = async (id: string) => {
    setRefreshingId(id)
    try {
      await refreshSource(id)
    } catch {
      // Error is stored and displayed on the source card.
    } finally {
      setRefreshingId(null)
    }
  }

  const handleToggle = (source: ProxySource) => {
    void updateSource(source.id, { enabled: !source.enabled })
  }

  const handleEdit = (source: ProxySource) => {
    setEditingSource(source)
    // Parse userAgent to determine if it's custom
    const isPreset = USER_AGENT_OPTIONS.some(opt => opt.value === source.userAgent)
    setForm({
      name: source.name,
      url: source.url || '',
      format: source.format,
      updateInterval: source.updateInterval || 0,
      userAgent: isPreset ? (source.userAgent || '') : (source.userAgent ? 'custom' : ''),
      customUserAgent: isPreset ? '' : (source.userAgent || ''),
      notes: source.notes || '',
      refreshAfterCreate: false,
    })
    setShowEditModal(true)
  }

  const handleUpdate = async () => {
    if (!editingSource) return
    if (!form.url) { setFormError(t('sources.url_required')); return }
    setFormError('')
    // When userAgent is empty string (Default), explicitly pass empty string to clear it
    // When userAgent is 'custom', use customUserAgent
    // Otherwise use the selected preset
    const finalUserAgent = form.userAgent === 'custom'
      ? form.customUserAgent
      : form.userAgent
    const update = {
      name: form.name,
      url: form.url,
      format: form.format,
      updateInterval: form.updateInterval,
      userAgent: finalUserAgent || undefined,
      notes: form.notes,
    }
    const shouldRefreshAfterUpdate = shouldRefreshSourceAfterUpdate(editingSource, update)
    await updateSource(editingSource.id, update)
    if (shouldRefreshAfterUpdate) {
      await handleRefresh(editingSource.id)
    }
    setShowEditModal(false)
    setEditingSource(null)
    setForm({ name: '', url: '', format: 'auto', updateInterval: 0, userAgent: '', customUserAgent: '', notes: '', refreshAfterCreate: true })
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('sources.title')}
        actions={
          <Button onClick={() => setShowAddModal(true)} icon={<PlusIcon />}>
            {t('sources.add_url')}
          </Button>
        }
      />

      {loading && sources.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<SubscriptionIcon />}
          title={t('sources.empty_title')}
          description={t('sources.empty_description')}
          action={{ label: t('sources.add_url'), onClick: () => setShowAddModal(true) }}
        />
      ) : (
        <div className={styles.grid}>
          {sources.map(source => (
            <Card key={source.id} className={styles.sourceCard}>
              <div className={styles.cardHeader}>
                <div className={styles.titleRow}>
                  <button
                    className={`${styles.toggleBtn} ${source.enabled ? styles.enabled : styles.disabled}`}
                    onClick={() => handleToggle(source)}
                    title={source.enabled ? t('common.disable') : t('common.enable')}
                  />
                  <div className={styles.cardTitle}>{source.name}</div>
                </div>
                <div className={styles.cardActions}>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => handleEdit(source)}
                    title={t('common.edit')}
                  >
                    <EditIcon />
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    loading={refreshingId === source.id}
                    onClick={() => handleRefresh(source.id)}
                    title={t('sources.refresh_now')}
                  >
                    <RefreshIcon />
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => { if (confirm(t('sources.delete_confirm'))) void deleteSource(source.id) }}
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
              </div>
              <div className={styles.cardUrl}>{source.url}</div>
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
                      流量: <strong>{formatBytes((source.downloadBytes || 0) + (source.uploadBytes || 0))} / {formatBytes(source.totalBytes)}</strong>
                    </span>
                  )}
                  {source.expireTime !== undefined && (
                    <span>
                      到期: <strong>{new Date(source.expireTime * 1000).toLocaleDateString()}</strong>
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
              {(refreshErrors[source.id] || source.lastRefreshError) && (
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
        onOpenChange={setShowAddModal}
        title={t('sources.add_url')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAddModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void handleAdd()}>{t('sources.save_and_generate')}</Button>
          </>
        }
      >
        {formError && <div className={styles.formError}>{formError}</div>}
        <div className={styles.quickHint}>
          <div className={styles.quickHintTitle}>{t('sources.quick_hint_title')}</div>
          <div className={styles.quickHintText}>{t('sources.quick_hint_text')}</div>
        </div>
        <label className={styles.textareaField}>
          <span>{t('sources.url')}</span>
          <textarea
            className={styles.textarea}
            value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder={'https://example.com/sub?token=...\nhttps://example.org/sub?token=...'}
          />
        </label>
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={form.refreshAfterCreate}
            onChange={e => setForm(f => ({ ...f, refreshAfterCreate: e.target.checked }))}
          />
          <span>{t('sources.refresh_now')}</span>
        </label>
        <details className={styles.advanced}>
          <summary>{t('sources.advanced_options')}</summary>
          <div className={styles.advancedBody}>
            <Input
              label={t('sources.name_optional')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t('sources.name_auto_placeholder')}
            />
            <div>
              <label className={styles.selectLabel}>{t('sources.format')}</label>
              <select
                className={styles.select}
                value={form.format}
                onChange={e => setForm(f => ({ ...f, format: e.target.value as SourceFormat }))}
              >
                {FORMAT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
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
              <label className={styles.selectLabel}>User-Agent</label>
              <select
                className={styles.select}
                value={form.userAgent}
                onChange={e => setForm(f => ({ ...f, userAgent: e.target.value }))}
              >
                {USER_AGENT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {form.userAgent === 'custom' && (
              <Input
                label="Custom User-Agent"
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
        onOpenChange={setShowEditModal}
        title={t('common.edit') + ' - ' + editingSource?.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void handleUpdate()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError && <div className={styles.formError}>{formError}</div>}
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
          placeholder="https://example.com/sub?token=..."
        />
        <div>
          <label className={styles.selectLabel}>{t('sources.format')}</label>
          <select
            className={styles.select}
            value={form.format}
            onChange={e => setForm(f => ({ ...f, format: e.target.value as SourceFormat }))}
          >
            {FORMAT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
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
          <label className={styles.selectLabel}>User-Agent</label>
          <select
            className={styles.select}
            value={form.userAgent}
            onChange={e => setForm(f => ({ ...f, userAgent: e.target.value }))}
          >
            {USER_AGENT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className={styles.helperText}>
            Some airports check User-Agent. Recommended: clash.meta (works with most airports).
          </div>
        </div>
        {form.userAgent === 'custom' && (
          <Input
            label="Custom User-Agent"
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
    </div>
  )
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
