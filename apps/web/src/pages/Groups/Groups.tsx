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
import { useSettingsStore } from '@/store/settings.store'
import {
  DEFAULT_HEALTH_CHECK,
  GLOBAL_NODE_OUTLET_GROUP_NAMES,
  GLOBAL_NODE_OUTLET_GROUP_IDS,
  RULE_TARGET_FOUNDATION_GROUP_NAMES,
  ROUTING_POLICY_TEMPLATES,
  RULE_TARGET_FOUNDATION_GROUP_IDS,
} from '@uni-conf/shared'
import type { GroupType, ProxyGroup, RoutingPolicyTemplateId } from '@uni-conf/types'
import styles from './Groups.module.css'

type GroupForm = Omit<ProxyGroup, 'id' | 'createdAt' | 'updatedAt'>

const USER_GROUP_TYPES: GroupType[] = ['select', 'url-test', 'fallback', 'load-balance']
const GROUP_TYPE_COLORS: Record<string, 'purple' | 'info' | 'success' | 'warning' | 'error' | 'default'> = {
  select: 'purple',
  'url-test': 'info',
  fallback: 'warning',
  'load-balance': 'success',
  direct: 'default',
  reject: 'error',
}
const DEFAULT_OUTLET_GROUP_ID_SET = new Set<string>([
  ...RULE_TARGET_FOUNDATION_GROUP_IDS,
  ...GLOBAL_NODE_OUTLET_GROUP_IDS,
])

function createEmptyForm(order: number): GroupForm {
  return {
    name: '',
    type: 'select',
    collectionIds: [],
    groupIds: [],
    builtins: [],
    testUrl: DEFAULT_HEALTH_CHECK.testUrl,
    interval: DEFAULT_HEALTH_CHECK.interval,
    tolerance: DEFAULT_HEALTH_CHECK.tolerance,
    lazy: DEFAULT_HEALTH_CHECK.lazy,
    enabled: true,
    order,
    isBuiltin: false,
  }
}

export function Groups() {
  const { t } = useTranslation()
  const { groups, loading, fetchGroups, addGroup, updateGroup, deleteGroup, reorderGroups } = useGroupsStore()
  const applySettings = useSettingsStore(state => state.applySettings)
  const [showModal, setShowModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ProxyGroup | null>(null)
  const [form, setForm] = useState<GroupForm>(() => createEmptyForm(0))
  const [formError, setFormError] = useState('')
  const [activeTemplate, setActiveTemplate] = useState<RoutingPolicyTemplateId>('common')
  const [outletPreferences, setOutletPreferences] = useState<Record<string, string>>({})
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savingPreferenceId, setSavingPreferenceId] = useState<string | null>(null)

  useEffect(() => {
    void fetchGroups()
    void api.settings.get().then(settings => {
      setActiveTemplate(settings.routingPolicyTemplate)
      setOutletPreferences(settings.routingOutletPreferences ?? {})
    })
  }, [fetchGroups])

  const visibleGroups = useMemo(
    () => groups.filter(group => (isRoutingPolicyGroup(group) && group.enabled) || isCustomRoutingGroup(group)),
    [groups]
  )
  const customRoutingGroups = useMemo(
    () => visibleGroups.filter(isCustomRoutingGroup),
    [visibleGroups]
  )
  const foundationSections = useMemo(
    () => [
      {
        title: '规则基础目标',
        description: '规则可以直接命中，用于默认代理、直连和拒绝。',
        groups: RULE_TARGET_FOUNDATION_GROUP_IDS
          .map(id => groups.find(group => group.id === id))
          .filter((group): group is ProxyGroup => Boolean(group)),
      },
      {
        title: '全局节点出口',
        description: '作为业务分流组里的出口候选，不直接作为规则目标。',
        groups: GLOBAL_NODE_OUTLET_GROUP_IDS
          .map(id => groups.find(group => group.id === id))
          .filter((group): group is ProxyGroup => Boolean(group)),
      },
    ].filter(section => section.groups.length > 0),
    [groups]
  )
  const activeTemplateConfig = ROUTING_POLICY_TEMPLATES.find(template => template.id === activeTemplate)
    ?? ROUTING_POLICY_TEMPLATES.find(template => template.id === 'common')
    ?? ROUTING_POLICY_TEMPLATES[0]
  const templateGroups = useMemo(
    () => activeTemplateConfig.groupNames.map(name => ({
      name,
      group: groups.find(group => group.name === name),
    })),
    [activeTemplateConfig, groups]
  )
  const templateOptions = useMemo(
    () => ROUTING_POLICY_TEMPLATES.map(template => ({
      ...template,
      active: template.id === activeTemplate,
      displayGroupNames: template.groupNames,
    })),
    [activeTemplate]
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
      testUrl: group.testUrl ?? DEFAULT_HEALTH_CHECK.testUrl,
      interval: group.interval ?? DEFAULT_HEALTH_CHECK.interval,
      tolerance: group.tolerance ?? DEFAULT_HEALTH_CHECK.tolerance,
      lazy: group.lazy ?? DEFAULT_HEALTH_CHECK.lazy,
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
      collectionIds: [],
      groupIds: [],
      builtins: [],
      testUrl: form.testUrl?.trim() || undefined,
      interval: Number(form.interval) || DEFAULT_HEALTH_CHECK.interval,
      tolerance: Number(form.tolerance) || DEFAULT_HEALTH_CHECK.tolerance,
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
    const template = ROUTING_POLICY_TEMPLATES.find(item => item.id === templateId)
    setSavingTemplate(true)
    try {
      const updated = await api.settings.update({
        routingPolicyTemplate: templateId,
        dnsMode: template?.recommendedDnsMode,
      })
      applySettings(updated)
      setActiveTemplate(updated.routingPolicyTemplate)
      setOutletPreferences(updated.routingOutletPreferences ?? {})
      await fetchGroups()
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleOutletPreference = async (group: ProxyGroup, preferredOutletRef: string) => {
    const nextPreferences = { ...outletPreferences }
    if (preferredOutletRef) {
      nextPreferences[group.id] = preferredOutletRef
    } else {
      delete nextPreferences[group.id]
    }
    setSavingPreferenceId(group.id)
    try {
      const updated = await api.settings.update({ routingOutletPreferences: nextPreferences })
      applySettings(updated)
      setOutletPreferences(updated.routingOutletPreferences ?? {})
      await fetchGroups()
    } finally {
      setSavingPreferenceId(null)
    }
  }

  const moveCustomGroup = (groupId: string, direction: -1 | 1) => {
    const index = customRoutingGroups.findIndex(group => group.id === groupId)
    const target = index + direction
    if (target < 0 || target >= customRoutingGroups.length) return
    const movedGroup = customRoutingGroups[index]
    const targetGroup = customRoutingGroups[target]
    if (!movedGroup || !targetGroup) return

    const orderedCustom = [...customRoutingGroups]
    const [item] = orderedCustom.splice(index, 1)
    if (!item) return
    orderedCustom.splice(target, 0, item)

    const customIds = new Set(customRoutingGroups.map(group => group.id))
    const customQueue = [...orderedCustom]
    const ordered = groups.map(group => customIds.has(group.id) ? customQueue.shift()! : group)
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

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('groups.title')}
        description="先选择一套分流方案，再按需添加业务分流组；PROXY / DIRECT / REJECT 始终内置，默认规则会自动关联。"
        actions={<Button onClick={openCreate} icon={<PlusIcon />}>添加自定义策略组</Button>}
      />
      <section className={styles.templatePanel}>
        <div className={styles.templateHeader}>
          <div>
            <div className={styles.templateTitle}>默认分流方案</div>
            <div className={styles.templateMeta}>方案只决定额外启用哪些业务分流组；PROXY / DIRECT / REJECT 和节点选择能力始终保留。</div>
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
                <Badge variant={template.active ? 'success' : 'default'}>
                  {template.active ? '当前' : formatTemplateCount(template.displayGroupNames.length)}
                </Badge>
              </div>
              <div className={styles.templateDesc}>{template.description}</div>
              <div className={styles.templateFoundation}>规则基础：{RULE_TARGET_FOUNDATION_GROUP_NAMES.join(' / ')}</div>
              <div className={styles.templateFoundation}>节点出口：{GLOBAL_NODE_OUTLET_GROUP_NAMES.join(' / ')}</div>
              <div className={styles.templateMembers}>
                业务组：{template.displayGroupNames.length > 0 ? template.displayGroupNames.join(' / ') : '无'}
              </div>
            </button>
          ))}
        </div>
        <div className={styles.activeTemplateGroups}>
          <span className={styles.activeTemplateLabel}>固定规则基础</span>
          {RULE_TARGET_FOUNDATION_GROUP_NAMES.map(name => (
            <Badge key={name} variant="default">{name}</Badge>
          ))}
        </div>
        <div className={styles.activeTemplateGroups}>
          <span className={styles.activeTemplateLabel}>固定节点出口</span>
          {GLOBAL_NODE_OUTLET_GROUP_NAMES.map(name => (
            <Badge key={name} variant="default">{name}</Badge>
          ))}
        </div>
        <div className={styles.activeTemplateGroups}>
          <span className={styles.activeTemplateLabel}>当前业务分流组</span>
          {templateGroups.length === 0 ? (
            <Badge variant="default">无额外业务分流组</Badge>
          ) : (
            templateGroups.map(item => (
              <Badge key={item.name} variant={item.group?.enabled ? 'purple' : 'default'}>
                {item.name}
              </Badge>
            ))
          )}
        </div>
      </section>
      {foundationSections.length > 0 && (
        <section className={styles.foundationPanel}>
          <div className={styles.foundationHeader}>
            <div>
              <div className={styles.foundationTitle}>基础目标与节点出口</div>
              <div className={styles.foundationMeta}>始终存在；规则可直接命中 PROXY / DIRECT / REJECT，业务分流组会自动包含节点出口。</div>
            </div>
          </div>
          {foundationSections.map(section => (
            <div key={section.title} className={styles.foundationSection}>
              <div className={styles.foundationSectionHeader}>
                <div className={styles.foundationSectionTitle}>{section.title}</div>
                <div className={styles.foundationSectionDesc}>{section.description}</div>
              </div>
              <div className={styles.foundationGrid}>
                {section.groups.map(group => (
                  <div key={group.id} className={styles.foundationItem}>
                    <div className={styles.foundationItemTop}>
                      <span className={styles.foundationName}>{group.name}</span>
                      <Badge variant={GROUP_TYPE_COLORS[group.type] ?? 'default'}>{typeLabel(group.type)}</Badge>
                    </div>
                    <div className={styles.foundationSummary}>{describeFoundationGroup(group)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      {loading && visibleGroups.length === 0 ? <div className={styles.loading}>{t('common.loading')}</div> : (
        <div className={styles.list}>
          {visibleGroups.map(group => {
            const customIndex = customRoutingGroups.findIndex(item => item.id === group.id)
            return (
              <Card key={group.id} className={styles.groupCard}>
                {!group.isBuiltin && (
                  <div className={styles.orderControls}>
                    <Button variant="ghost" size="sm" disabled={customIndex <= 0} onClick={() => moveCustomGroup(group.id, -1)} title="上移">
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={customIndex < 0 || customIndex === customRoutingGroups.length - 1}
                      onClick={() => moveCustomGroup(group.id, 1)}
                      title="下移"
                    >
                      <ArrowDownIcon />
                    </Button>
                  </div>
                )}
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
                    <Badge variant="purple">自动出口候选</Badge>
                  </div>
                  <div className={styles.summary}>{describeRoutingGroupMembers(group)}</div>
                  {group.groupIds.length > 0 && (
                    <label className={styles.preferenceRow}>
                      <span>默认出口</span>
                      <select
                        className={styles.preferenceSelect}
                        value={outletPreferences[group.id] ?? ''}
                        onChange={event => void handleOutletPreference(group, event.target.value)}
                        disabled={savingPreferenceId === group.id}
                      >
                        <option value="">系统推荐：{getGroupName(groups, group.groupIds[0])}</option>
                        {group.groupIds.map(id => (
                          <option key={id} value={getOutletRef(groups, id)}>{getGroupName(groups, id)}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {!group.isBuiltin && (
                  <div className={styles.cardActions}>
                    <Button variant="ghost" size="sm" onClick={() => void updateGroup(group.id, { enabled: !group.enabled })}>
                      {group.enabled ? t('common.disable') : t('common.enable')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(group)}>
                      {t('common.edit')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { if (confirm('删除此策略组？')) void deleteGroup(group.id) }}>
                      <TrashIcon />
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
          {visibleGroups.length === 0 && <EmptyState title="暂无自定义策略组" description="默认策略组合会自动生成；这里只需要添加额外业务策略。" action={{ label: '添加自定义策略组', onClick: openCreate }} />}
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
              {USER_GROUP_TYPES.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}
            </select>
          </div>
          <Input label={t('groups.test_url')} value={form.testUrl ?? ''} onChange={e => setFormValue('testUrl', e.target.value, setForm)} />
          <Input label={t('groups.interval')} type="number" min="1" value={form.interval ?? DEFAULT_HEALTH_CHECK.interval} onChange={e => setFormValue('interval', Number(e.target.value), setForm)} />
          <Input label={t('groups.tolerance')} type="number" min="0" value={form.tolerance ?? DEFAULT_HEALTH_CHECK.tolerance} onChange={e => setFormValue('tolerance', Number(e.target.value), setForm)} />
        </div>

        <div className={styles.toggleGrid}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.enabled} onChange={e => setFormValue('enabled', e.target.checked, setForm)} />
            <span>{t('common.enabled')}</span>
          </label>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={form.lazy ?? DEFAULT_HEALTH_CHECK.lazy} onChange={e => setFormValue('lazy', e.target.checked, setForm)} />
            <span>{t('groups.lazy')}</span>
          </label>
        </div>

        <div className={styles.autoMembersInfo}>
          <div className={styles.autoMembersTitle}>出口候选自动维护</div>
          <div className={styles.autoMembersText}>
            保存后系统会自动加入 PROXY、DIRECT、REJECT、全部节点、节点选择、自动选择、故障切换，以及当前可用的国家 / 标签节点组。
          </div>
        </div>
      </Modal>
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
  return DEFAULT_OUTLET_GROUP_ID_SET.has(group.id)
}

function isRoutingPolicyGroup(group: ProxyGroup): boolean {
  return group.isBuiltin && !isDefaultOutletGroup(group) && !['direct', 'reject'].includes(group.type)
}

function isCustomRoutingGroup(group: ProxyGroup): boolean {
  return !group.isBuiltin && !isOutletGroup(group)
}

function formatTemplateCount(count: number): string {
  return count > 0 ? `${count} 个业务组` : '仅基础出口'
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

function describeFoundationGroup(group: ProxyGroup): string {
  if (group.name === 'PROXY') return '默认代理出口，自动聚合节点选择、自动选择、故障切换和全部节点。'
  if (group.name === 'DIRECT') return '直连出口，国内规则、局域网和无需代理的流量会命中这里。'
  if (group.name === 'REJECT') return '拒绝出口，广告、HTTPDNS 等拦截规则会命中这里。'
  if (group.name === '全部节点') return '包含所有可用节点，适合需要完整节点池的手动选择场景。'
  if (group.name === '节点选择') return '手动选择一个具体节点或节点组，适合用户临时指定出口。'
  if (group.name === '自动选择') return '按延迟自动选择可用节点，作为默认代理出口的优先候选。'
  if (group.name === '故障切换') return '当前节点不可用时自动切换到下一个可用节点。'
  return '系统内置基础出口。'
}

function describeRoutingGroupMembers(group: ProxyGroup): string {
  if (group.name === 'PROXY') return '默认代理出口，自动聚合节点选择、自动选择、故障切换和节点组。'
  return '自动包含基础出口、全局节点出口和可用节点组。'
}

function getGroupName(groups: ProxyGroup[], id: string | undefined): string {
  if (!id) return '无可用出口'
  return groups.find(group => group.id === id)?.name ?? id
}

function getOutletRef(groups: ProxyGroup[], id: string): string {
  return groups.find(group => group.id === id)?.outletRef ?? `group:${id}`
}
