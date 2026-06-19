import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Badge } from '@/components/ui/Badge/Badge'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { Input } from '@/components/ui/Input/Input'
import { Modal } from '@/components/ui/Modal/Modal'
import {
  buildQuixoticRuleSetUrl,
  QUIXOTIC_RULE_SET_PRESETS,
  RULE_SET_FORMAT_OPTIONS,
  type QuixoticRuleSetPreset,
} from '@/core/remote-rules/quixotic-presets'
import { api } from '@/lib/api'
import { useGroupsStore } from '@/store/groups.store'
import type { RemoteRuleSet, RuleSetFormat } from '@uni-conf/types'
import styles from './RemoteRuleSets.module.css'

type RemoteSetForm = Omit<RemoteRuleSet, 'id' | 'createdAt' | 'updatedAt'>

const PRESET_CATEGORY_LABELS: Record<QuixoticRuleSetPreset['category'], string> = {
  ai: 'AI',
  streaming: 'Streaming',
  social: 'Social',
  china: 'China',
  apple: 'Apple',
  microsoft: 'Microsoft',
  google: 'Google',
  privacy: 'Privacy',
  gaming: 'Gaming',
  developer: 'Developer',
  general: 'General',
}

function createEmptyForm(targetGroupId = ''): RemoteSetForm {
  return {
    name: '',
    url: '',
    format: 'text',
    targetGroupId,
    updateInterval: 24,
    enabled: true,
    notes: '',
  }
}

export function RemoteRuleSets() {
  const { t } = useTranslation()
  const { groups, fetchGroups } = useGroupsStore()
  const [sets, setSets] = useState<RemoteRuleSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingSet, setEditingSet] = useState<RemoteRuleSet | null>(null)
  const [form, setForm] = useState<RemoteSetForm>(() => createEmptyForm())
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.remoteRuleSets.list()
      .then(result => { if (!cancelled) setSets(result) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    void fetchGroups()
    return () => { cancelled = true }
  }, [fetchGroups])

  const defaultTargetGroupId = groups.find(group => group.name === 'PROXY')?.id ?? groups[0]?.id ?? ''
  const presetsByCategory = groupPresetsByCategory(QUIXOTIC_RULE_SET_PRESETS)
  const selectedFormatOption = RULE_SET_FORMAT_OPTIONS.find(item => item.value === form.format)

  const loadSets = async () => {
    setLoading(true)
    setError('')
    try {
      setSets(await api.remoteRuleSets.list())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setEditingSet(null)
    setForm(createEmptyForm(defaultTargetGroupId))
    setSelectedPresetId('')
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (set: RemoteRuleSet) => {
    setEditingSet(set)
    setForm({
      name: set.name,
      url: set.url,
      format: set.format,
      targetGroupId: set.targetGroupId,
      updateInterval: set.updateInterval,
      enabled: set.enabled,
      lastUpdated: set.lastUpdated,
      notes: set.notes ?? '',
    })
    setSelectedPresetId('')
    setFormError('')
    setShowModal(true)
  }

  const findSuggestedGroupId = (preset: QuixoticRuleSetPreset): string => {
    const wanted = preset.suggestedGroup.toUpperCase()
    return groups.find(group => group.name.toUpperCase() === wanted)?.id ?? defaultTargetGroupId
  }

  const applyPreset = (presetId: string, format = form.format) => {
    setSelectedPresetId(presetId)
    const preset = QUIXOTIC_RULE_SET_PRESETS.find(item => item.id === presetId)
    if (!preset) return

    setForm(current => ({
      ...current,
      name: preset.name,
      url: buildQuixoticRuleSetUrl(preset.id, format),
      format,
      targetGroupId: findSuggestedGroupId(preset),
      updateInterval: 24,
      enabled: true,
      notes: `QuixoticHeart/rule-set: ${preset.description}`,
    }))
  }

  const handleFormatChange = (format: RuleSetFormat) => {
    if (selectedPresetId) {
      applyPreset(selectedPresetId, format)
      return
    }
    setFormValue('format', format, setForm)
  }

  const handleSave = async () => {
    const payload: RemoteSetForm = {
      ...form,
      name: form.name.trim(),
      url: form.url.trim(),
      notes: form.notes?.trim() || undefined,
      updateInterval: Number(form.updateInterval) || 24,
    }

    if (!payload.name || !payload.url || !payload.targetGroupId) {
      setFormError('name, url, and target group are required')
      return
    }

    if (editingSet) {
      const updated = await api.remoteRuleSets.update(editingSet.id, payload)
      setSets(current => current.map(item => (item.id === editingSet.id ? updated : item)))
    } else {
      const created = await api.remoteRuleSets.create(payload)
      setSets(current => [created, ...current])
    }

    setShowModal(false)
    setEditingSet(null)
  }

  const handleToggle = async (set: RemoteRuleSet) => {
    const updated = await api.remoteRuleSets.update(set.id, { enabled: !set.enabled })
    setSets(current => current.map(item => (item.id === set.id ? updated : item)))
  }

  const handleDelete = async (set: RemoteRuleSet) => {
    if (!confirm(`删除远程规则集 ${set.name}?`)) return
    await api.remoteRuleSets.remove(set.id)
    setSets(current => current.filter(item => item.id !== set.id))
  }

  const getGroupName = (id: string) => groups.find(group => group.id === id)?.name ?? id

  return (
    <div className={styles.page}>
      <PageHeader
        title="远程规则集"
        description={`${t('common.total', { count: sets.length })}`}
        actions={
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => void loadSets()} loading={loading}>{t('common.refresh')}</Button>
            <Button onClick={openCreate} icon={<PlusIcon />}>新增远程集</Button>
          </div>
        }
      />

      {error && <div className={styles.error}>{error}</div>}

      {loading && sets.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : sets.length === 0 ? (
        <EmptyState title="暂无远程规则集" description="远程规则集会在导出配置中生成 rule-provider 或 rule_set 引用" action={{ label: '新增远程集', onClick: openCreate }} />
      ) : (
        <div className={styles.grid}>
          {sets.map(set => (
            <Card key={set.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>{set.name}</div>
                <Badge variant={set.enabled ? 'success' : 'default'}>{set.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
              </div>
              <div className={styles.meta}>
                <Badge variant="info">{set.format}</Badge>
                <Badge variant="purple">{getGroupName(set.targetGroupId)}</Badge>
                <Badge variant="default">{set.updateInterval}h</Badge>
              </div>
              <div className={styles.url}>{set.url}</div>
              {set.notes && <div className={styles.notes}>{set.notes}</div>}
              <div className={styles.cardActions}>
                <Button variant="ghost" size="sm" onClick={() => void handleToggle(set)}>
                  {set.enabled ? t('common.disable') : t('common.enable')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(set)}>
                  {t('common.edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void handleDelete(set)}>
                  <TrashIcon />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editingSet ? t('common.edit') : '新增远程规则集'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void handleSave()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError && <div className={styles.formError}>{formError}</div>}
        {!editingSet && (
          <div className={styles.presetSection}>
            <label className={styles.label}>预置规则集</label>
            <select className={styles.select} value={selectedPresetId} onChange={e => applyPreset(e.target.value)}>
              <option value="">自定义远程规则集</option>
              {Object.entries(presetsByCategory).map(([category, presets]) => (
                <optgroup key={category} label={PRESET_CATEGORY_LABELS[category as QuixoticRuleSetPreset['category']] ?? category}>
                  {presets.map(preset => (
                    <option key={preset.id} value={preset.id}>{preset.name} - {preset.description}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className={styles.helperText}>
              来自 QuixoticHeart/rule-set，按所选格式自动生成规则集 URL。
            </div>
          </div>
        )}
        <Input label={t('common.name')} value={form.name} onChange={e => setFormValue('name', e.target.value, setForm)} />
        <Input label="URL" value={form.url} onChange={e => setFormValue('url', e.target.value, setForm)} />
        <div>
          <label className={styles.label}>{t('common.type')}</label>
          <select className={styles.select} value={form.format} onChange={e => handleFormatChange(e.target.value as RuleSetFormat)}>
            {RULE_SET_FORMAT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {selectedFormatOption && (
            <div className={styles.helperText}>适用导出目标：{selectedFormatOption.exportTargets}</div>
          )}
        </div>
        <div>
          <label className={styles.label}>{t('rules.target')}</label>
          <select className={styles.select} value={form.targetGroupId} onChange={e => setFormValue('targetGroupId', e.target.value, setForm)}>
            <option value="">-- {t('rules.target')} --</option>
            {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </div>
        <Input label="更新间隔（小时）" type="number" min="1" value={form.updateInterval} onChange={e => setFormValue('updateInterval', Number(e.target.value), setForm)} />
        <Input label={t('common.notes')} value={form.notes ?? ''} onChange={e => setFormValue('notes', e.target.value, setForm)} />
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={form.enabled} onChange={e => setFormValue('enabled', e.target.checked, setForm)} />
          <span>{t('common.enabled')}</span>
        </label>
      </Modal>
    </div>
  )
}

function setFormValue<K extends keyof RemoteSetForm>(
  key: K,
  value: RemoteSetForm[K],
  setForm: React.Dispatch<React.SetStateAction<RemoteSetForm>>
) {
  setForm(current => ({ ...current, [key]: value }))
}

function groupPresetsByCategory(presets: QuixoticRuleSetPreset[]) {
  return presets.reduce<Record<QuixoticRuleSetPreset['category'], QuixoticRuleSetPreset[]>>((acc, preset) => {
    acc[preset.category] = [...(acc[preset.category] ?? []), preset]
    return acc
  }, {} as Record<QuixoticRuleSetPreset['category'], QuixoticRuleSetPreset[]>)
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}

function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
}
