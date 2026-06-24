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
import { useGroupsStore } from '@/store/groups.store'
import { useNodesStore } from '@/store/nodes.store'
import { useSourcesStore } from '@/store/sources.store'
import { useSettingsStore } from '@/store/settings.store'
import { api } from '@/lib/api'
import { AUTO_NODE_GROUP_PREFIX, DEFAULT_HEALTH_CHECK } from '@uni-conf/shared'
import type {
  DedupStrategy,
  FilterOperator,
  GroupType,
  NodeCollection,
  NodeFilter,
  NodeRename,
  ProxyNode,
  ProxySource,
  SourceNodeGroup,
  SortStrategy,
} from '@uni-conf/types'
import styles from './Collections.module.css'

type CollectionForm = Omit<NodeCollection, 'id' | 'createdAt' | 'updatedAt'>
type GeneratedGroupType = Extract<GroupType, 'select' | 'url-test' | 'fallback'>

const GENERATED_GROUP_TYPES: Array<{ value: GeneratedGroupType; label: string; suffix: string }> = [
  { value: 'select', label: '手动选择', suffix: 'Select' },
  { value: 'url-test', label: '自动测速', suffix: 'Auto' },
  { value: 'fallback', label: '故障转移', suffix: 'Fallback' },
]
const SOURCE_NODE_GROUP_PREFIX = '[uni-conf:source-node-group]'

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
    deleteCollection,
    previewCollection,
  } = useCollectionsStore()
  const { groups, fetchGroups } = useGroupsStore()
  const { nodes, fetchNodes } = useNodesStore()
  const { sources, fetchSources } = useSourcesStore()
  const { applySettings } = useSettingsStore()
  const [showModal, setShowModal] = useState(false)
  const [editingCollection, setEditingCollection] = useState<NodeCollection | null>(null)
  const [form, setForm] = useState<CollectionForm>(createEmptyForm)
  const [formError, setFormError] = useState('')
  const [loadingPreviewIds, setLoadingPreviewIds] = useState<Set<string>>(() => new Set())
  const [requestedPreviewIds, setRequestedPreviewIds] = useState<Set<string>>(() => new Set())
  const [showAutoModal, setShowAutoModal] = useState(false)
  const [selectedAutoKeys, setSelectedAutoKeys] = useState<Set<string>>(() => new Set())
  const [selectedAutoTypes, setSelectedAutoTypes] = useState<Set<GeneratedGroupType>>(() => new Set(['url-test']))
  const [selectedSourceGroupKeys, setSelectedSourceGroupKeys] = useState<Set<string>>(() => new Set())
  const [autoNamesIncludeFlag, setAutoNamesIncludeFlag] = useState(true)
  const [autoApplying, setAutoApplying] = useState(false)
  const [manualGroupType, setManualGroupType] = useState<GeneratedGroupType>('url-test')

  useEffect(() => {
    void fetchCollections()
    void fetchGroups()
    void fetchSources()
    void fetchNodes()
  }, [fetchCollections, fetchGroups, fetchNodes, fetchSources])

  useEffect(() => {
    const missingIds = collections
      .map(collection => collection.id)
      .filter(id => previews[id] === undefined && !loadingPreviewIds.has(id) && !requestedPreviewIds.has(id))

    if (missingIds.length === 0) return

    setLoadingPreviewIds(current => new Set([...current, ...missingIds]))
    setRequestedPreviewIds(current => new Set([...current, ...missingIds]))
    void Promise.all(missingIds.map(id => previewCollection(id).catch(() => [])))
      .finally(() => {
        setLoadingPreviewIds(current => {
          const next = new Set(current)
          for (const id of missingIds) next.delete(id)
          return next
        })
      })
  }, [collections, loadingPreviewIds, previewCollection, previews, requestedPreviewIds])

  const sourceOptions = useMemo(
    () => sources.map(source => ({ id: source.id, label: `${source.name} (${source.nodeCount})` })),
    [sources]
  )
  const nodeOptions = useMemo(
    () => nodes.map(node => ({ id: node.id, label: `${node.name} · ${node.protocol.toUpperCase()}` })),
    [nodes]
  )
  const sourceNameById = useMemo(
    () => Object.fromEntries(sources.map(source => [source.id, source.name])),
    [sources]
  )
  const countrySuggestions = useMemo(() => buildCountrySuggestions(nodes), [nodes])
  const sourceGroupSuggestions = useMemo(
    () => buildSourceGroupSuggestions(sources, nodes, collections),
    [collections, nodes, sources]
  )
  const selectedAutoCountries = useMemo(
    () => new Set([...selectedAutoKeys].map(key => key.split(':')[0]).filter(Boolean)),
    [selectedAutoKeys]
  )

  const openCreate = () => {
    setEditingCollection(null)
    setForm(createEmptyForm())
    setManualGroupType('url-test')
    setFormError('')
    setShowModal(true)
  }

  const openAutoGenerate = async () => {
    const settings = await api.settings.get()
    applySettings(settings)
    const configuredTypes = settings.autoNodeGroupsEnabled ? settings.autoNodeGroupTypes : []
    const existingKeys = new Set(
      collections
        .map(collection => parseAutoNodeGroupMarker(collection.notes)?.key)
        .filter((key): key is string => Boolean(key))
    )
    const configuredKeys = settings.autoNodeGroupKeys !== undefined
      ? new Set(settings.autoNodeGroupKeys)
      : null
    const defaultKeys = !settings.autoNodeGroupsEnabled
      ? new Set<string>()
      : configuredKeys ?? (existingKeys.size > 0
          ? existingKeys
          : new Set(countrySuggestions.flatMap(item =>
              (configuredTypes.length > 0 ? configuredTypes : (['url-test'] as GeneratedGroupType[])).map(type => makeAutoNodeGroupKey(item.countryCode, type))
            )))
    const defaultTypes = new Set<GeneratedGroupType>(configuredTypes.filter(isGeneratedGroupType))
    for (const key of defaultKeys) {
      const marker = parseAutoNodeGroupKey(key)
      if (marker) defaultTypes.add(marker.type)
    }
    setSelectedAutoKeys(defaultKeys)
    setSelectedAutoTypes(defaultTypes.size > 0 ? defaultTypes : new Set(['url-test']))
    setSelectedSourceGroupKeys(new Set())
    setAutoNamesIncludeFlag(settings.autoNodeGroupIncludeFlag)
    setShowAutoModal(true)
  }

  const openEdit = (collection: NodeCollection) => {
    setEditingCollection(collection)
    const linkedGroup = groups.find(group => group.collectionIds.includes(collection.id) && isGeneratedGroupType(group.type))
    setManualGroupType(linkedGroup && isGeneratedGroupType(linkedGroup.type) ? linkedGroup.type : 'url-test')
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

    let savedCollection: NodeCollection

    if (editingCollection) {
      const updated = await api.collections.update(editingCollection.id, payload)
      savedCollection = updated
      const linkedGroup = groups.find(group => group.collectionIds.includes(editingCollection.id) && !group.isBuiltin)
      if (linkedGroup) {
        await api.groups.update(linkedGroup.id, {
          name: updated.name,
          type: manualGroupType,
          collectionIds: [updated.id],
        })
      } else {
        await createLinkedGroup(updated, manualGroupType, groups.length)
      }
    } else {
      const created = await api.collections.create(payload)
      savedCollection = created
      await createLinkedGroup(created, manualGroupType, groups.length)
    }

    await Promise.all([fetchCollections(), fetchGroups()])
    void previewCollection(savedCollection.id)
    setShowModal(false)
    setEditingCollection(null)
    setForm(createEmptyForm())
    setManualGroupType('url-test')
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

  const toggleAutoType = (type: GeneratedGroupType) => {
    setSelectedAutoTypes(currentTypes => {
      const nextTypes = toggleSet(currentTypes, type)
      setSelectedAutoKeys(currentKeys => rebuildAutoKeysForTypes(currentKeys, nextTypes))
      return nextTypes
    })
  }

  const applyAutoGenerate = async () => {
    setAutoApplying(true)
    try {
      const selectedTypes = [...selectedAutoTypes]
      const selectedKeys = [...selectedAutoKeys]

      const updatedSettings = await api.settings.update({
        autoNodeGroupsEnabled: selectedKeys.length > 0 && selectedTypes.length > 0,
        autoNodeGroupTypes: selectedTypes.length > 0 ? selectedTypes : ['url-test'],
        autoNodeGroupKeys: selectedKeys,
        autoNodeGroupIncludeFlag: autoNamesIncludeFlag,
      })
      applySettings(updatedSettings)
      const groups = await api.groups.list()

      for (const key of selectedSourceGroupKeys) {
        const suggestion = sourceGroupSuggestions.find(item => item.key === key)
        if (!suggestion || suggestion.exists || suggestion.nodeIds.length === 0) continue

        const collection = await api.collections.create({
          name: suggestion.name,
          sourceIds: [],
          nodeIds: suggestion.nodeIds,
          filters: [],
          renames: [],
          dedup: 'full_config',
          sort: 'manual',
          sortCountryOrder: [],
          enabled: true,
          notes: makeSourceNodeGroupMarker(suggestion.sourceId, suggestion.groupName),
        })

        await createLinkedGroup(collection, mapUpstreamGroupType(suggestion.group.type), groups.length + 1)
      }

      await Promise.all([fetchCollections(), fetchGroups()])
      setShowAutoModal(false)
    } finally {
      setAutoApplying(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('collections.title')}
        description={`按国家/地区等条件生成出口节点组，共 ${collections.length} 个`}
        actions={<><Button variant="secondary" onClick={() => void openAutoGenerate()}>自动生成</Button><Button onClick={openCreate} icon={<PlusIcon />}>{t('collections.new')}</Button></>}
      />
      {loading && collections.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : collections.length === 0 ? (
        <EmptyState
          title="暂无节点组"
          description="节点组用于定义一组节点过滤条件和选择方式，自动生成的节点组会同步创建对应策略组"
          action={{ label: t('collections.new'), onClick: openCreate }}
        />
      ) : (
        <div className={styles.grid}>
          {collections.map(collection => (
            <Card key={collection.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>{collection.name}</div>
                  {collection.notes && !isAutoNodeGroup(collection) && <div className={styles.cardNotes}>{collection.notes}</div>}
                </div>
                <Badge variant={collection.enabled ? 'success' : 'default'}>
                  {collection.enabled ? t('common.enabled') : t('common.disabled')}
                </Badge>
              </div>

              <div className={styles.cardMeta}>
                <Badge variant="info">{scopeText(collection)}</Badge>
                <Badge variant={isAutoNodeGroup(collection) ? 'success' : 'default'}>{isAutoNodeGroup(collection) ? '自动' : '手动'}</Badge>
                <Badge variant="default">{sortLabel(collection.sort)}</Badge>
                <Badge variant="default">{dedupLabel(collection.dedup)}</Badge>
                {collection.filters.length > 0 && <Badge variant="warning">{collection.filters.length} 过滤</Badge>}
                {collection.renames.length > 0 && <Badge variant="purple">{collection.renames.length} 重命名</Badge>}
              </div>

              <PreviewList
                nodes={previews[collection.id] ?? []}
                loading={loadingPreviewIds.has(collection.id) && previews[collection.id] === undefined}
                sourceNameById={sourceNameById}
              />

              <div className={styles.cardActions}>
                {!isAutoNodeGroup(collection) && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(collection)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { if (confirm('删除此节点组？')) void deleteCollection(collection.id) }}
                    >
                      {t('common.delete')}
                    </Button>
                  </>
                )}
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
            <label className={styles.selectLabel}>节点组类型</label>
            <select className={styles.select} value={manualGroupType} onChange={e => setManualGroupType(e.target.value as GeneratedGroupType)}>
              {GENERATED_GROUP_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>
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
      <Modal
        open={showAutoModal}
        onOpenChange={setShowAutoModal}
        title="按国家/地区自动生成节点组"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAutoModal(false)}>{t('common.cancel')}</Button>
            <Button loading={autoApplying} onClick={() => void applyAutoGenerate()}>应用</Button>
          </>
        }
      >
        <div className={styles.autoPanel}>
          <div className={styles.autoSection}>
            <div className={styles.sectionHeader}>节点组类型</div>
            <div className={styles.optionListCompact}>
              {GENERATED_GROUP_TYPES.map(type => (
                <label key={type.value} className={styles.optionItem}>
                  <input
                    type="checkbox"
                    checked={selectedAutoTypes.has(type.value)}
                    onChange={() => toggleAutoType(type.value)}
                  />
                  <span>{type.label}</span>
                </label>
              ))}
            </div>
            <label className={styles.optionItem}>
              <input
                type="checkbox"
                checked={autoNamesIncludeFlag}
                onChange={e => setAutoNamesIncludeFlag(e.target.checked)}
              />
              <span>名称包含旗帜 Emoji</span>
            </label>
          </div>
          <div className={styles.autoSection}>
            <div className={styles.sectionHeader}>可识别国家/地区</div>
            {countrySuggestions.length === 0 ? (
              <div className={styles.inlineEmpty}>当前没有可按国家/地区识别的节点</div>
            ) : (
              <div className={styles.autoSuggestionList}>
                {countrySuggestions.map(item => (
                  <label key={item.countryCode} className={styles.autoSuggestion}>
                    <input
                      type="checkbox"
                      checked={selectedAutoCountries.has(item.countryCode)}
                      onChange={() => setSelectedAutoKeys(current => toggleCountryKeys(current, item.countryCode, selectedAutoTypes))}
                    />
                    <span className={styles.autoSuggestionMain}>{item.label}</span>
                    <span className={styles.autoSuggestionMeta}>{item.count} 个节点</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className={styles.autoSection}>
            <div className={styles.sectionHeader}>订阅源节点组</div>
            {sourceGroupSuggestions.length === 0 ? (
              <div className={styles.inlineEmpty}>当前订阅源没有可导入的节点组</div>
            ) : (
              <div className={styles.autoSuggestionList}>
                {sourceGroupSuggestions.map(item => (
                  <label key={item.key} className={styles.autoSuggestion}>
                    <input
                      type="checkbox"
                      disabled={item.exists || item.nodeIds.length === 0}
                      checked={item.exists || selectedSourceGroupKeys.has(item.key)}
                      onChange={() => setSelectedSourceGroupKeys(current => toggleSet(current, item.key))}
                    />
                    <span className={styles.autoSuggestionMain}>{item.name}</span>
                    <span className={styles.autoSuggestionMeta}>
                      {item.exists ? '已添加' : `${item.nodeIds.length}/${item.group.memberNames.length} 个节点`}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className={styles.inlineEmpty}>
            默认只生成自动测速节点组。取消某个国家/地区后，已自动生成的对应节点组和策略组会被移除；订阅源节点组会按成员节点直接导入。
          </div>
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

function PreviewList({
  nodes,
  loading,
  sourceNameById,
}: {
  nodes: ProxyNode[]
  loading: boolean
  sourceNameById: Record<string, string>
}) {
  return (
    <div className={styles.preview}>
      <div className={styles.previewHeader}>
        <span>节点：{loading ? '加载中' : `${nodes.length} 个`}</span>
      </div>
      {loading ? (
        <div className={styles.previewEmpty}>正在加载节点...</div>
      ) : nodes.length === 0 ? (
        <div className={styles.previewEmpty}>当前组合没有匹配节点</div>
      ) : (
        <div className={styles.previewTableWrap}>
          <table className={styles.previewTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>节点</th>
                <th>协议</th>
                <th>地址</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node, index) => (
                <tr key={node.id}>
                  <td>{index + 1}</td>
                  <td title={node.name}>{node.name}</td>
                  <td>{node.protocol.toUpperCase()}</td>
                  <td title={`${node.server}:${node.port}`}>{node.server}:{node.port}</td>
                  <td title={sourceNameById[node.sourceId] ?? node.sourceId}>
                    {sourceNameById[node.sourceId] ?? node.sourceId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

async function createLinkedGroup(
  collection: NodeCollection,
  type: GeneratedGroupType,
  order: number,
) {
  await api.groups.create({
    name: collection.name,
    type,
    collectionIds: [collection.id],
    groupIds: [],
    builtins: [],
    testUrl: DEFAULT_HEALTH_CHECK.testUrl,
    interval: DEFAULT_HEALTH_CHECK.interval,
    tolerance: DEFAULT_HEALTH_CHECK.tolerance,
    lazy: DEFAULT_HEALTH_CHECK.lazy,
    enabled: true,
    order,
    isBuiltin: false,
  })
}

interface AutoNodeGroupMarker {
  scope: 'country' | 'tag'
  countryCode?: string
  tagKey?: string
  type: GeneratedGroupType
  key: string
}

function buildCountrySuggestions(nodes: ProxyNode[]): Array<{ countryCode: string; label: string; count: number }> {
  const countries = new Map<string, { label: string; count: number }>()
  for (const node of nodes) {
    const countryCode = node.countryCode?.trim().toUpperCase()
    if (!countryCode) continue
    const current = countries.get(countryCode)
    countries.set(countryCode, {
      label: node.country || countryCode,
      count: (current?.count ?? 0) + 1,
    })
  }
  return [...countries.entries()]
    .map(([countryCode, item]) => ({ countryCode, label: `${item.label} (${countryCode})`, count: item.count }))
    .sort((a, b) => b.count - a.count || a.countryCode.localeCompare(b.countryCode))
}

function makeAutoNodeGroupKey(countryCode: string, type: GeneratedGroupType): string {
  return `country:${countryCode.trim().toUpperCase()}:${type}`
}

function parseAutoNodeGroupKey(key: string): AutoNodeGroupMarker | null {
  const parts = key.split(':')
  if (parts.length === 2) {
    const [countryCode, type] = parts
    if (!countryCode || !isGeneratedGroupType(type)) return null
    const normalizedCode = countryCode.trim().toUpperCase()
    return { scope: 'country', countryCode: normalizedCode, type, key: makeAutoNodeGroupKey(normalizedCode, type) }
  }
  if (parts.length !== 3) return null

  const [scope, value, type] = parts
  if (!isGeneratedGroupType(type)) return null
  if (scope === 'country' && value) {
    const normalizedCode = value.trim().toUpperCase()
    return { scope, countryCode: normalizedCode, type, key: makeAutoNodeGroupKey(normalizedCode, type) }
  }
  if (scope === 'tag' && value) {
    return { scope, tagKey: value, type, key: `tag:${value}:${type}` }
  }
  return null
}

function parseAutoNodeGroupMarker(notes?: string): AutoNodeGroupMarker | null {
  if (!notes?.startsWith(AUTO_NODE_GROUP_PREFIX)) return null
  return parseAutoNodeGroupKey(notes.slice(AUTO_NODE_GROUP_PREFIX.length).trim())
}

function isAutoNodeGroup(collection: NodeCollection): boolean {
  return parseAutoNodeGroupMarker(collection.notes) !== null
}

interface SourceGroupSuggestion {
  key: string
  sourceId: string
  sourceName: string
  groupName: string
  name: string
  group: SourceNodeGroup
  nodeIds: string[]
  exists: boolean
}

function buildSourceGroupSuggestions(
  sources: ProxySource[],
  nodes: ProxyNode[],
  collections: NodeCollection[],
): SourceGroupSuggestion[] {
  const nodesBySourceAndName = new Map<string, ProxyNode>()
  for (const node of nodes) {
    nodesBySourceAndName.set(makeSourceNodeKey(node.sourceId, node.name), node)
  }

  const existingMarkers = new Set(
    collections
      .map(collection => parseSourceNodeGroupMarker(collection.notes))
      .filter((marker): marker is string => Boolean(marker))
  )

  return sources.flatMap(source => (source.groups ?? []).map(group => {
    const key = makeSourceNodeGroupKey(source.id, group.name)
    const nodeIds = group.memberNames
      .map(name => nodesBySourceAndName.get(makeSourceNodeKey(source.id, name))?.id)
      .filter((id): id is string => Boolean(id))

    return {
      key,
      sourceId: source.id,
      sourceName: source.name,
      groupName: group.name,
      name: `${source.name} / ${group.name}`,
      group,
      nodeIds,
      exists: existingMarkers.has(key),
    }
  })).sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.groupName.localeCompare(b.groupName))
}

function makeSourceNodeKey(sourceId: string, nodeName: string): string {
  return `${sourceId}\n${nodeName}`
}

function makeSourceNodeGroupKey(sourceId: string, groupName: string): string {
  return `${sourceId}:${encodeURIComponent(groupName)}`
}

function makeSourceNodeGroupMarker(sourceId: string, groupName: string): string {
  return `${SOURCE_NODE_GROUP_PREFIX} ${makeSourceNodeGroupKey(sourceId, groupName)}`
}

function parseSourceNodeGroupMarker(notes?: string): string | null {
  if (!notes?.startsWith(SOURCE_NODE_GROUP_PREFIX)) return null
  return notes.slice(SOURCE_NODE_GROUP_PREFIX.length).trim() || null
}

function mapUpstreamGroupType(type?: string): GeneratedGroupType {
  const normalized = type?.toLowerCase()
  if (normalized === 'select' || normalized === 'selector') return 'select'
  if (normalized === 'fallback') return 'fallback'
  return 'url-test'
}

function isGeneratedGroupType(value: string | undefined): value is GeneratedGroupType {
  return value === 'select' || value === 'url-test' || value === 'fallback'
}

function toggleSet<T>(source: Set<T>, value: T): Set<T> {
  const next = new Set(source)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

function toggleCountryKeys(
  source: Set<string>,
  countryCode: string,
  types: Set<GeneratedGroupType>
): Set<string> {
  const next = new Set(source)
  const countryKeys = GENERATED_GROUP_TYPES.map(type => makeAutoNodeGroupKey(countryCode, type.value))
  const hasCountry = countryKeys.some(key => next.has(key))
  for (const key of countryKeys) next.delete(key)
  if (!hasCountry && types.size > 0) {
    for (const type of types) {
      next.add(makeAutoNodeGroupKey(countryCode, type))
    }
  }
  return next
}

function rebuildAutoKeysForTypes(source: Set<string>, types: Set<GeneratedGroupType>): Set<string> {
  const parsedMarkers = [...source]
    .map(key => parseAutoNodeGroupKey(key))
    .filter((marker): marker is AutoNodeGroupMarker => Boolean(marker))
  const countries = new Set(parsedMarkers.map(marker => marker.countryCode).filter((value): value is string => Boolean(value)))
  const next = new Set<string>()
  for (const marker of parsedMarkers) {
    if (marker.scope === 'tag') next.add(marker.key)
  }
  for (const countryCode of countries) {
    for (const type of types) {
      next.add(makeAutoNodeGroupKey(countryCode, type))
    }
  }
  return next
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
