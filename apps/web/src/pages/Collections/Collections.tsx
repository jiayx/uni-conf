import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { Badge } from '@/components/ui/Badge/Badge'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { useCollectionsStore } from '@/store/collections.store'
import { useNodesStore } from '@/store/nodes.store'
import { useSourcesStore } from '@/store/sources.store'
import type {
  DedupStrategy,
  FilterOperator,
  NodeCollection,
  NodeFilter,
  NodeRename,
  ProxyNode,
  SortStrategy,
} from '@uni-conf/types'
import styles from './Collections.module.css'

type CollectionForm = Omit<NodeCollection, 'id' | 'createdAt' | 'updatedAt'>

const FILTER_FIELDS: Array<{ value: NodeFilter['field']; label: string }> = [
  { value: 'name', label: '名称' },
  { value: 'server', label: '服务器' },
  { value: 'protocol', label: '协议' },
  { value: 'country', label: '地区' },
  { value: 'countryCode', label: '地区代码' },
  { value: 'tag', label: '标签' },
  { value: 'sourceId', label: '来源 ID' },
]

const FILTER_OPERATORS: Array<{ value: FilterOperator; label: string }> = [
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'regex', label: '正则匹配' },
  { value: 'not_regex', label: '正则不匹配' },
  { value: 'in', label: '包含于列表' },
  { value: 'not_in', label: '不包含于列表' },
]

const DEDUP_OPTIONS: Array<{ value: DedupStrategy; labelKey: string }> = [
  { value: 'name', labelKey: 'collections.dedup_name' },
  { value: 'server_port', labelKey: 'collections.dedup_server_port' },
  { value: 'protocol_server_port', labelKey: 'collections.dedup_protocol_server_port' },
  { value: 'full_config', labelKey: 'collections.dedup_full_config' },
]

const SORT_OPTIONS: Array<{ value: SortStrategy; labelKey: string }> = [
  { value: 'country', labelKey: 'collections.sort_country' },
  { value: 'name', labelKey: 'collections.sort_name' },
  { value: 'source', labelKey: 'collections.sort_source' },
  { value: 'protocol', labelKey: 'collections.sort_protocol' },
  { value: 'manual', labelKey: 'collections.sort_manual' },
]

const RENAME_TYPES: Array<{ value: NodeRename['type']; label: string }> = [
  { value: 'replace', label: '文本替换' },
  { value: 'regex', label: '正则替换' },
  { value: 'prefix', label: '添加前缀' },
  { value: 'suffix', label: '添加后缀' },
  { value: 'strip_emoji', label: '去除 Emoji' },
  { value: 'standardize_country', label: '地区名称标准化' },
  { value: 'auto_number', label: '重复名称编号' },
]

function createEmptyForm(): CollectionForm {
  return {
    name: '',
    sourceIds: [],
    nodeIds: [],
    filters: [],
    renames: [],
    dedup: 'name',
    sort: 'country',
    sortCountryOrder: [],
    enabled: true,
    notes: '',
  }
}

export function Collections() {
  const { t } = useTranslation()
  const {
    collections,
    previews,
    loading,
    fetchCollections,
    addCollection,
    updateCollection,
    deleteCollection,
    previewCollection,
  } = useCollectionsStore()
  const { nodes, fetchNodes } = useNodesStore()
  const { sources, fetchSources } = useSourcesStore()
  const [showModal, setShowModal] = useState(false)
  const [editingCollection, setEditingCollection] = useState<NodeCollection | null>(null)
  const [form, setForm] = useState<CollectionForm>(createEmptyForm)
  const [formError, setFormError] = useState('')
  const [previewingId, setPreviewingId] = useState<string | null>(null)

  useEffect(() => {
    void fetchCollections()
    void fetchSources()
    void fetchNodes()
  }, [fetchCollections, fetchNodes, fetchSources])

  const sourceOptions = useMemo(
    () => sources.map(source => ({ id: source.id, label: `${source.name} (${source.nodeCount})` })),
    [sources]
  )
  const nodeOptions = useMemo(
    () => nodes.map(node => ({ id: node.id, label: `${node.name} · ${node.protocol.toUpperCase()}` })),
    [nodes]
  )

  const openCreate = () => {
    setEditingCollection(null)
    setForm(createEmptyForm())
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (collection: NodeCollection) => {
    setEditingCollection(collection)
    setForm({
      name: collection.name,
      sourceIds: collection.sourceIds,
      nodeIds: collection.nodeIds,
      filters: collection.filters,
      renames: collection.renames,
      dedup: collection.dedup,
      sort: collection.sort,
      sortCountryOrder: collection.sortCountryOrder ?? [],
      enabled: collection.enabled,
      notes: collection.notes ?? '',
    })
    setFormError('')
    setShowModal(true)
  }

  const handleSave = async () => {
    const payload: CollectionForm = {
      ...form,
      name: form.name.trim(),
      notes: form.notes?.trim() || undefined,
      filters: form.filters.map(filter => ({
        ...filter,
        value: normalizeListValue(filter.operator, filter.value),
      })),
    }

    if (!payload.name) {
      setFormError('name is required')
      return
    }

    if (editingCollection) {
      await updateCollection(editingCollection.id, payload)
    } else {
      await addCollection(payload)
    }

    setShowModal(false)
    setEditingCollection(null)
    setForm(createEmptyForm())
  }

  const handlePreview = async (id: string) => {
    setPreviewingId(id)
    try {
      await previewCollection(id)
    } finally {
      setPreviewingId(null)
    }
  }

  const addFilter = () => {
    setForm(current => ({
      ...current,
      filters: [
        ...current.filters,
        { id: `filter-${Date.now()}`, field: 'name', operator: 'contains', value: '', enabled: true },
      ],
    }))
  }

  const addRename = () => {
    setForm(current => ({
      ...current,
      renames: [
        ...current.renames,
        { id: `rename-${Date.now()}`, type: 'replace', pattern: '', replacement: '', enabled: true, order: current.renames.length },
      ],
    }))
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('collections.title')}
        description={`${t('common.total', { count: collections.length })}`}
        actions={<Button onClick={openCreate} icon={<PlusIcon />}>{t('collections.new')}</Button>}
      />
      {loading && collections.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : collections.length === 0 ? (
        <EmptyState
          title="暂无节点组合"
          description="节点组合用于对订阅节点进行过滤、重命名、去重和排序"
          action={{ label: t('collections.new'), onClick: openCreate }}
        />
      ) : (
        <div className={styles.grid}>
          {collections.map(collection => (
            <Card key={collection.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>{collection.name}</div>
                  {collection.notes && <div className={styles.cardNotes}>{collection.notes}</div>}
                </div>
                <Badge variant={collection.enabled ? 'success' : 'default'}>
                  {collection.enabled ? t('common.enabled') : t('common.disabled')}
                </Badge>
              </div>

              <div className={styles.cardMeta}>
                <Badge variant="info">{scopeText(collection)}</Badge>
                <Badge variant="default">{sortLabel(collection.sort)}</Badge>
                <Badge variant="default">{dedupLabel(collection.dedup)}</Badge>
                {collection.filters.length > 0 && <Badge variant="warning">{collection.filters.length} 过滤</Badge>}
                {collection.renames.length > 0 && <Badge variant="purple">{collection.renames.length} 重命名</Badge>}
              </div>

              {previews[collection.id] && <PreviewList nodes={previews[collection.id]} />}

              <div className={styles.cardActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={previewingId === collection.id}
                  onClick={() => void handlePreview(collection.id)}
                >
                  {t('collections.preview')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(collection)}>
                  {t('common.edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { if (confirm('删除此节点组合？')) void deleteCollection(collection.id) }}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editingCollection ? t('common.edit') : t('collections.new')}
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
          <Input label={t('common.name')} value={form.name} onChange={e => setFormValue('name', e.target.value, setForm)} />
          <div>
            <label className={styles.selectLabel}>{t('collections.dedup')}</label>
            <select className={styles.select} value={form.dedup} onChange={e => setFormValue('dedup', e.target.value as DedupStrategy, setForm)}>
              {DEDUP_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
            </select>
          </div>
          <div>
            <label className={styles.selectLabel}>{t('collections.sort')}</label>
            <select className={styles.select} value={form.sort} onChange={e => setFormValue('sort', e.target.value as SortStrategy, setForm)}>
              {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
            </select>
          </div>
          <Input label={t('common.notes')} value={form.notes ?? ''} onChange={e => setFormValue('notes', e.target.value, setForm)} />
        </div>

        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={form.enabled} onChange={e => setFormValue('enabled', e.target.checked, setForm)} />
          <span>{t('common.enabled')}</span>
        </label>

        <MultiSelect
          label={t('collections.sources')}
          emptyText={t('collections.all_sources')}
          options={sourceOptions}
          value={form.sourceIds}
          onChange={sourceIds => setForm(current => ({ ...current, sourceIds }))}
        />

        <MultiSelect
          label="指定节点"
          emptyText="不指定，按来源和过滤规则选择"
          options={nodeOptions}
          value={form.nodeIds}
          onChange={nodeIds => setForm(current => ({ ...current, nodeIds }))}
        />

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>{t('collections.filters')}</span>
            <Button type="button" variant="secondary" size="sm" onClick={addFilter}>{t('collections.add_filter')}</Button>
          </div>
          {form.filters.length === 0 ? (
            <div className={styles.inlineEmpty}>不过滤节点</div>
          ) : form.filters.map(filter => (
            <FilterRow
              key={filter.id}
              filter={filter}
              onChange={next => setForm(current => ({
                ...current,
                filters: current.filters.map(item => (item.id === filter.id ? next : item)),
              }))}
              onRemove={() => setForm(current => ({
                ...current,
                filters: current.filters.filter(item => item.id !== filter.id),
              }))}
            />
          ))}
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>{t('collections.renames')}</span>
            <Button type="button" variant="secondary" size="sm" onClick={addRename}>{t('collections.add_rename')}</Button>
          </div>
          {form.renames.length === 0 ? (
            <div className={styles.inlineEmpty}>不重命名节点</div>
          ) : form.renames.map(rename => (
            <RenameRow
              key={rename.id}
              rename={rename}
              onChange={next => setForm(current => ({
                ...current,
                renames: current.renames.map(item => (item.id === rename.id ? next : item)),
              }))}
              onRemove={() => setForm(current => ({
                ...current,
                renames: current.renames.filter(item => item.id !== rename.id).map((item, index) => ({ ...item, order: index })),
              }))}
            />
          ))}
        </div>
      </Modal>
    </div>
  )
}

function FilterRow({ filter, onChange, onRemove }: {
  filter: NodeFilter
  onChange: (filter: NodeFilter) => void
  onRemove: () => void
}) {
  const value = Array.isArray(filter.value) ? filter.value.join(', ') : filter.value

  return (
    <div className={styles.ruleRow}>
      <label className={styles.ruleToggle}>
        <input type="checkbox" checked={filter.enabled} onChange={e => onChange({ ...filter, enabled: e.target.checked })} />
      </label>
      <select className={styles.select} value={filter.field} onChange={e => onChange({ ...filter, field: e.target.value as NodeFilter['field'] })}>
        {FILTER_FIELDS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select className={styles.select} value={filter.operator} onChange={e => onChange({ ...filter, operator: e.target.value as FilterOperator })}>
        {FILTER_OPERATORS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <input className={styles.textInput} value={value} onChange={e => onChange({ ...filter, value: e.target.value })} placeholder="value" />
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>删除</Button>
    </div>
  )
}

function RenameRow({ rename, onChange, onRemove }: {
  rename: NodeRename
  onChange: (rename: NodeRename) => void
  onRemove: () => void
}) {
  const needsPattern = rename.type === 'replace' || rename.type === 'regex'
  const needsReplacement = rename.type !== 'strip_emoji' && rename.type !== 'standardize_country' && rename.type !== 'auto_number'

  return (
    <div className={styles.ruleRow}>
      <label className={styles.ruleToggle}>
        <input type="checkbox" checked={rename.enabled} onChange={e => onChange({ ...rename, enabled: e.target.checked })} />
      </label>
      <select className={styles.select} value={rename.type} onChange={e => onChange({ ...rename, type: e.target.value as NodeRename['type'] })}>
        {RENAME_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <input
        className={styles.textInput}
        value={rename.pattern ?? ''}
        onChange={e => onChange({ ...rename, pattern: e.target.value })}
        placeholder={needsPattern ? 'pattern' : '不需要'}
        disabled={!needsPattern}
      />
      <input
        className={styles.textInput}
        value={rename.replacement ?? ''}
        onChange={e => onChange({ ...rename, replacement: e.target.value })}
        placeholder={needsReplacement ? 'replacement' : '不需要'}
        disabled={!needsReplacement}
      />
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>删除</Button>
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
        {value.length > 0 && <button type="button" className={styles.clearButton} onClick={() => onChange([])}>全部</button>}
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

function PreviewList({ nodes }: { nodes: ProxyNode[] }) {
  return (
    <div className={styles.preview}>
      <div className={styles.previewHeader}>预览：{nodes.length} 个节点</div>
      <div className={styles.previewList}>
        {nodes.slice(0, 8).map(node => (
          <span key={node.id} className={styles.previewNode}>{node.name}</span>
        ))}
        {nodes.length > 8 && <span className={styles.previewMore}>+{nodes.length - 8}</span>}
      </div>
    </div>
  )
}

function setFormValue<K extends keyof CollectionForm>(
  key: K,
  value: CollectionForm[K],
  setForm: React.Dispatch<React.SetStateAction<CollectionForm>>
) {
  setForm(current => ({ ...current, [key]: value }))
}

function normalizeListValue(operator: FilterOperator, value: NodeFilter['value']): NodeFilter['value'] {
  if (operator !== 'in' && operator !== 'not_in') return value
  const raw = Array.isArray(value) ? value.join(',') : value
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function scopeText(collection: NodeCollection): string {
  if (collection.nodeIds.length > 0) return `${collection.nodeIds.length} 指定节点`
  return collection.sourceIds.length === 0 ? '全部来源' : `${collection.sourceIds.length} 个来源`
}

function sortLabel(sort: SortStrategy): string {
  return `排序: ${sort}`
}

function dedupLabel(dedup: DedupStrategy): string {
  return `去重: ${dedup}`
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
