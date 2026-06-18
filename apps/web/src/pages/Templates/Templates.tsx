import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { api, type RuleTemplateSummary } from '@/lib/api'
import { useGroupsStore } from '@/store/groups.store'
import { useRulesStore } from '@/store/rules.store'
import styles from './Templates.module.css'

const CATEGORY_ORDER = ['ai', 'streaming', 'social', 'china', 'security'] as const

export function Templates() {
  const { t, i18n } = useTranslation()
  const { fetchGroups, groups } = useGroupsStore()
  const { fetchRules } = useRulesStore()
  const [templates, setTemplates] = useState<RuleTemplateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('ai')
  const [importModal, setImportModal] = useState<RuleTemplateSummary | null>(null)
  const [targetGroupId, setTargetGroupId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.templates.list()
      setTemplates(result)
      if (result.length > 0 && !result.some(template => template.category === activeCategory)) {
        setActiveCategory(result[0].category)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeCategory])

  useEffect(() => {
    let cancelled = false
    api.templates.list()
      .then(result => {
        if (cancelled) return
        setTemplates(result)
        if (result.length > 0 && !result.some(template => template.category === activeCategory)) {
          setActiveCategory(result[0].category)
        }
      })
      .catch(e => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    void fetchGroups()
    return () => { cancelled = true }
  }, [activeCategory, fetchGroups])

  const categories = useMemo(() => {
    const seen = new Set(templates.map(template => template.category))
    return CATEGORY_ORDER.filter(category => seen.has(category))
  }, [templates])

  const filtered = templates.filter(template => template.category === activeCategory)
  const isEnglish = i18n.language.startsWith('en')

  const openImport = (template: RuleTemplateSummary) => {
    const suggested = groups.find(group => group.name === template.suggestedGroupName)
    setTargetGroupId(suggested?.id ?? groups.find(group => group.name === 'PROXY')?.id ?? groups[0]?.id ?? '')
    setImportResult('')
    setImportModal(template)
  }

  const handleImport = async () => {
    if (!importModal || !targetGroupId) return
    setImporting(true)
    setImportResult('')
    try {
      const result = await api.templates.importTemplate(importModal.id, targetGroupId)
      await fetchRules()
      setImportResult(`已导入 ${result.rules.length} 条规则${result.remoteSets.length > 0 ? `，${result.remoteSets.length} 个远程规则集` : ''}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('templates.title')}
        actions={<Button variant="secondary" onClick={() => void loadTemplates()} loading={loading}>{t('common.refresh')}</Button>}
      />

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.tabs}>
        {categories.map(category => (
          <button
            key={category}
            className={`${styles.tab} ${activeCategory === category ? styles.active : ''}`}
            onClick={() => setActiveCategory(category)}
          >
            {t(`templates.category_${category}`)}
          </button>
        ))}
      </div>

      {loading && templates.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="暂无模板" description="后端模板列表为空或加载失败" />
      ) : (
        <div className={styles.grid}>
          {filtered.map(template => (
            <Card key={template.id} className={styles.tplCard}>
              <div className={styles.tplHeader}>
                <div>
                  <div className={styles.tplName}>{isEnglish ? template.nameEn : template.name}</div>
                  <div className={styles.tplDesc}>{isEnglish ? template.descriptionEn : template.description}</div>
                </div>
                <div className={styles.badges}>
                  <Badge variant="info">{template.ruleCount} 条规则</Badge>
                  {template.hasRemoteSets && <Badge variant="warning">远程集</Badge>}
                </div>
              </div>
              <div className={styles.tplMeta}>
                {template.suggestedGroupName && <span>建议策略组：{template.suggestedGroupName}</span>}
                {template.isBuiltin && <span>内置模板</span>}
              </div>
              <Button size="sm" variant="secondary" onClick={() => openImport(template)}>
                {t('templates.import')}
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!importModal}
        onOpenChange={open => {
          if (!open) {
            setImportModal(null)
            setImportResult('')
          }
        }}
        title={t('templates.import')}
        description={importModal ? `将导入 ${importModal.ruleCount} 条规则${importModal.hasRemoteSets ? '，包含远程规则集' : ''}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportModal(null)}>{t('common.cancel')}</Button>
            <Button loading={importing} disabled={!targetGroupId} onClick={() => void handleImport()}>{t('common.confirm')}</Button>
          </>
        }
      >
        {importResult && <div className={styles.importResult}>{importResult}</div>}
        <div>
          <label className={styles.selectLabel}>{t('templates.select_group')}</label>
          <select className={styles.select} value={targetGroupId} onChange={e => setTargetGroupId(e.target.value)}>
            <option value="">-- 选择策略组 --</option>
            {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </div>
      </Modal>
    </div>
  )
}
