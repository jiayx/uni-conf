import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import {
  isVisibleBusinessRoutingGroup,
  isCustomBusinessRoutingGroup,
} from '@/core/groups/policy-group-categories'
import { api } from '@/lib/api'
import { useGroupsStore } from '@/store/groups.store'
import { useSettingsStore } from '@/store/settings.store'
import { useRequestedEdit } from '@/core/navigation/use-requested-edit'
import { formValuesEqual, useUnsavedChangesGuard } from '@/core/forms/use-unsaved-changes'
import {
  DEFAULT_HEALTH_CHECK,
  GLOBAL_NODE_OUTLET_GROUP_NAMES,
  GLOBAL_NODE_OUTLET_GROUP_IDS,
  RULE_TARGET_FOUNDATION_GROUP_NAMES,
  ROUTING_POLICY_TEMPLATES,
  RULE_TARGET_FOUNDATION_GROUP_IDS,
} from '@uni-conf/shared'
import type { GroupType, ProxyGroup, RemoteRuleSet, RoutingPolicyTemplateId, UnmatchedTrafficPolicy } from '@uni-conf/types'
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
  const confirmAction = useConfirmDialog()
  const { groups, loading, error: loadError, fetchGroups, addGroup, updateGroup, deleteGroup, reorderGroups } = useGroupsStore()
  const applySettings = useSettingsStore(state => state.applySettings)
  const [showModal, setShowModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ProxyGroup | null>(null)
  const [form, setForm] = useState<GroupForm>(() => createEmptyForm(0))
  const [initialForm, setInitialForm] = useState<GroupForm>(() => createEmptyForm(0))
  const [formError, setFormError] = useState<unknown | null>(null)
  const [actionError, setActionError] = useState<unknown | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [rowAction, setRowAction] = useState<{ id: string; type: 'toggle' | 'delete' } | null>(null)
  const [reordering, setReordering] = useState(false)
  const [activeTemplate, setActiveTemplate] = useState<RoutingPolicyTemplateId>('common')
  const [unmatchedTrafficPolicy, setUnmatchedTrafficPolicy] = useState<UnmatchedTrafficPolicy>('proxy')
  const [ruleSets, setRuleSets] = useState<RemoteRuleSet[]>([])
  const [outletPreferences, setOutletPreferences] = useState<Record<string, string>>({})
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savingPreferenceId, setSavingPreferenceId] = useState<string | null>(null)
  const formDirty = showModal && !formValuesEqual(form, initialForm)
  const confirmDiscardForm = useUnsavedChangesGuard(formDirty)

  useEffect(() => {
    void fetchGroups()
    void api.settings.get()
      .then(settings => {
        setActiveTemplate(settings.routingPolicyTemplate)
        setUnmatchedTrafficPolicy(settings.unmatchedTrafficPolicy)
        setOutletPreferences(settings.routingOutletPreferences ?? {})
      })
      .catch(setActionError)
    void api.remoteRuleSets.list().then(setRuleSets).catch(setActionError)
  }, [fetchGroups])

  const visibleGroups = useMemo(
    () => groups.filter(isVisibleBusinessRoutingGroup),
    [groups]
  )
  const customRoutingGroups = useMemo(
    () => visibleGroups.filter(isCustomBusinessRoutingGroup),
    [visibleGroups]
  )
  const foundationSections = useMemo(
    () => [
      {
        title: t('groups.foundation_rule_targets'),
        description: t('groups.foundation_rule_targets_desc'),
        groups: RULE_TARGET_FOUNDATION_GROUP_IDS
          .map(id => groups.find(group => group.id === id))
          .filter((group): group is ProxyGroup => Boolean(group)),
      },
      {
        title: t('groups.global_node_outlets'),
        description: t('groups.global_node_outlets_desc'),
        groups: GLOBAL_NODE_OUTLET_GROUP_IDS
          .map(id => groups.find(group => group.id === id))
          .filter((group): group is ProxyGroup => Boolean(group)),
      },
    ].filter(section => section.groups.length > 0),
    [groups, t]
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
  const effectivePolicyRows = useMemo(() => {
    const enabledGroupIds = new Set(groups.filter(group => group.enabled).map(group => group.id))
    const effectiveSets = ruleSets.filter(set => set.enabled && enabledGroupIds.has(set.targetGroupId))
    const targetNames = [
      'PROXY',
      'DIRECT',
      'REJECT',
      ...activeTemplateConfig.groupNames,
    ]
    return targetNames.map(name => {
      const group = groups.find(item => item.name === name)
      return {
        name,
        ruleSets: group ? effectiveSets.filter(set => set.targetGroupId === group.id).map(set => set.name) : [],
      }
    }).filter(row => row.ruleSets.length > 0)
  }, [activeTemplateConfig, groups, ruleSets])
  const openCreate = () => {
    const nextForm = createEmptyForm(visibleGroups.length)
    setEditingGroup(null)
    setForm(nextForm)
    setInitialForm(nextForm)
    setFormError(null)
    setShowModal(true)
  }

  const openEdit = (group: ProxyGroup) => {
    const nextForm: GroupForm = {
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
    }
    setEditingGroup(group)
    setForm(nextForm)
    setInitialForm(nextForm)
    setFormError(null)
    setShowModal(true)
  }

  useRequestedEdit(groups.filter(group => !group.isBuiltin), openEdit)

  const closeFormModal = async () => {
    if (!(await confirmDiscardForm())) return
    setShowModal(false)
    setEditingGroup(null)
    setFormError(null)
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
      setFormError(t('groups.name_required'))
      return
    }

    setFormSaving(true)
    setFormError(null)
    try {
      if (editingGroup) {
        await updateGroup(editingGroup.id, payload)
      } else {
        await addGroup(payload)
      }
      setShowModal(false)
      setEditingGroup(null)
      setForm(createEmptyForm(visibleGroups.length))
    } catch (error) {
      setFormError(error)
    } finally {
      setFormSaving(false)
    }
  }

  const handleDelete = async (group: ProxyGroup) => {
    if (!(await confirmAction({
      description: t('groups.delete_confirm'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    setRowAction({ id: group.id, type: 'delete' })
    setActionError(null)
    try {
      await deleteGroup(group.id)
    } catch (error) {
      setActionError(error)
    } finally {
      setRowAction(null)
    }
  }

  const handleTemplateChange = async (templateId: RoutingPolicyTemplateId) => {
    setSavingTemplate(true)
    setActionError(null)
    try {
      const updated = await api.settings.update({ routingPolicyTemplate: templateId })
      applySettings(updated)
      setActiveTemplate(updated.routingPolicyTemplate)
      setOutletPreferences(updated.routingOutletPreferences ?? {})
      await Promise.all([fetchGroups(), api.remoteRuleSets.list().then(setRuleSets)])
    } catch (error) {
      setActionError(error)
    } finally {
      setSavingTemplate(false)
    }
  }

  const handleUnmatchedTrafficPolicyChange = async (policy: UnmatchedTrafficPolicy) => {
    setSavingTemplate(true)
    setActionError(null)
    try {
      const updated = await api.settings.update({ unmatchedTrafficPolicy: policy })
      applySettings(updated)
      setUnmatchedTrafficPolicy(updated.unmatchedTrafficPolicy)
      await Promise.all([fetchGroups(), api.remoteRuleSets.list().then(setRuleSets)])
    } catch (error) {
      setActionError(error)
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
    setActionError(null)
    try {
      const updated = await api.settings.update({ routingOutletPreferences: nextPreferences })
      applySettings(updated)
      setOutletPreferences(updated.routingOutletPreferences ?? {})
      await fetchGroups()
    } catch (error) {
      setActionError(error)
    } finally {
      setSavingPreferenceId(null)
    }
  }

  const moveCustomGroup = async (groupId: string, direction: -1 | 1) => {
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
    setReordering(true)
    setActionError(null)
    try {
      await reorderGroups(ordered.map(group => group.id))
    } catch (error) {
      setActionError(error)
    } finally {
      setReordering(false)
    }
  }

  const handleToggleEnabled = async (group: ProxyGroup) => {
    setRowAction({ id: group.id, type: 'toggle' })
    setActionError(null)
    try {
      await updateGroup(group.id, { enabled: !group.enabled })
    } catch (error) {
      setActionError(error)
    } finally {
      setRowAction(null)
    }
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
        description={t('groups.description')}
        actions={<Button onClick={openCreate} icon={<PlusIcon />}>{t('groups.new')}</Button>}
      />
      {loadError != null && <ErrorNotice error={loadError} />}
      {actionError != null && <ErrorNotice error={actionError} />}
      <section className={styles.templatePanel}>
        <div className={styles.templateHeader}>
          <div>
            <div className={styles.templateTitle}>{t('groups.base_policy_title')}</div>
            <div className={styles.templateMeta}>{t('groups.base_policy_meta')}</div>
          </div>
        </div>
        <div className={styles.basePolicyGrid}>
          {(['proxy', 'direct'] as const).map(policy => (
            <button
              key={policy}
              type="button"
              className={`${styles.templateItem} ${unmatchedTrafficPolicy === policy ? styles.templateItemActive : ''}`}
              aria-pressed={unmatchedTrafficPolicy === policy}
              onClick={() => void handleUnmatchedTrafficPolicyChange(policy)}
              disabled={savingTemplate}
            >
              <div className={styles.templateItemTop}>
                <span className={styles.templateName}>{t(`groups.base_policy_${policy}_name`)}</span>
                {unmatchedTrafficPolicy === policy && <Badge variant="success">{t('common.current')}</Badge>}
              </div>
              <div className={styles.templateDesc}>{t(`groups.base_policy_${policy}_desc`)}</div>
            </button>
          ))}
        </div>
      </section>
      <section className={styles.templatePanel}>
        <div className={styles.templateHeader}>
          <div>
            <div className={styles.templateTitle}>{t('groups.template_title')}</div>
            <div className={styles.templateMeta}>{t('groups.template_meta')}</div>
          </div>
          <Button
            variant="secondary"
            onClick={() => void Promise.all([
              fetchGroups(),
              api.remoteRuleSets.list().then(setRuleSets),
            ]).catch(setActionError)}
            loading={loading}
            disabled={savingTemplate || savingPreferenceId !== null || reordering}
          >
            {t('common.refresh')}
          </Button>
        </div>
        <div className={styles.templateGrid}>
          {templateOptions.map(template => (
            <button
              key={template.id}
              type="button"
              className={`${styles.templateItem} ${template.active ? styles.templateItemActive : ''}`}
              aria-pressed={template.active}
              onClick={() => void handleTemplateChange(template.id)}
              disabled={savingTemplate}
            >
              <div className={styles.templateItemTop}>
                <span className={styles.templateName}>{template.name}</span>
                <Badge variant={template.active ? 'success' : 'default'}>
                  {template.active ? t('common.current') : formatTemplateCount(template.displayGroupNames.length, t)}
                </Badge>
              </div>
              <div className={styles.templateDesc}>{template.description}</div>
              <div className={styles.templateMembers}>
                {t('groups.business_groups')}: {template.displayGroupNames.length > 0 ? template.displayGroupNames.join(' / ') : t('common.none')}
              </div>
            </button>
          ))}
        </div>
        <div className={styles.activeTemplateGroups}>
          <span className={styles.activeTemplateLabel}>{t('groups.fixed_rule_foundation')}</span>
          {RULE_TARGET_FOUNDATION_GROUP_NAMES.map(name => (
            <Badge key={name} variant="default">{name}</Badge>
          ))}
        </div>
        <div className={styles.activeTemplateGroups}>
          <span className={styles.activeTemplateLabel}>{t('groups.fixed_node_outlets')}</span>
          {GLOBAL_NODE_OUTLET_GROUP_NAMES.map(name => (
            <Badge key={name} variant="default">{name}</Badge>
          ))}
        </div>
        <div className={styles.activeTemplateGroups}>
          <span className={styles.activeTemplateLabel}>{t('groups.current_business_groups')}</span>
          {templateGroups.length === 0 ? (
            <Badge variant="default">{t('groups.no_extra_business_groups')}</Badge>
          ) : (
            templateGroups.map(item => (
              <Badge key={item.name} variant={item.group?.enabled ? 'purple' : 'default'}>
                {item.name}
              </Badge>
            ))
          )}
        </div>
      </section>
      <section className={styles.effectivePanel}>
        <div>
          <div className={styles.templateTitle}>{t('groups.effective_policy_title')}</div>
          <div className={styles.templateMeta}>{t('groups.effective_policy_meta')}</div>
        </div>
        <div className={styles.effectiveRows}>
          {effectivePolicyRows.map(row => (
            <details key={row.name} className={styles.effectiveRow}>
              <summary>
                <strong>{row.name}</strong>
                <span>{t('groups.effective_rule_set_count', { count: row.ruleSets.length })}</span>
              </summary>
              <div className={styles.effectiveRuleSets}>{row.ruleSets.join(' / ')}</div>
            </details>
          ))}
          <div className={styles.effectiveRowStatic}>
            <strong>{t('groups.unmatched_traffic')}</strong>
            <span>→ {unmatchedTrafficPolicy === 'proxy' ? 'PROXY' : 'DIRECT'}</span>
          </div>
        </div>
      </section>
      {foundationSections.length > 0 && (
        <details className={styles.foundationPanel}>
          <summary className={styles.foundationHeader}>
            <div>
              <div className={styles.foundationTitle}>{t('groups.foundation_title')}</div>
              <div className={styles.foundationMeta}>{t('groups.foundation_meta')}</div>
            </div>
            <span className={styles.foundationExpandHint}>{t('groups.foundation_expand_hint')}</span>
          </summary>
          <div className={styles.foundationBody}>
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
                      <div className={styles.foundationSummary}>{describeFoundationGroup(group, t)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
      {loading && visibleGroups.length === 0 ? <div className={styles.loading}>{t('common.loading')}</div> : (
        <div className={styles.list}>
          {visibleGroups.map(group => {
            const customIndex = customRoutingGroups.findIndex(item => item.id === group.id)
            const preferredOutlet = outletPreferences[group.id]
            return (
              <Card key={group.id} className={styles.groupCard}>
                {!group.isBuiltin && (
                  <div className={styles.orderControls}>
                    <Button variant="ghost" size="sm" disabled={reordering || customIndex <= 0} onClick={() => void moveCustomGroup(group.id, -1)} title={t('common.move_up')}>
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={reordering || customIndex < 0 || customIndex === customRoutingGroups.length - 1}
                      onClick={() => void moveCustomGroup(group.id, 1)}
                      title={t('common.move_down')}
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
                    <Badge variant="purple">{t('groups.auto_outlet_candidates')}</Badge>
                    {group.groupIds.length > 0 && (
                      <label className={styles.preferenceInline}>
                        <span>{t('groups.default_outlet')}</span>
                        <select
                          className={styles.preferenceSelect}
                          value={preferredOutlet ?? ''}
                          onChange={event => void handleOutletPreference(group, event.target.value)}
                          disabled={savingPreferenceId === group.id}
                        >
                          <option value="">{t('groups.system_recommended', { outlet: getGroupName(groups, group.groupIds[0]) })}</option>
                          {group.groupIds.map(id => (
                            <option key={id} value={getOutletRef(groups, id)}>{getGroupName(groups, id)}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className={styles.summary}>{describeRoutingGroupMembers(group, t)}</div>
                </div>
                {!group.isBuiltin && (
                  <div className={styles.cardActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={rowAction?.id === group.id && rowAction.type === 'toggle'}
                      disabled={rowAction?.id === group.id}
                      onClick={() => void handleToggleEnabled(group)}
                    >
                      {group.enabled ? t('common.disable') : t('common.enable')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={rowAction?.id === group.id} onClick={() => openEdit(group)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={rowAction?.id === group.id && rowAction.type === 'delete'}
                      disabled={rowAction?.id === group.id}
                      aria-label={t('groups.delete_group', { name: group.name })}
                      title={t('groups.delete_group', { name: group.name })}
                      onClick={() => void handleDelete(group)}
                    >
                      <TrashIcon />
                    </Button>
                  </div>
                )}
              </Card>
            )
          })}
          {visibleGroups.length === 0 && <EmptyState title={t('groups.empty_title')} description={t('groups.empty_description')} action={{ label: t('groups.new'), onClick: openCreate }} />}
        </div>
      )}

      <Modal
        open={showModal}
        onOpenChange={open => {
          if (!open) void closeFormModal()
        }}
        title={editingGroup ? t('common.edit') : t('groups.new')}
        size="lg"
        closeDisabled={formSaving}
        footer={
          <>
            <Button variant="secondary" disabled={formSaving} onClick={() => void closeFormModal()}>{t('common.cancel')}</Button>
            <Button loading={formSaving} onClick={() => void handleSave()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError != null && <ErrorNotice error={formError} className={styles.formError} />}
        <div className={styles.formGrid}>
          <Input label={t('common.name')} value={form.name} onChange={e => setFormValue('name', e.target.value, setForm)} placeholder="My Proxy Group" />
          <div>
            <label className={styles.selectLabel} htmlFor="policy-group-type">{t('common.type')}</label>
            <select id="policy-group-type" className={styles.select} value={form.type} onChange={e => setFormValue('type', e.target.value as GroupType, setForm)}>
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
          <div className={styles.autoMembersTitle}>{t('groups.auto_members_title')}</div>
          <div className={styles.autoMembersText}>{t('groups.auto_members_text')}</div>
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

function formatTemplateCount(count: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  return count > 0 ? t('groups.business_group_count', { count }) : t('groups.foundation_only')
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

function describeFoundationGroup(group: ProxyGroup, t: (key: string) => string): string {
  if (group.name === 'PROXY') return t('groups.foundation_proxy_desc')
  if (group.name === 'DIRECT') return t('groups.foundation_direct_desc')
  if (group.name === 'REJECT') return t('groups.foundation_reject_desc')
  if (group.name === '全部节点') return t('groups.foundation_all_nodes_desc')
  if (group.name === '节点选择') return t('groups.foundation_node_select_desc')
  if (group.name === '自动选择') return t('groups.foundation_auto_select_desc')
  if (group.name === '故障切换') return t('groups.foundation_fallback_desc')
  return t('groups.foundation_default_desc')
}

function describeRoutingGroupMembers(group: ProxyGroup, t: (key: string) => string): string {
  if (group.name === 'PROXY') return t('groups.routing_proxy_summary')
  return t('groups.routing_group_summary')
}

function getGroupName(groups: ProxyGroup[], id: string | undefined): string {
  if (!id) return 'N/A'
  return groups.find(group => group.id === id)?.name ?? id
}

function getOutletRef(groups: ProxyGroup[], id: string): string {
  return groups.find(group => group.id === id)?.outletRef ?? `group:${id}`
}
