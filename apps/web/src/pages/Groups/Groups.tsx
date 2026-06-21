import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { api } from '@/lib/api'
import { useGroupsStore } from '@/store/groups.store'
import { ROUTING_POLICY_TEMPLATES, buildRoutingPolicyTemplateGroupNames } from '@uni-conf/shared'
import type { GroupType, ProxyGroup, RoutingPolicyTemplateId } from '@uni-conf/types'
import styles from './Groups.module.css'

type GroupForm = Omit<ProxyGroup, 'id' | 'createdAt' | 'updatedAt'>

const GROUP_TYPES: GroupType[] = ['select', 'url-test', 'fallback', 'load-balance', 'direct', 'reject']
const GROUP_TYPE_COLORS: Record<string, 'purple' | 'info' | 'success' | 'warning' | 'error' | 'default'> = {
  select: 'purple',
  'url-test': 'info',
  fallback: 'warning',
  'load-balance': 'success',
  direct: 'default',
  reject: 'error',
}

function createEmptyForm(order: number): GroupForm {
  return {
    name: '',
    type: 'select',
    collectionIds: [],
    groupIds: [],
    builtins: [],
    testUrl: 'http://www.gstatic.com/generate_204',
    interval: 300,
    tolerance: 150,
    lazy: true,
    enabled: true,
    order,
    isBuiltin: false,
  }
}

export function Groups() {
  const { t } = useTranslation()
  const { groups, loading, fetchGroups, addGroup, updateGroup, deleteGroup, reorderGroups } = useGroupsStore()
  const [showModal, setShowModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ProxyGroup | null>(null)
  const [form, setForm] = useState<GroupForm>(() => createEmptyForm(0))
  const [formError, setFormError] = useState('')
  const [activeTemplate, setActiveTemplate] = useState<RoutingPolicyTemplateId>('common')
  const [savingTemplate, setSavingTemplate] = useState(false)

  useEffect(() => {
    void fetchGroups()
    void api.settings.get().then(settings => setActiveTemplate(settings.routingPolicyTemplate))
  }, [fetchGroups])

  const visibleGroups = useMemo(
    () => groups.filter(group => (isRoutingPolicyGroup(group) && group.enabled) || isCustomRoutingGroup(group)),
    [groups]
  )
  const activeTemplateConfig = ROUTING_POLICY_TEMPLATES.find(template => template.id === activeTemplate)
    ?? ROUTING_POLICY_TEMPLATES.find(template => template.id === 'common')
    ?? ROUTING_POLICY_TEMPLATES[0]
  const activeTemplateGroupNames = useMemo(
    () => buildRoutingPolicyTemplateGroupNames(activeTemplateConfig),
    [activeTemplateConfig]
  )
  const templateGroups = useMemo(
    () => activeTemplateGroupNames.map(name => ({
      name,
      group: groups.find(group => group.name === name),
    })),
    [activeTemplateGroupNames, groups]
  )
  const templateOptions = useMemo(
    () => ROUTING_POLICY_TEMPLATES.map(template => ({
      ...template,
      active: template.id === activeTemplate,
      displayGroupNames: buildRoutingPolicyTemplateGroupNames(template),
    })),
    [activeTemplate]
  )
  const groupOptions = useMemo(
    () => groups
      .filter(group => group.id !== editingGroup?.id)
      .map(group => ({ id: group.id, label: group.name })),
    [editingGroup?.id, groups]
  )

  const openCreate = () => {
    setEditingGroup(null)
    setForm(createEmptyForm(visibleGroups.length))
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (group: ProxyGroup) => {
    setEditingGroup(group)
    setForm({
      name: group.name,
      type: group.type,
      collectionIds: group.collectionIds,
      groupIds: group.groupIds,
      builtins: group.builtins,
      testUrl: group.testUrl ?? 'http://www.gstatic.com/generate_204',
      interval: group.interval ?? 300,
      tolerance: group.tolerance ?? 150,
      lazy: group.lazy ?? true,
      enabled: group.enabled,
      order: group.order,
      isBuiltin: group.isBuiltin,
    })
    setFormError('')
    setShowModal(true)
  }

  const handleSave = async () => {
    const payload: GroupForm = {
      ...form,
      name: form.name.trim(),
      testUrl: form.testUrl?.trim() || undefined,
      interval: Number(form.interval) || 300,
      tolerance: Number(form.tolerance) || 150,
    }

    if (!payload.name) {
      setFormError('name is required')
      return
    }

    if (editingGroup) {
      await updateGroup(editingGroup.id, payload)
    } else {
      await addGroup(payload)
    }

    setShowModal(false)
    setEditingGroup(null)
    setForm(createEmptyForm(visibleGroups.length))
  }

  const handleTemplateChange = async (templateId: RoutingPolicyTemplateId) => {
    setSavingTemplate(true)
    try {
      const updated = await api.settings.update({ routingPolicyTemplate: templateId })
      setActiveTemplate(updated.routingPolicyTemplate)
      await fetchGroups()
    } finally {
      setSavingTemplate(false)
    }
  }

  const moveGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= visibleGroups.length) return
    const movedGroup = visibleGroups[index]
    const targetGroup = visibleGroups[target]
    if (!movedGroup || !targetGroup) return

    const orderedVisible = [...visibleGroups]
    const [item] = orderedVisible.splice(index, 1)
    if (!item) return
    orderedVisible.splice(target, 0, item)

    const visibleIds = new Set(visibleGroups.map(group => group.id))
    const visibleQueue = [...orderedVisible]
    const ordered = groups.map(group => visibleIds.has(group.id) ? visibleQueue.shift()! : group)
    void reorderGroups(ordered.map(group => group.id))
  }

  const typeLabel = (type: string) => ({
    select: t('groups.type_select'),
    'url-test': t('groups.type_url_test'),
    fallback: t('groups.type_fallback'),
    'load-balance': t('groups.type_load_balance'),
    direct: t('groups.type_direct'),
    reject: t('groups.type_reject'),
  }[type] ?? type)

  const getGroupNames = (ids: string[]) => ids
    .map(id => groups.find(group => group.id === id)?.name ?? id)
    .join(', ')

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('groups.title')}
        description="先选择一套策略组组合，再按需添加自定义策略组；默认规则会自动关联到组合里的策略组。"
        actions={<Button onClick={openCreate} icon={<PlusIcon />}>添加自定义策略组</Button>}
      />
      <section className={styles.templatePanel}>
        <div className={styles.templateHeader}>
          <div>
            <div className={styles.templateTitle}>策略组组合</div>
            <div className={styles.templateMeta}>选择一个默认组合后，系统会维护对应策略组和默认规则关联；自定义策略组会保留。</div>
          </div>
          <Button variant="secondary" onClick={() => void fetchGroups()} loading={savingTemplate}>{t('common.refresh')}</Button>
        </div>
        <div className={styles.templateGrid}>
          {templateOptions.map(template => (
            <button
              key={template.id}
              type="button"
              className={`${styles.templateItem} ${template.active ? styles.templateItemActive : ''}`}
              onClick={() => void handleTemplateChange(template.id)}
              disabled={savingTemplate}
            >
              <div className={styles.templateItemTop}>
                <span className={styles.templateName}>{template.name}</span>
                <Badge variant={template.active ? 'success' : 'default'}>{template.active ? '当前' : `${template.displayGroupNames.length} 组`}</Badge>
              </div>
              <div className={styles.templateDesc}>{template.description}</div>
              <div className={styles.templateMembers}>{template.displayGroupNames.join(' / ')}</div>
            </button>
          ))}
        </div>
        <div className={styles.activeTemplateGroups}>
          {(templateGroups ?? []).map(item => (
            <Badge key={item.name} variant={item.group?.enabled ? 'purple' : 'default'}>
              {item.name}
            </Badge>
          ))}
        </div>
      </section>
      {loading && visibleGroups.length === 0 ? <div className={styles.loading}>{t('common.loading')}</div> : (
        <div className={styles.list}>
          {visibleGroups.map((group, index) => (
            <Card key={group.id} className={styles.groupCard}>
              <div className={styles.orderControls}>
                <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveGroup(index, -1)} title="上移">
                  <ArrowUpIcon />
                </Button>
                <Button variant="ghost" size="sm" disabled={index === visibleGroups.length - 1} onClick={() => moveGroup(index, 1)} title="下移">
                  <ArrowDownIcon />
                </Button>
              </div>
              <div className={styles.cardMain}>
                <div className={styles.cardTop}>
                  <div className={styles.groupName}>{group.name}</div>
                  <Badge variant={group.enabled ? 'success' : 'default'}>
                    {group.enabled ? t('common.enabled') : t('common.disabled')}
                  </Badge>
                </div>
                <div className={styles.groupMeta}>
                  <Badge variant={GROUP_TYPE_COLORS[group.type] ?? 'default'}>{typeLabel(group.type)}</Badge>
                  {group.isBuiltin && <Badge variant="default">{t('groups.builtin_label')}</Badge>}
                  {group.groupIds.length > 0 && <Badge variant="purple">{group.groupIds.length} 嵌套</Badge>}
                  {group.builtins.length > 0 && <Badge variant="warning">{group.builtins.join(' / ')}</Badge>}
                </div>
                <div className={styles.summary}>
                  {group.groupIds.length > 0 ? getGroupNames(group.groupIds) : t('groups.no_collections')}
                </div>
              </div>
              <div className={styles.cardActions}>
                <Button variant="ghost" size="sm" onClick={() => void updateGroup(group.id, { enabled: !group.enabled })}>
                  {group.enabled ? t('common.disable') : t('common.enable')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(group)}>
                  {t('common.edit')}
                </Button>
                {!group.isBuiltin && (
                  <Button variant="ghost" size="sm" onClick={() => { if (confirm('删除此策略组？')) void deleteGroup(group.id) }}>
                    <TrashIcon />
                  </Button>
                )}
              </div>
            </Card>
          ))}
          {visibleGroups.length === 0 && <EmptyState title="暂无自定义策略组" description="默认策略模板会自动生成；这里只需要添加额外业务策略。" action={{ label: '添加自定义策略组', onClick: openCreate }} />}
        </div>
      )}

      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editingGroup ? t('common.edit') : t('groups.new')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void handleSave()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError && <div className={styles.formError}>{formError}</div>}
        <div className={styles.formGrid}>
          <Input label={t('common.name')} value={form.name} onChange={e => setFormValue('name', e.target.value, setForm)} placeholder="My Proxy Group" />
          <div>
            <label className={styles.selectLabel}>{t('common.type')}</label>
            <select className={styles.select} value={form.type} onChange={e => setFormValue('type', e.target.value as GroupType, setForm)}>
              {GROUP_TYPES.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}
            </select>
          </div>
          <Input label={t('groups.test_url')} value={form.testUrl ?? ''} onChange={e => setFormValue('testUrl', e.target.value, setForm)} />
          <Input label={t('groups.interval')} type="number" min="1" value={form.interval ?? 300} onChange={e => setFormValue('interval', Number(e.target.value), setForm)} />
          <Input label={t('groups.tolerance')} type="number" min="0" value={form.tolerance ?? 150} onChange={e => setFormValue('tolerance', Number(e.target.value), setForm)} />
        </div>

        <div className={styles.toggleGrid}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.enabled} onChange={e => setFormValue('enabled', e.target.checked, setForm)} />
            <span>{t('common.enabled')}</span>
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.lazy ?? true} onChange={e => setFormValue('lazy', e.target.checked, setForm)} />
            <span>{t('groups.lazy')}</span>
          </label>
        </div>

        <MultiSelect
          label={t('groups.nested_groups')}
          emptyText="不嵌套其他策略组"
          options={groupOptions}
          value={form.groupIds}
          onChange={groupIds => setForm(current => ({ ...current, groupIds }))}
        />

        <BuiltinsSelector
          value={form.builtins}
          onChange={builtins => setForm(current => ({ ...current, builtins }))}
        />
      </Modal>
    </div>
  )
}

function MultiSelect({ label, emptyText, options, value, onChange }: {
  label: string
  emptyText: string
  options: Array<{ id: string; label: string }>
  value: string[]
  onChange: (value: string[]) => void
}) {
  const selected = new Set(value)
  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter(item => item !== id) : [...value, id])
  }

  return (
    <div className={styles.selector}>
      <div className={styles.selectorHeader}>
        <span className={styles.selectLabel}>{label}</span>
        {value.length > 0 && <button type="button" className={styles.clearButton} onClick={() => onChange([])}>清空</button>}
      </div>
      {options.length === 0 ? (
        <div className={styles.selectorEmpty}>暂无可选项</div>
      ) : (
        <div className={styles.optionList}>
          <label className={styles.optionItem}>
            <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} />
            <span>{emptyText}</span>
          </label>
          {options.map(option => (
            <label key={option.id} className={styles.optionItem}>
              <input type="checkbox" checked={selected.has(option.id)} onChange={() => toggle(option.id)} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function BuiltinsSelector({ value, onChange }: {
  value: ProxyGroup['builtins']
  onChange: (value: ProxyGroup['builtins']) => void
}) {
  const selected = new Set(value)
  const toggle = (item: ProxyGroup['builtins'][number]) => {
    onChange(selected.has(item) ? value.filter(current => current !== item) : [...value, item])
  }

  return (
    <div className={styles.selector}>
      <span className={styles.selectLabel}>内置出口</span>
      <div className={styles.optionListCompact}>
        {(['DIRECT', 'REJECT'] as const).map(item => (
          <label key={item} className={styles.optionItem}>
            <input type="checkbox" checked={selected.has(item)} onChange={() => toggle(item)} />
            <span>{item}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function setFormValue<K extends keyof GroupForm>(
  key: K,
  value: GroupForm[K],
  setForm: React.Dispatch<React.SetStateAction<GroupForm>>
) {
  setForm(current => ({ ...current, [key]: value }))
}

function isOutletGroup(group: ProxyGroup): boolean {
  return !group.isBuiltin && group.collectionIds.length > 0
}

function isDefaultOutletGroup(group: ProxyGroup): boolean {
  return [
    'builtin-direct',
    'builtin-reject',
    'builtin-all-nodes',
    'builtin-node-select',
    'builtin-auto-select',
    'builtin-fallback-select',
  ].includes(group.id)
}

function isRoutingPolicyGroup(group: ProxyGroup): boolean {
  return group.isBuiltin && !isDefaultOutletGroup(group) && !['direct', 'reject'].includes(group.type)
}

function isCustomRoutingGroup(group: ProxyGroup): boolean {
  return !group.isBuiltin && !isOutletGroup(group)
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}

function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
}

function ArrowUpIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
}

function ArrowDownIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
}
