import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Badge } from '@/components/ui/Badge/Badge'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { Input } from '@/components/ui/Input/Input'
import { Modal } from '@/components/ui/Modal/Modal'
import { isRuleTargetGroup } from '@/core/groups/rule-target-groups'
import {
  buildQuixoticRuleSetUrl,
  inferQuixoticTargetGroup,
  QUIXOTIC_RULE_SET_PRESETS,
  RULE_SET_FORMAT_OPTIONS,
  resolveQuixoticRuleSetSortOrder,
  type QuixoticRuleSetPreset,
} from '@/core/remote-rules/quixotic-presets'
import { api } from '@/lib/api'
import { useGroupsStore } from '@/store/groups.store'
import type { RemoteRuleSet, RuleSetBehavior, RuleSetFormat } from '@uni-conf/types'
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

const RULE_SET_BEHAVIOR_OPTIONS: Array<{ value: RuleSetBehavior; label: string }> = [
  { value: 'domain', label: '域名' },
  { value: 'ipcidr', label: 'IP CIDR' },
  { value: 'classical', label: 'Mihomo classical' },
]

function createEmptyForm(targetGroupId = ''): RemoteSetForm {
  return {
    name: '',
    url: '',
    format: 'text',
    behavior: 'domain',
    targetGroupId,
    updateInterval: 24,
    enabled: true,
    sortOrder: 500,
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

  const ruleTargetGroups = groups.filter(isRuleTargetGroup)
  const enabledGroups = ruleTargetGroups.filter(group => group.enabled)
  const targetGroups = enabledGroups.length > 0 ? enabledGroups : ruleTargetGroups
  const defaultTargetGroupId = targetGroups.find(group => group.name === 'PROXY')?.id ?? targetGroups[0]?.id ?? ''
  const presetsByCategory = groupPresetsByCategory(QUIXOTIC_RULE_SET_PRESETS)
  const setsByTargetGroup = useMemo(() => groupSetsByTargetGroup(sets, groups), [groups, sets])
  const selectedFormatOption = RULE_SET_FORMAT_OPTIONS.find(item => item.value === form.format)
  const editingPresetId = editingSet?.presetSource === 'quixotic' ? editingSet.presetId : undefined
  const formPresetId = (form.presetId ?? selectedPresetId) || editingPresetId

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

  const openCreate = (targetGroupId = defaultTargetGroupId) => {
    setEditingSet(null)
    setForm(createEmptyForm(targetGroupId))
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
      behavior: set.behavior,
      targetGroupId: set.targetGroupId,
      updateInterval: set.updateInterval,
      enabled: set.enabled,
      sortOrder: set.sortOrder,
      lastUpdated: set.lastUpdated,
      notes: set.notes ?? '',
      presetSource: set.presetSource,
      presetId: set.presetId,
    })
    setSelectedPresetId(set.presetSource === 'quixotic' ? set.presetId ?? '' : '')
    setFormError('')
    setShowModal(true)
  }

  const findSuggestedGroupId = (preset: QuixoticRuleSetPreset): string => {
    const wanted = inferQuixoticTargetGroup(preset).toUpperCase()
    return targetGroups.find(group => group.name.toUpperCase() === wanted)?.id ?? defaultTargetGroupId
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
      behavior: 'classical',
      presetSource: 'quixotic',
      presetId: preset.id,
      targetGroupId: findSuggestedGroupId(preset),
      updateInterval: 24,
      enabled: true,
      sortOrder: resolveQuixoticRuleSetSortOrder(preset.id),
      notes: `QuixoticHeart/rule-set:${preset.id} ${preset.description}`,
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
    const formPayload: RemoteSetForm = {
      ...form,
      name: form.name.trim(),
      url: form.url.trim(),
      notes: form.notes?.trim() || undefined,
      updateInterval: Number(form.updateInterval) || 24,
      sortOrder: Number(form.sortOrder) || 500,
    }
    const { presetSource: _presetSource, presetId: _presetId, ...payload } = formPayload

    if (!payload.name || !payload.url || !payload.targetGroupId) {
      setFormError('名称、规则集来源和匹配后使用的策略组必填')
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
    if (!confirm(`删除规则集 ${set.name}?`)) return
    await api.remoteRuleSets.remove(set.id)
    setSets(current => current.filter(item => item.id !== set.id))
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="分流策略"
        description={`${setsByTargetGroup.length} 个策略，${sets.length} 个规则集`}
        actions={
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => void loadSets()} loading={loading}>{t('common.refresh')}</Button>
            <Button onClick={() => openCreate()} icon={<PlusIcon />}>添加补充规则集</Button>
          </div>
        }
      />

      {error && <div className={styles.error}>{error}</div>}

      {loading && sets.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : sets.length === 0 ? (
        <EmptyState title="暂无分流策略" description="默认分流策略会由系统自动生成；这里通常只需要添加补充规则集。" action={{ label: '添加补充规则集', onClick: () => openCreate() }} />
      ) : (
        <div className={styles.groupedList}>
          {setsByTargetGroup.map(section => (
            <section key={section.groupId} className={styles.ruleSetSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <div className={styles.sectionKicker}>匹配后使用</div>
                  <div className={styles.sectionTitle}>{section.groupName}</div>
                  <div className={styles.sectionMeta}>
                    {section.sets.length} 个匹配规则集，{section.sets.filter(set => set.enabled).length} 个启用
                  </div>
                </div>
                <div className={styles.sectionActions}>
                  <Badge variant="purple">策略组</Badge>
                  <Button variant="secondary" size="sm" onClick={() => openCreate(section.groupId)}>添加补充规则集</Button>
                </div>
              </div>
              <div className={styles.grid}>
                {section.sets.map(set => (
                  <Card key={set.id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <label className={styles.enableSwitch}>
                        <input type="checkbox" checked={set.enabled} onChange={() => void handleToggle(set)} />
                        <span>{set.enabled ? t('common.enabled') : t('common.disabled')}</span>
                      </label>
                      <div className={styles.cardTitle}>{set.name}</div>
                    </div>
                    <div className={styles.meta}>
                      <Badge variant="info">{ruleSetBadgeLabel(set)}</Badge>
                      <Badge variant="default">{ruleSetBehaviorLabel(set.behavior)}</Badge>
                      <Badge variant="default">{set.updateInterval}h</Badge>
                    </div>
                    <div className={styles.url}>{set.url}</div>
                    {set.notes && <div className={styles.notes}>{set.notes}</div>}
                    <div className={styles.cardActions}>
                      {canEditRemoteRuleSet(set) ? (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(set)}>
                          {t('common.edit')}
                        </Button>
                      ) : (
                        <Badge variant="default">系统维护</Badge>
                      )}
                      {canEditRemoteRuleSet(set) && (
                        <Button variant="ghost" size="sm" onClick={() => void handleDelete(set)}>
                          <TrashIcon />
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editingSet ? '编辑补充规则集' : '添加补充规则集'}
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
            <label className={styles.label}>从规则集资源库添加</label>
            <select className={styles.select} value={selectedPresetId} onChange={e => applyPreset(e.target.value)}>
              <option value="">手动填写规则集 URL</option>
              {Object.entries(presetsByCategory).map(([category, presets]) => (
                <optgroup key={category} label={PRESET_CATEGORY_LABELS[category as QuixoticRuleSetPreset['category']] ?? category}>
                  {presets.map(preset => (
                    <option key={preset.id} value={preset.id}>{preset.name} - {preset.description}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className={styles.helperText}>
              选择预置后会自动填充匹配规则，并建议“匹配后使用”的策略组。
            </div>
          </div>
        )}
        <Input label={t('common.name')} value={form.name} onChange={e => setFormValue('name', e.target.value, setForm)} />
        {formPresetId ? (
          <div>
            <label className={styles.label}>规则集来源</label>
            <div className={styles.helperText}>已从 QuixoticHeart/rule-set:{formPresetId} 按当前格式填充 URL；保存后作为可删除的补充规则集。</div>
          </div>
        ) : (
          <>
            <Input label="URL" value={form.url} onChange={e => setFormValue('url', e.target.value, setForm)} />
            <div>
              <label className={styles.label}>规则集格式</label>
              <select className={styles.select} value={form.format} onChange={e => handleFormatChange(e.target.value as RuleSetFormat)}>
                {RULE_SET_FORMAT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {selectedFormatOption && (
                <div className={styles.helperText}>适用导出目标：{selectedFormatOption.exportTargets}</div>
              )}
            </div>
            <div>
              <label className={styles.label}>匹配内容</label>
              <select className={styles.select} value={form.behavior} onChange={e => setFormValue('behavior', e.target.value as RuleSetBehavior, setForm)}>
                {RULE_SET_BEHAVIOR_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <div className={styles.helperText}>用于 Mihomo rule-provider behavior；纯域名列表选“域名”，完整规则行选 classical。</div>
            </div>
          </>
        )}

        <div>
          <label className={styles.label}>匹配后使用</label>
          <select className={styles.select} value={form.targetGroupId} onChange={e => setFormValue('targetGroupId', e.target.value, setForm)}>
            <option value="">-- 选择策略组 --</option>
            {targetGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
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

function ruleSetBadgeLabel(set: Pick<RemoteRuleSet, 'format' | 'presetSource'>): string {
  if (set.presetSource === 'quixotic') return '预置'
  if (set.presetSource === 'uni-conf') return '内置'
  return set.format
}

function ruleSetBehaviorLabel(behavior: RuleSetBehavior): string {
  return RULE_SET_BEHAVIOR_OPTIONS.find(option => option.value === behavior)?.label ?? behavior
}

function canEditRemoteRuleSet(set: Pick<RemoteRuleSet, 'presetSource' | 'presetId'>): boolean {
  return !(set.presetSource && set.presetId)
}

function groupSetsByTargetGroup(sets: RemoteRuleSet[], groups: Array<{ id: string; name: string; order?: number }>) {
  const byId = new Map(groups.map(group => [group.id, group.name]))
  const orderById = new Map(groups.map((group, index) => [group.id, group.order ?? index]))
  const sections = new Map<string, { groupId: string; groupName: string; sets: RemoteRuleSet[] }>()

  for (const set of sets) {
    const groupId = set.targetGroupId
    const groupName = byId.get(groupId) ?? groupId
    const section = sections.get(groupId) ?? { groupId, groupName, sets: [] }
    section.sets.push(set)
    sections.set(groupId, section)
  }

  return [...sections.values()]
    .map(section => ({ ...section, sets: section.sets.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) }))
    .sort((a, b) => (orderById.get(a.groupId) ?? 9999) - (orderById.get(b.groupId) ?? 9999) || a.groupName.localeCompare(b.groupName))
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}

function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
}
