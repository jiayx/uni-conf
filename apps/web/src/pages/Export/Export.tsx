import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { api } from '@/lib/api'
import { EXPORT_FORMAT_OPTIONS } from '@/core/export/formats'
import { describeCompatibleRuleSetFormats, isRemoteRuleSetCompatible } from '@/core/remote-rules/compatibility'
import { getExportSubscriptionFilename } from '@uni-conf/shared'
import type { ExportConfig, ExportFormat, NodeCollection, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types'
import styles from './Export.module.css'

const BASE_URL = window.location.origin

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
      name: form.name.trim() || undefined,
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
    if (!confirm('删除此导出配置？')) return
    await api.export.deleteConfig(id)
    await load()
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

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('export.title')}
        actions={<Button onClick={openCreate} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>{t('export.new_config')}</Button>}
      />
      {loading ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : configs.length === 0 ? (
        <EmptyState title="暂无导出配置" description="创建导出配置以生成订阅链接" action={{ label: t('export.new_config'), onClick: () => setShowModal(true) }} />
      ) : (
        <div className={styles.list}>
          {configs.map(cfg => {
            const filename = getExportSubscriptionFilename(cfg.format)
            const subUrl = `${BASE_URL}/sub/${cfg.token}/${filename}`
            const scopeText = scopeSummary(cfg, collections, groups, rules, remoteSets)
            return (
              <Card key={cfg.id} className={styles.configCard}>
                <div className={styles.configHeader}>
                  <div>
                    <div className={styles.configName}>{cfg.name}</div>
                    <div className={styles.badges}>
                      <Badge variant="purple">{cfg.format.toUpperCase()}</Badge>
                      <Badge variant={cfg.enabled ? 'success' : 'default'}>{cfg.enabled ? '启用' : '停用'}</Badge>
                    </div>
                    <div className={styles.scopeText}>{scopeText}</div>
                  </div>
                  <div className={styles.configActions}>
                    <Button variant="secondary" size="sm" onClick={() => openEdit(cfg)}>
                      编辑
                    </Button>
                    <Button
                      variant="secondary" size="sm"
                      onClick={() => window.open(`/api/export/download/${cfg.format}?configId=${cfg.id}`, '_blank')}
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
              </Card>
            )
          })}
        </div>
      )}
      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editingId ? '编辑导出配置' : t('export.new_config')}
        footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button><Button onClick={() => void handleSave()}>{t('common.save')}</Button></>}
      >
        <Input label="名称（可选）" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="留空时使用默认导出名称" />
        <div>
          <label className={styles.selectLabel}>{t('export.format')}</label>
          <select className={styles.select} value={form.format} onChange={e => handleFormatChange(e.target.value as ExportFormat)}>
            {EXPORT_FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          <span>启用此配置</span>
        </label>
        <details className={styles.advanced}>
          <summary>高级范围设置</summary>
          <div className={styles.advancedBody}>
            <MultiSelect
              label="节点组"
              emptyText="未选择时导出所有启用节点组"
              options={collections.map(item => ({ id: item.id, label: item.name }))}
              value={form.includeCollectionIds}
              onChange={includeCollectionIds => setForm(f => ({ ...f, includeCollectionIds }))}
            />
            <MultiSelect
              label="策略组"
              emptyText="未选择时导出所有启用策略组"
              options={groups.map(item => ({ id: item.id, label: item.name }))}
              value={form.includeGroupIds}
              onChange={includeGroupIds => setForm(f => ({ ...f, includeGroupIds }))}
            />
            <MultiSelect
              label="自定义分流规则"
              emptyText="未选择时导出所有启用自定义规则"
              options={rules.map(item => ({ id: item.id, label: `${item.type}, ${item.payload}` }))}
              value={form.includeRuleIds}
              onChange={includeRuleIds => setForm(f => ({ ...f, includeRuleIds }))}
            />
            <MultiSelect
              label="分流策略规则集"
              emptyText="未选择时导出所有兼容规则集"
              hint={`当前 ${form.format} 可使用：${describeCompatibleRuleSetFormats(form.format)}`}
              options={remoteSets.map(item => {
                const compatible = isRemoteRuleSetCompatible(form.format, item)
                const formatLabel = item.presetSource === 'quixotic'
                  ? '预置 · 动态格式'
                  : item.presetSource === 'uni-conf'
                    ? `内置 · ${item.format}`
                    : item.format
                return {
                  id: item.id,
                  label: item.name,
                  description: compatible
                    ? `${formatLabel} · 会用于 ${form.format} 导出`
                    : `${formatLabel} · 不兼容 ${form.format}，导出时会跳过`,
                  disabled: !compatible,
                }
              })}
              value={form.includeRemoteSetIds}
              onChange={includeRemoteSetIds => setForm(f => ({ ...f, includeRemoteSetIds }))}
            />
          </div>
        </details>
      </Modal>
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
            全部
          </button>
        )}
      </div>
      {hint && <div className={styles.selectorHint}>{hint}</div>}
      {options.length === 0 ? (
        <div className={styles.selectorEmpty}>暂无可选项</div>
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

function scopeSummary(
  config: ExportConfig,
  collections: NodeCollection[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[]
): string {
  return [
    summaryPart('节点组', config.includeCollectionIds, collections.length),
    summaryPart('组', config.includeGroupIds, groups.length),
    summaryPart('自定义规则', config.includeRuleIds, rules.length),
    summaryPart('分流规则集', config.includeRemoteSetIds, remoteSets.length),
  ].join(' / ')
}

function summaryPart(label: string, ids: string[], total: number): string {
  return ids.length === 0 ? `${label}: 全部 ${total}` : `${label}: ${ids.length}/${total}`
}
