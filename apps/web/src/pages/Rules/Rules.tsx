import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { isRuleTargetGroup } from '@/core/groups/rule-target-groups'
import { useRulesStore } from '@/store/rules.store'
import { useGroupsStore } from '@/store/groups.store'
import { MANUAL_RULE_TYPES, parseManualRules, type ManualRuleForm } from '@/core/rules/manual-rules'
import type { ProxyRule, RuleType } from '@uni-conf/types'
import styles from './Rules.module.css'

type RuleForm = ManualRuleForm

function createEmptyForm(order: number, targetGroupId = ''): RuleForm {
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
  const {
    rules,
    loading,
    fetchRules,
    addRule,
    updateRule,
    deleteRule,
    reorderRules,
    batchAddRules,
  } = useRulesStore()
  const { groups, fetchGroups } = useGroupsStore()
  const [showModal, setShowModal] = useState(false)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [editingRule, setEditingRule] = useState<ProxyRule | null>(null)
  const [form, setForm] = useState<RuleForm>(() => createEmptyForm(0))
  const [batchText, setBatchText] = useState('')
  const [batchTargetGroupId, setBatchTargetGroupId] = useState('')
  const [formError, setFormError] = useState('')
  const [batchError, setBatchError] = useState('')

  useEffect(() => {
    void fetchRules()
    void fetchGroups()
  }, [fetchRules, fetchGroups])

  const ruleTargetGroups = groups.filter(isRuleTargetGroup)
  const enabledGroups = ruleTargetGroups.filter(group => group.enabled)
  const targetGroups = enabledGroups.length > 0 ? enabledGroups : ruleTargetGroups
  const defaultTargetGroupId = targetGroups.find(group => group.name === 'PROXY')?.id ?? targetGroups[0]?.id ?? ''

  const openCreate = () => {
    setEditingRule(null)
    setForm(createEmptyForm(rules.length, defaultTargetGroupId))
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (rule: ProxyRule) => {
    setEditingRule(rule)
    setForm({
      name: rule.name ?? '',
      type: rule.type,
      payload: rule.payload,
      targetGroupId: rule.targetGroupId,
      noResolve: rule.noResolve ?? false,
      enabled: rule.enabled,
      order: rule.order,
      compatibility: rule.compatibility,
      notes: rule.notes ?? '',
    })
    setFormError('')
    setShowModal(true)
  }

  const openBatch = () => {
    setBatchTargetGroupId(defaultTargetGroupId)
    setBatchText('')
    setBatchError('')
    setShowBatchModal(true)
  }

  const handleSave = async () => {
    const payload: RuleForm = {
      ...form,
      name: form.name?.trim() || undefined,
      payload: normalizePayload(form.type, form.payload),
      notes: form.notes?.trim() || undefined,
    }

    if (payload.type !== 'MATCH' && !payload.payload) {
      setFormError('payload is required')
      return
    }
    if (!payload.targetGroupId) {
      setFormError('target group is required')
      return
    }

    if (editingRule) {
      await updateRule(editingRule.id, payload)
    } else {
      await addRule(payload)
    }

    setShowModal(false)
    setEditingRule(null)
    setForm(createEmptyForm(rules.length, defaultTargetGroupId))
  }

  const handleBatchImport = async () => {
    if (!batchTargetGroupId) {
      setBatchError('target group is required')
      return
    }

    const parsed = parseManualRules(batchText, batchTargetGroupId, targetGroups, rules.length)
    if (parsed.length === 0) {
      setBatchError('no valid rules found')
      return
    }

    await batchAddRules(parsed)
    setShowBatchModal(false)
    setBatchText('')
  }

  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= rules.length) return
    const ordered = [...rules]
    const [item] = ordered.splice(index, 1)
    ordered.splice(target, 0, item)
    void reorderRules(ordered.map(rule => rule.id))
  }

  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name ?? id

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('rules.title')}
        description={t('rules.reorder_hint')}
        actions={
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={openBatch}>批量添加自定义规则</Button>
            <Button onClick={openCreate} icon={<PlusIcon />}>{t('rules.new')}</Button>
          </div>
        }
      />
      {loading && rules.length === 0 ? <div className={styles.loading}>{t('common.loading')}</div> : rules.length === 0 ? (
        <EmptyState
          title="暂无自定义分流规则"
          description="通常不需要添加自定义规则；默认分流由「分流策略」里的预置规则集生成。"
          action={{ label: t('rules.new'), onClick: openCreate }}
        />
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead><tr>
              <th>#</th>
              <th>{t('rules.type')}</th>
              <th>{t('rules.payload')}</th>
              <th>{t('rules.target')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.actions')}</th>
            </tr></thead>
            <tbody>
              {rules.map((rule, index) => (
                <tr key={rule.id} className={styles.row}>
                  <td className={styles.orderNum}>
                    <div className={styles.orderCell}>
                      <span>{index + 1}</span>
                      <div className={styles.orderControls}>
                        <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveRule(index, -1)} title="上移"><ArrowUpIcon /></Button>
                        <Button variant="ghost" size="sm" disabled={index === rules.length - 1} onClick={() => moveRule(index, 1)} title="下移"><ArrowDownIcon /></Button>
                      </div>
                    </div>
                  </td>
                  <td><Badge variant="info">{rule.type}</Badge></td>
                  <td className={styles.payload}>
                    {rule.payload || 'MATCH'}
                    {rule.name && <div className={styles.ruleName}>{rule.name}</div>}
                    {rule.notes && <div className={styles.ruleNotes}>{rule.notes}</div>}
                  </td>
                  <td><Badge variant="purple">{getGroupName(rule.targetGroupId)}</Badge></td>
                  <td>
                    <Badge variant={rule.enabled ? 'success' : 'default'}>
                      {rule.enabled ? t('common.enabled') : t('common.disabled')}
                    </Badge>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <Button variant="ghost" size="sm" onClick={() => void updateRule(rule.id, { enabled: !rule.enabled })}>
                        {rule.enabled ? t('common.disable') : t('common.enable')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>
                        {t('common.edit')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm('删除此规则？')) void deleteRule(rule.id) }}>
                        <TrashIcon />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editingRule ? '编辑自定义规则' : t('rules.new')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void handleSave()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError && <div className={styles.formError}>{formError}</div>}
        <Input label={t('rules.name_optional')} value={form.name ?? ''} onChange={e => setFormValue('name', e.target.value, setForm)} />
        <div>
          <label className={styles.label}>{t('rules.type')}</label>
          <select className={styles.select} value={form.type} onChange={e => setForm(current => ({
            ...current,
            type: e.target.value as RuleType,
            payload: e.target.value === 'MATCH' ? '' : current.payload,
          }))}>
            {MANUAL_RULE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>
        <Input
          label={t('rules.payload')}
          value={form.payload}
          onChange={e => setFormValue('payload', e.target.value, setForm)}
          placeholder={form.type === 'MATCH' ? 'MATCH' : t('rules.payload_placeholder')}
          disabled={form.type === 'MATCH'}
        />
        <div>
          <label className={styles.label}>{t('rules.target')}</label>
          <select className={styles.select} value={form.targetGroupId} onChange={e => setFormValue('targetGroupId', e.target.value, setForm)}>
            <option value="">-- {t('rules.target')} --</option>
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
        <Input label={t('common.notes')} value={form.notes ?? ''} onChange={e => setFormValue('notes', e.target.value, setForm)} />
      </Modal>

      <Modal
        open={showBatchModal}
        onOpenChange={setShowBatchModal}
        title="批量添加自定义规则"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowBatchModal(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void handleBatchImport()}>{t('common.save')}</Button>
          </>
        }
      >
        {batchError && <div className={styles.formError}>{batchError}</div>}
        <div>
          <label className={styles.label}>{t('rules.target')}</label>
          <select className={styles.select} value={batchTargetGroupId} onChange={e => setBatchTargetGroupId(e.target.value)}>
            <option value="">-- {t('rules.target')} --</option>
            {targetGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <label className={styles.label}>规则文本</label>
          <textarea
            className={styles.textarea}
            value={batchText}
            onChange={e => setBatchText(e.target.value)}
            placeholder="DOMAIN-SUFFIX,example.com,PROXY&#10;DOMAIN,api.example.com&#10;IP-CIDR,10.0.0.0/8,no-resolve"
          />
        </div>
        <div className={styles.helpText}>
          支持 Clash 行格式；匹配后使用的策略组可省略，省略时使用上方选择的策略组。普通分流优先使用「分流策略」里的预置规则集。
        </div>
      </Modal>
    </div>
  )
}

function setFormValue<K extends keyof RuleForm>(
  key: K,
  value: RuleForm[K],
  setForm: React.Dispatch<React.SetStateAction<RuleForm>>
) {
  setForm(current => ({ ...current, [key]: value }))
}

function normalizePayload(type: RuleType, payload: string): string {
  return type === 'MATCH' ? '' : payload.trim()
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
