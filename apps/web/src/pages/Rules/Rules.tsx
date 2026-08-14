import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal, ModalClose } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { useRulesStore } from '@/store/rules.store'
import { useGroupsStore } from '@/store/groups.store'
import { MANUAL_RULE_TYPES, parseManualRulesWithDiagnostics, type ManualRuleForm } from '@/core/rules/manual-rules'
import {
  summarizeBatchRuleCompatibility,
  type BatchRuleCompatibilitySummary,
} from '@/core/rules/batch-rule-compatibility'
import { useRequestedEdit } from '@/core/navigation/use-requested-edit'
import { formValuesEqual, useUnsavedChangesGuard } from '@/core/forms/use-unsaved-changes'
import {
  MAX_NODE_SEARCH_LENGTH,
  MAX_RULE_BATCH_SELECTION,
  DEFAULT_RULE_TARGET_GROUP_ID,
  isRuleTargetGroup,
  resolveRuleForExport,
  getRuleNoResolveHandling,
  validateAndNormalizeRulePayload,
} from '@uni-conf/shared'
import type { ExportFormat, ProxyRule, RuleType } from '@uni-conf/types'
import styles from './Rules.module.css'

const RULE_COMPATIBILITY_TARGETS: ExportFormat[] = [
  'mihomo',
  'singbox',
  'surge',
  'loon',
  'shadowrocket',
  'quantumultx',
  'stash',
  'egern',
]

function createEmptyForm(order: number, targetGroupId = ''): ManualRuleForm {
  return {
    name: '',
    type: 'DOMAIN-SUFFIX',
    payload: '',
    targetGroupId,
    noResolve: false,
    enabled: true,
    order,
    compatibility: [],
    notes: '',
  }
}

export function Rules() {
  const { t } = useTranslation()
  const confirmAction = useConfirmDialog()
  const {
    rules,
    loading,
    error: loadError,
    fetchRules,
    addRule,
    updateRule,
    deleteRule,
    reorderRules,
    batchAddRules,
    setRulesEnabled,
  } = useRulesStore()
  const { groups, fetchGroups } = useGroupsStore()
  const [showModal, setShowModal] = useState(false)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [editingRule, setEditingRule] = useState<ProxyRule | null>(null)
  const [form, setForm] = useState<ManualRuleForm>(() => createEmptyForm(0))
  const [initialForm, setInitialForm] = useState<ManualRuleForm>(() => createEmptyForm(0))
  const [batchText, setBatchText] = useState('')
  const [batchTargetGroupId, setBatchTargetGroupId] = useState('')
  const [initialBatchTargetGroupId, setInitialBatchTargetGroupId] = useState('')
  const [formError, setFormError] = useState<unknown>(null)
  const [batchError, setBatchError] = useState<unknown>(null)
  const [batchSaving, setBatchSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterTarget, setFilterTarget] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [bulkError, setBulkError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [rowAction, setRowAction] = useState<{ id: string; type: 'toggle' | 'delete' } | null>(null)
  const [reordering, setReordering] = useState(false)
  const formDirty = showModal && !formValuesEqual(form, initialForm)
  const batchDirty = showBatchModal && (batchText !== '' || batchTargetGroupId !== initialBatchTargetGroupId)
  useUnsavedChangesGuard(formDirty)
  useUnsavedChangesGuard(batchDirty)

  useEffect(() => {
    void fetchRules()
    void fetchGroups()
  }, [fetchRules, fetchGroups])

  const ruleTargetGroups = groups.filter(isRuleTargetGroup)
  const enabledGroups = ruleTargetGroups.filter(group => group.enabled)
  const targetGroups = enabledGroups.length > 0 ? enabledGroups : ruleTargetGroups
  const defaultTargetGroupId = DEFAULT_RULE_TARGET_GROUP_ID
  const batchParsed = useMemo(
    () => parseManualRulesWithDiagnostics(
      batchText,
      batchTargetGroupId || defaultTargetGroupId,
      targetGroups,
      rules.length,
    ),
    [batchTargetGroupId, batchText, defaultTargetGroupId, rules.length, targetGroups],
  )
  const batchCompatibility = useMemo(
    () => summarizeBatchRuleCompatibility(batchParsed.rules, RULE_COMPATIBILITY_TARGETS),
    [batchParsed.rules],
  )
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name ?? id
  const filteredRules = rules.filter(rule => {
    if (normalizedSearch && ![
      rule.name ?? '',
      rule.payload || 'MATCH',
      rule.type,
      rule.notes ?? '',
      getGroupName(rule.targetGroupId),
    ].some(value => value.toLocaleLowerCase().includes(normalizedSearch))) return false
    if (filterType && rule.type !== filterType) return false
    if (filterTarget && rule.targetGroupId !== filterTarget) return false
    if (filterStatus === 'enabled' && !rule.enabled) return false
    if (filterStatus === 'disabled' && rule.enabled) return false
    return true
  })
  const ruleTypes = [...new Set(rules.map(rule => rule.type))]
  const ruleTargets = [...new Set(rules.map(rule => rule.targetGroupId))]
  const filtersActive = Boolean(normalizedSearch || filterType || filterTarget || filterStatus)
  const visibleIds = filteredRules.map(rule => rule.id)
  const selectableVisibleIds = visibleIds.slice(0, MAX_RULE_BATCH_SELECTION)
  const allVisibleSelected = selectableVisibleIds.length > 0
    && selectableVisibleIds.every(id => selectedIds.has(id))

  const resetFilters = () => {
    setSearch('')
    setFilterType('')
    setFilterTarget('')
    setFilterStatus('')
    setSelectedIds(new Set())
  }

  const toggleVisibleSelection = () => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (allVisibleSelected) {
        for (const id of selectableVisibleIds) next.delete(id)
      } else {
        for (const id of selectableVisibleIds) next.add(id)
      }
      return next
    })
  }

  const handleBulkEnabled = async (enabled: boolean) => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setBulkUpdating(true)
    setBulkError(null)
    try {
      await setRulesEnabled(ids, enabled)
      setSelectedIds(new Set())
    } catch (error) {
      setBulkError(error)
    } finally {
      setBulkUpdating(false)
    }
  }

  const openCreate = () => {
    const nextForm = createEmptyForm(rules.length, defaultTargetGroupId)
    setEditingRule(null)
    setForm(nextForm)
    setInitialForm(nextForm)
    setFormError(null)
    setShowModal(true)
  }

  const openEdit = (rule: ProxyRule) => {
    const nextForm: ManualRuleForm = {
      name: rule.name ?? '',
      type: rule.type,
      payload: rule.payload,
      targetGroupId: rule.targetGroupId,
      noResolve: rule.noResolve ?? false,
      enabled: rule.enabled,
      order: rule.order,
      compatibility: rule.compatibility,
      notes: rule.notes ?? '',
    }
    setEditingRule(rule)
    setForm(nextForm)
    setInitialForm(nextForm)
    setFormError(null)
    setShowModal(true)
  }

  useRequestedEdit(rules, openEdit)

  const openBatch = () => {
    setBatchTargetGroupId(defaultTargetGroupId)
    setInitialBatchTargetGroupId(defaultTargetGroupId)
    setBatchText('')
    setBatchError(null)
    setShowBatchModal(true)
  }

  const closeFormModal = () => {
    setShowModal(false)
    setEditingRule(null)
    setFormError(null)
  }

  const closeBatchModal = () => {
    setShowBatchModal(false)
    setBatchText('')
    setBatchError(null)
  }

  const handleSave = async () => {
    const payloadValidation = validateAndNormalizeRulePayload(form.type, form.payload)
    if (!payloadValidation.valid) {
      setFormError(t(`rules.payload_error_${payloadValidation.code}`))
      return
    }
    const payload: ManualRuleForm = {
      ...form,
      name: form.name?.trim() ?? '',
      payload: payloadValidation.payload,
      targetGroupId: form.targetGroupId || defaultTargetGroupId,
      notes: form.notes?.trim() ?? '',
    }

    if (!payload.payload) {
      setFormError(t('rules.payload_required'))
      return
    }
    setFormSaving(true)
    setFormError(null)
    try {
      if (editingRule) {
        await updateRule(editingRule.id, payload)
      } else {
        await addRule(payload)
      }
      setShowModal(false)
      setEditingRule(null)
      setForm(createEmptyForm(rules.length, defaultTargetGroupId))
    } catch (error) {
      setFormError(error instanceof Error ? error : t('rules.save_failed'))
    } finally {
      setFormSaving(false)
    }
  }

  const handleDelete = async (rule: ProxyRule) => {
    if (!(await confirmAction({
      description: t('rules.delete_confirm'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    setRowAction({ id: rule.id, type: 'delete' })
    setActionError(null)
    try {
      await deleteRule(rule.id)
      setSelectedIds(current => {
        const next = new Set(current)
        next.delete(rule.id)
        return next
      })
    } catch (error) {
      setActionError(error)
    } finally {
      setRowAction(null)
    }
  }

  const handleToggleEnabled = async (rule: ProxyRule) => {
    setRowAction({ id: rule.id, type: 'toggle' })
    setActionError(null)
    try {
      await updateRule(rule.id, { enabled: !rule.enabled })
    } catch (error) {
      setActionError(error)
    } finally {
      setRowAction(null)
    }
  }

  const handleBatchImport = async () => {
    const parsed = batchParsed
    if (parsed.issues.length > 0) {
      const shownIssues = parsed.issues.slice(0, 5).map(issue => {
        const params = { line: issue.lineNumber, detail: issue.detail }
        switch (issue.reason) {
          case 'unsupported-type':
            return t('rules.batch_issue_unsupported_type', params)
          case 'missing-payload':
            return t('rules.batch_issue_missing_payload', params)
          case 'invalid-payload':
            return t('rules.batch_issue_invalid_payload', {
              line: issue.lineNumber,
              detail: t(`rules.payload_error_${issue.detail}`),
            })
          case 'unknown-target':
            return t('rules.batch_issue_unknown_target', params)
          case 'unsupported-option':
            return t('rules.batch_issue_unsupported_option', params)
        }
      })
      const remaining = parsed.issues.length - shownIssues.length
      setBatchError([
        ...shownIssues,
        ...(remaining > 0 ? [t('rules.batch_issue_more', { count: remaining })] : []),
        t('rules.batch_issue_fix_all'),
      ].join(' '))
      return
    }
    if (parsed.rules.length === 0) {
      setBatchError(t('rules.no_valid_rules'))
      return
    }
    if (parsed.rules.length > MAX_RULE_BATCH_SELECTION) {
      setBatchError(t('rules.batch_limit', { count: MAX_RULE_BATCH_SELECTION }))
      return
    }

    setBatchSaving(true)
    setBatchError(null)
    try {
      await batchAddRules(parsed.rules)
      setShowBatchModal(false)
      setBatchText('')
    } catch (error) {
      setBatchError(error instanceof Error ? error : t('rules.batch_save_failed'))
    } finally {
      setBatchSaving(false)
    }
  }

  const moveRule = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= rules.length || reordering) return
    const ordered = [...rules]
    const [item] = ordered.splice(index, 1)
    ordered.splice(target, 0, item)
    setReordering(true)
    setActionError(null)
    try {
      await reorderRules(ordered.map(rule => rule.id))
    } catch (error) {
      setActionError(error)
    } finally {
      setReordering(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('rules.title')}
        description={`${t('rules.reorder_hint')} · ${t('rules.count_summary', { shown: filteredRules.length, total: rules.length })}`}
        actions={
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={openBatch}>{t('rules.batch_add')}</Button>
            <Button onClick={openCreate} icon={<PlusIcon />}>{t('rules.new')}</Button>
          </div>
        }
      />
      {loadError && <ErrorNotice error={loadError} className={styles.bulkError} />}
      {actionError != null && <ErrorNotice error={actionError} className={styles.bulkError} />}
      {rules.length > 0 && (
        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            aria-label={t('common.search')}
            placeholder={t('rules.search_placeholder')}
            value={search}
            onChange={event => {
              setSearch(event.target.value.slice(0, MAX_NODE_SEARCH_LENGTH))
              setSelectedIds(new Set())
            }}
          />
          <select aria-label={t('rules.type')} className={styles.filterSelect} value={filterType} onChange={event => { setFilterType(event.target.value); setSelectedIds(new Set()) }}>
            <option value="">{t('rules.all_types')}</option>
            {ruleTypes.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
          <select aria-label={t('rules.target')} className={styles.filterSelect} value={filterTarget} onChange={event => { setFilterTarget(event.target.value); setSelectedIds(new Set()) }}>
            <option value="">{t('rules.all_targets')}</option>
            {ruleTargets.map(id => <option key={id} value={id}>{getGroupName(id)}</option>)}
          </select>
          <select aria-label={t('common.status')} className={styles.filterSelect} value={filterStatus} onChange={event => { setFilterStatus(event.target.value); setSelectedIds(new Set()) }}>
            <option value="">{t('rules.all_statuses')}</option>
            <option value="enabled">{t('common.enabled')}</option>
            <option value="disabled">{t('common.disabled')}</option>
          </select>
          {filtersActive && <Button variant="ghost" size="sm" onClick={resetFilters}>{t('rules.clear_filters')}</Button>}
          {filtersActive && <div className={styles.filterNotice}>{t('rules.reorder_filtered_notice')}</div>}
        </div>
      )}
      {bulkError != null && <ErrorNotice error={bulkError} className={styles.bulkError} />}
      {selectedIds.size > 0 && (
        <div className={styles.bulkToolbar} role="status" aria-live="polite">
          <strong>{t('rules.selected_count', { count: selectedIds.size })}</strong>
          <div className={styles.bulkActions}>
            <Button size="sm" loading={bulkUpdating} onClick={() => void handleBulkEnabled(true)}>{t('rules.enable_selected')}</Button>
            <Button variant="secondary" size="sm" disabled={bulkUpdating} onClick={() => void handleBulkEnabled(false)}>{t('rules.disable_selected')}</Button>
            <Button variant="ghost" size="sm" disabled={bulkUpdating} onClick={() => setSelectedIds(new Set())}>{t('rules.clear_selection')}</Button>
          </div>
          {filteredRules.length > MAX_RULE_BATCH_SELECTION && (
            <div className={styles.bulkLimitNotice}>
              {t('rules.selection_limit_notice', { count: MAX_RULE_BATCH_SELECTION })}
            </div>
          )}
        </div>
      )}
      {loading && rules.length === 0 ? <div className={styles.loading}>{t('common.loading')}</div> : rules.length === 0 ? (
        <EmptyState
          title={t('rules.empty_title')}
          description={t('rules.empty_description')}
          action={{ label: t('rules.new'), onClick: openCreate }}
        />
      ) : filteredRules.length === 0 ? (
        <EmptyState
          title={t('rules.no_results')}
          description={t('rules.no_results_help')}
          action={{ label: t('rules.clear_filters'), onClick: resetFilters }}
        />
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead><tr>
              <th className={styles.selectionColumn}>
                <input
                  type="checkbox"
                  aria-label={t(filteredRules.length > MAX_RULE_BATCH_SELECTION
                    ? 'rules.select_visible_limit'
                    : 'rules.select_all_visible', { count: MAX_RULE_BATCH_SELECTION })}
                  checked={allVisibleSelected}
                  onChange={toggleVisibleSelection}
                />
              </th>
              <th>#</th>
              <th>{t('rules.type')}</th>
              <th>{t('rules.payload')}</th>
              <th>{t('rules.target')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.actions')}</th>
            </tr></thead>
            <tbody>
              {filteredRules.map(rule => {
                const index = rules.findIndex(item => item.id === rule.id)
                return (
                <tr key={rule.id} className={styles.row}>
                  <td className={styles.selectionColumn} data-label={t('rules.selection')}>
                    <input
                      type="checkbox"
                      aria-label={t('rules.select_rule', { name: rule.name || rule.payload || rule.type })}
                      checked={selectedIds.has(rule.id)}
                      disabled={!selectedIds.has(rule.id) && selectedIds.size >= MAX_RULE_BATCH_SELECTION}
                      onChange={() => setSelectedIds(current => {
                        const next = new Set(current)
                        if (next.has(rule.id)) next.delete(rule.id)
                        else next.add(rule.id)
                        return next
                      })}
                    />
                  </td>
                  <td className={styles.orderNum} data-label={t('rules.order')}>
                    <div className={styles.orderCell}>
                      <span>{index + 1}</span>
                      <div className={styles.orderControls}>
                        <Button variant="ghost" size="sm" disabled={filtersActive || reordering || index === 0} onClick={() => void moveRule(index, -1)} title={filtersActive ? t('rules.reorder_filtered_notice') : t('common.move_up')}><ArrowUpIcon /></Button>
                        <Button variant="ghost" size="sm" disabled={filtersActive || reordering || index === rules.length - 1} onClick={() => void moveRule(index, 1)} title={filtersActive ? t('rules.reorder_filtered_notice') : t('common.move_down')}><ArrowDownIcon /></Button>
                      </div>
                    </div>
                  </td>
                  <td data-label={t('rules.type')}><Badge variant="info">{rule.type}</Badge></td>
                  <td className={styles.payload} data-label={t('rules.payload')}>
                    {rule.payload || 'MATCH'}
                    {rule.name && <div className={styles.ruleName}>{rule.name}</div>}
                    {rule.notes && <div className={styles.ruleNotes}>{rule.notes}</div>}
                  </td>
                  <td data-label={t('rules.target')}><Badge variant="purple">{getGroupName(rule.targetGroupId)}</Badge></td>
                  <td data-label={t('common.status')}>
                    <Badge variant={rule.enabled ? 'success' : 'default'}>
                      {rule.enabled ? t('common.enabled') : t('common.disabled')}
                    </Badge>
                  </td>
                  <td data-label={t('common.actions')}>
                    <div className={styles.rowActions}>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={rowAction?.id === rule.id && rowAction.type === 'toggle'}
                        disabled={rowAction?.id === rule.id}
                        onClick={() => void handleToggleEnabled(rule)}
                      >
                        {rule.enabled ? t('common.disable') : t('common.enable')}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={rowAction?.id === rule.id} onClick={() => openEdit(rule)}>
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={rowAction?.id === rule.id && rowAction.type === 'delete'}
                        disabled={rowAction?.id === rule.id}
                        aria-label={t('rules.delete_rule', { name: rule.name || rule.payload || rule.type })}
                        title={t('rules.delete_rule', { name: rule.name || rule.payload || rule.type })}
                        onClick={() => void handleDelete(rule)}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showModal}
        dirty={formDirty}
        onOpenChange={open => {
          if (!open) closeFormModal()
        }}
        title={editingRule ? t('rules.edit') : t('rules.new')}
        closeDisabled={formSaving}
        footer={
          <>
            <ModalClose><Button variant="secondary" disabled={formSaving}>{t('common.cancel')}</Button></ModalClose>
            <Button loading={formSaving} onClick={() => void handleSave()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError != null && <ErrorNotice error={formError} className={styles.formError} />}
        <Input label={t('rules.name_optional')} value={form.name ?? ''} onChange={e => setFormValue('name', e.target.value, setForm)} />
        <div>
          <label className={styles.label} htmlFor="manual-rule-type">{t('rules.type')}</label>
          <select id="manual-rule-type" className={styles.select} value={form.type} onChange={e => setForm(current => ({
            ...current,
            type: e.target.value as RuleType,
          }))}>
            {MANUAL_RULE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <Input
          label={t('rules.payload')}
          value={form.payload}
          onChange={e => setFormValue('payload', e.target.value, setForm)}
          placeholder={t('rules.payload_placeholder')}
        />
        <div>
          <label className={styles.label} htmlFor="manual-rule-target">{t('rules.target')}</label>
          <select id="manual-rule-target" className={styles.select} value={form.targetGroupId} onChange={e => setFormValue('targetGroupId', e.target.value, setForm)}>
            <option value="">{t('rules.default_target')}</option>
            {targetGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={form.enabled} onChange={e => setFormValue('enabled', e.target.checked, setForm)} />
          {t('common.enabled')}
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={form.noResolve ?? false} onChange={e => setFormValue('noResolve', e.target.checked, setForm)} />
          {t('rules.no_resolve')}
        </label>
        <RuleCompatibilityPreview
          type={form.type}
          payload={form.payload}
          noResolve={form.noResolve ?? false}
        />
        <Input label={t('common.notes')} value={form.notes ?? ''} onChange={e => setFormValue('notes', e.target.value, setForm)} />
      </Modal>

      <Modal
        open={showBatchModal}
        dirty={batchDirty}
        onOpenChange={open => {
          if (!open) closeBatchModal()
        }}
        title={t('rules.batch_add')}
        size="lg"
        closeDisabled={batchSaving}
        footer={
          <>
            <ModalClose><Button variant="secondary" disabled={batchSaving}>{t('common.cancel')}</Button></ModalClose>
            <Button loading={batchSaving} onClick={() => void handleBatchImport()}>{t('common.save')}</Button>
          </>
        }
      >
        {batchError != null && <ErrorNotice error={batchError} className={styles.formError} />}
        <div>
          <label className={styles.label} htmlFor="manual-rule-batch-target">{t('rules.target')}</label>
          <select id="manual-rule-batch-target" className={styles.select} value={batchTargetGroupId} onChange={e => { setBatchTargetGroupId(e.target.value); setBatchError(null) }}>
            <option value="">{t('rules.default_target')}</option>
            {targetGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <label className={styles.label} htmlFor="manual-rule-batch-text">{t('rules.batch_text')}</label>
          <textarea
            id="manual-rule-batch-text"
            className={styles.textarea}
            value={batchText}
            onChange={e => { setBatchText(e.target.value); setBatchError(null) }}
            placeholder="DOMAIN-SUFFIX,example.com,PROXY&#10;DOMAIN,api.example.com&#10;IP-CIDR,10.0.0.0/8,no-resolve"
          />
        </div>
        <div className={styles.helpText}>
          {t('rules.batch_help')}
        </div>
        {batchParsed.candidateCount > 0 && (
          <BatchRuleCompatibilityPreview
            candidateCount={batchParsed.candidateCount}
            validCount={batchParsed.rules.length}
            invalidCount={batchParsed.issues.length}
            summaries={batchCompatibility}
          />
        )}
      </Modal>
    </div>
  )
}

function BatchRuleCompatibilityPreview({
  candidateCount,
  validCount,
  invalidCount,
  summaries,
}: {
  candidateCount: number
  validCount: number
  invalidCount: number
  summaries: BatchRuleCompatibilitySummary[]
}) {
  const { t } = useTranslation()
  return (
    <section className={styles.batchCompatibility} aria-labelledby="batch-rule-compatibility-title">
      <div className={styles.compatibilityHeader}>
        <strong id="batch-rule-compatibility-title">{t('rules.batch_compatibility_title')}</strong>
        <span>
          {t('rules.batch_compatibility_summary', {
            total: candidateCount,
            valid: validCount,
            invalid: invalidCount,
          })}
        </span>
      </div>
      {validCount > 0 && (
        <div className={styles.batchCompatibilityTableWrapper}>
          <table className={styles.batchCompatibilityTable}>
            <thead>
              <tr>
                <th>{t('rules.batch_compatibility_client')}</th>
                <th>{t('rules.compat_full')}</th>
                <th>{t('rules.compat_convert')}</th>
                <th>{t('rules.compat_partial')}</th>
                <th>{t('rules.compat_unsupported')}</th>
                <th>{t('rules.batch_compatibility_option_omitted')}</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(summary => (
                <tr key={summary.format}>
                  <th scope="row">{t(`export.formats.${summary.format}`)}</th>
                  <td>{summary.full}</td>
                  <td className={summary.convert > 0 ? styles.countConvert : undefined}>{summary.convert}</td>
                  <td className={summary.partial > 0 ? styles.countPartial : undefined}>{summary.partial}</td>
                  <td className={summary.unsupported > 0 ? styles.countUnsupported : undefined}>{summary.unsupported}</td>
                  <td className={summary.optionOmitted > 0 ? styles.countPartial : undefined}>{summary.optionOmitted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invalidCount > 0 && (
        <div className={styles.batchCompatibilityInvalid}>
          {t('rules.batch_compatibility_invalid_hint', { count: invalidCount })}
        </div>
      )}
    </section>
  )
}

function RuleCompatibilityPreview({
  type,
  payload,
  noResolve,
}: {
  type: RuleType
  payload: string
  noResolve: boolean
}) {
  const { t } = useTranslation()
  const preview = useMemo(() => {
    const validation = validateAndNormalizeRulePayload(type, payload)
    if (!validation.valid) return null
    return RULE_COMPATIBILITY_TARGETS.map(format => {
      const resolution = resolveRuleForExport(type, validation.payload, format)
      const noResolveHandling = noResolve
        ? getRuleNoResolveHandling(type, format)
        : null
      const noResolveOmitted = noResolveHandling === 'omit'
      return {
        format,
        resolution,
        noResolveOmitted,
        noResolveImplicit: noResolveHandling === 'implicit',
        noResolveNative: noResolveHandling === 'native',
        displayLevel: noResolveOmitted && resolution.level === 'full'
          ? 'partial' as const
          : resolution.level,
      }
    })
  }, [noResolve, payload, type])

  if (!preview || !payload.trim()) return null

  return (
    <details className={styles.compatibilityPreview}>
      <summary id="manual-rule-compatibility-title">{t('rules.compatibility_preview_title')}</summary>
      <div className={styles.compatibilityHeader}>
        <span>{t('rules.compatibility_preview_desc')}</span>
      </div>
      <div className={styles.compatibilityGrid}>
        {preview.map(item => {
          const source = formatRuleExpression(
            type,
            payload.trim(),
            noResolve,
          )
          const target = item.resolution.level === 'unsupported'
            ? t('rules.compatibility_not_exported')
            : formatRuleExpression(
                item.resolution.type,
                item.resolution.payload,
                noResolve && item.noResolveNative,
              )
          return (
            <article
              key={item.format}
              className={`${styles.compatibilityItem} ${styles[item.displayLevel]}`}
              aria-label={t('rules.compatibility_client_result', {
                client: t(`export.formats.${item.format}`),
                result: t(`rules.compat_${item.displayLevel}`),
              })}
            >
              <div className={styles.compatibilityItemHeader}>
                <strong>{t(`export.formats.${item.format}`)}</strong>
                <span>{t(`rules.compat_${item.displayLevel}`)}</span>
              </div>
              <code>
                {source}
                {(item.resolution.level === 'convert'
                  || item.resolution.level === 'unsupported'
                  || item.noResolveOmitted
                  || item.noResolveImplicit) && (
                  <> → {target}</>
                )}
              </code>
              {item.noResolveOmitted && (
                <small>{t('rules.compatibility_no_resolve_omitted')}</small>
              )}
              {item.noResolveImplicit && (
                <small>{t('rules.compatibility_no_resolve_implicit')}</small>
              )}
            </article>
          )
        })}
      </div>
    </details>
  )
}

function formatRuleExpression(type: string, payload: string, noResolve = false): string {
  return [
    type,
    ...(payload ? [payload] : []),
    ...(noResolve ? ['no-resolve'] : []),
  ].join(',')
}

function setFormValue<K extends keyof ManualRuleForm>(
  key: K,
  value: ManualRuleForm[K],
  setForm: React.Dispatch<React.SetStateAction<ManualRuleForm>>
) {
  setForm(current => ({ ...current, [key]: value }))
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
