import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { useRulesStore } from '@/store/rules.store'
import { useGroupsStore } from '@/store/groups.store'
import type { RuleType } from '@uni-conf/types'
import styles from './Rules.module.css'

const RULE_TYPES: RuleType[] = ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'GEOIP', 'GEOSITE', 'RULE-SET', 'PROCESS-NAME', 'MATCH']

export function Rules() {
  const { t } = useTranslation()
  const { rules, loading, fetchRules, addRule, deleteRule } = useRulesStore()
  const { groups, fetchGroups } = useGroupsStore()
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ type: 'DOMAIN-SUFFIX' as RuleType, payload: '', targetGroupId: '', noResolve: false, notes: '' })

  useEffect(() => { void fetchRules(); void fetchGroups() }, [fetchRules, fetchGroups])

  const handleAdd = async () => {
    if (!form.payload || !form.targetGroupId) return
    await addRule({ type: form.type, payload: form.payload, targetGroupId: form.targetGroupId, noResolve: form.noResolve, enabled: true, order: rules.length, compatibility: [], notes: form.notes })
    setShowModal(false); setForm({ type: 'DOMAIN-SUFFIX', payload: '', targetGroupId: '', noResolve: false, notes: '' })
  }

  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name ?? id

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('rules.title')}
        description={t('rules.reorder_hint')}
        actions={<Button onClick={() => setShowModal(true)} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>{t('rules.new')}</Button>}
      />
      {loading ? <div className={styles.loading}>{t('common.loading')}</div> : rules.length === 0 ? (
        <EmptyState title="暂无规则" description="添加规则或从模板导入" action={{ label: t('rules.new'), onClick: () => setShowModal(true) }} />
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead><tr>
              <th>#</th><th>{t('rules.type')}</th><th>{t('rules.payload')}</th>
              <th>{t('rules.target')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th>
            </tr></thead>
            <tbody>
              {rules.map((rule, i) => (
                <tr key={rule.id} className={styles.row}>
                  <td className={styles.orderNum}>{i + 1}</td>
                  <td><Badge variant="info">{rule.type}</Badge></td>
                  <td className={styles.payload}>{rule.payload}</td>
                  <td><Badge variant="purple">{getGroupName(rule.targetGroupId)}</Badge></td>
                  <td><Badge variant={rule.enabled ? 'success' : 'default'}>{rule.enabled ? t('common.enabled') : t('common.disabled')}</Badge></td>
                  <td>
                    <Button variant="ghost" size="sm" onClick={() => { if (confirm('删除此规则？')) void deleteRule(rule.id) }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={showModal} onOpenChange={setShowModal} title={t('rules.new')}
        footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button><Button onClick={() => void handleAdd()}>{t('common.save')}</Button></>}>
        <div>
          <label className={styles.label}>{t('rules.type')}</label>
          <select className={styles.select} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as RuleType }))}>
            {RULE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Input label={t('rules.payload')} value={form.payload} onChange={e => setForm(f => ({ ...f, payload: e.target.value }))} placeholder="example.com" />
        <div>
          <label className={styles.label}>{t('rules.target')}</label>
          <select className={styles.select} value={form.targetGroupId} onChange={e => setForm(f => ({ ...f, targetGroupId: e.target.value }))}>
            <option value="">-- {t('rules.target')} --</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={form.noResolve} onChange={e => setForm(f => ({ ...f, noResolve: e.target.checked }))} />
          {t('rules.no_resolve')}
        </label>
        <Input label={t('common.notes')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </Modal>
    </div>
  )
}
