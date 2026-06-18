import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { useRulesStore } from '@/store/rules.store'
import { useGroupsStore } from '@/store/groups.store'
import { BUILTIN_TEMPLATES } from '@/core/templates'
import styles from './Templates.module.css'

const CATEGORIES = ['ai', 'streaming', 'social', 'china', 'security'] as const

export function Templates() {
  const { t } = useTranslation()
  const { fetchGroups, groups } = useGroupsStore()
  const { addRule, fetchRules } = useRulesStore()
  const [activeCategory, setActiveCategory] = useState<string>('ai')
  const [importModal, setImportModal] = useState<string | null>(null)
  const [targetGroupId, setTargetGroupId] = useState('')
  const [importing, setImporting] = useState(false)

  const filtered = BUILTIN_TEMPLATES.filter(t => t.category === activeCategory)

  const handleImport = async () => {
    const tpl = BUILTIN_TEMPLATES.find(t => t.id === importModal)
    if (!tpl || !targetGroupId) return
    setImporting(true)
    try {
      await Promise.all(
        tpl.rules.map((rule, i) =>
          addRule({
            ...rule,
            targetGroupId,
            order: i,
          })
        )
      )
      await fetchRules()
      setImportModal(null); setTargetGroupId('')
    } finally { setImporting(false) }
  }

  const selectedTpl = BUILTIN_TEMPLATES.find(t => t.id === importModal)

  return (
    <div className={styles.page}>
      <PageHeader title={t('templates.title')} />
      <div className={styles.tabs}>
        {CATEGORIES.map(cat => (
          <button key={cat} className={`${styles.tab} ${activeCategory === cat ? styles.active : ''}`} onClick={() => setActiveCategory(cat)}>
            {t(`templates.category_${cat}`)}
          </button>
        ))}
      </div>
      <div className={styles.grid}>
        {filtered.map(tpl => (
          <Card key={tpl.id} className={styles.tplCard}>
            <div className={styles.tplHeader}>
              <div>
                <div className={styles.tplName}>{tpl.name}</div>
                <div className={styles.tplDesc}>{tpl.description}</div>
              </div>
              <Badge variant="info">{tpl.rules.length} 条规则</Badge>
            </div>
            <div className={styles.tplRules}>
              {tpl.rules.slice(0, 4).map((r, i) => (
                <span key={i} className={styles.ruleChip}>{r.payload}</span>
              ))}
              {tpl.rules.length > 4 && <span className={styles.ruleChip}>+{tpl.rules.length - 4}</span>}
            </div>
            <Button
              size="sm" variant="secondary"
              onClick={() => { void fetchGroups(); setImportModal(tpl.id) }}
            >
              {t('templates.import')}
            </Button>
          </Card>
        ))}
      </div>
      <Modal open={!!importModal} onOpenChange={open => !open && setImportModal(null)}
        title={t('templates.import')}
        description={selectedTpl ? `将导入 ${selectedTpl.rules.length} 条规则` : undefined}
        footer={<><Button variant="secondary" onClick={() => setImportModal(null)}>{t('common.cancel')}</Button><Button loading={importing} onClick={() => void handleImport()}>{t('common.confirm')}</Button></>}>
        <div>
          <label className={styles.selectLabel}>{t('templates.select_group')}</label>
          <select className={styles.select} value={targetGroupId} onChange={e => setTargetGroupId(e.target.value)}>
            <option value="">-- 选择策略组 --</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </Modal>
    </div>
  )
}
