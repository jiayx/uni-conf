import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Modal, ModalClose } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { Badge } from '@/components/ui/Badge/Badge'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { useCollectionsStore } from '@/store/collections.store'
import { useGroupsStore } from '@/store/groups.store'
import { useNodesStore } from '@/store/nodes.store'
import { useSourcesStore } from '@/store/sources.store'
import { useSettingsStore } from '@/store/settings.store'
import { api } from '@/lib/api'
import {
  buildAutoNodeGroupSettingsPatch,
  buildAutoNodeGroupKeysForSuggestions,
  buildAutoNodeTagSuggestions,
  parseAutoNodeGroupKey,
  toggleAllAutoNodeGroupScopes,
  type AutoNodeGroupMarker,
} from '@/core/collections/auto-node-settings'
import {
  buildSourceGroupSuggestions,
  makeSourceNodeGroupMarker,
  mapUpstreamGroupType,
} from '@/core/collections/source-group-suggestions'
import { formValuesEqual, useUnsavedChangesGuard } from '@/core/forms/use-unsaved-changes'
import {
  AUTO_NODE_GROUP_PREFIX,
  DEFAULT_NODE_POOL_COLLECTION_ID,
  DEFAULT_NODE_POOL_PREFIX,
} from '@uni-conf/shared'
import type {
  DedupStrategy,
  FilterOperator,
  GroupType,
  NodeCollection,
  NodeFilter,
  NodeRename,
  ProxyNode,
  SortStrategy,
} from '@uni-conf/types'
import styles from './Collections.module.css'

type CollectionForm = Omit<NodeCollection, 'id' | 'createdAt' | 'updatedAt'>
type GeneratedGroupType = Extract<GroupType, 'select' | 'url-test' | 'fallback'>

interface AutoEditorSnapshot {
  autoCountries: string[]
  autoTags: string[]
  autoTypes: GeneratedGroupType[]
  sourceGroupKeys: string[]
  includeFlag: boolean
}

const GENERATED_GROUP_TYPES: Array<{ value: GeneratedGroupType; labelKey: string }> = [
  { value: 'select', labelKey: 'collections.group_type_select' },
  { value: 'url-test', labelKey: 'collections.group_type_url_test' },
  { value: 'fallback', labelKey: 'collections.group_type_fallback' },
]
const FILTER_FIELDS: Array<{ value: NodeFilter['field']; labelKey: string }> = [
  { value: 'name', labelKey: 'collections.filter_field_name' },
  { value: 'server', labelKey: 'collections.filter_field_server' },
  { value: 'protocol', labelKey: 'collections.filter_field_protocol' },
  { value: 'country', labelKey: 'collections.filter_field_country' },
  { value: 'countryCode', labelKey: 'collections.filter_field_country_code' },
  { value: 'tag', labelKey: 'collections.filter_field_tag' },
  { value: 'sourceId', labelKey: 'collections.filter_field_source_id' },
]

const FILTER_OPERATORS: Array<{ value: FilterOperator; labelKey: string }> = [
  { value: 'contains', labelKey: 'collections.filter_op_contains' },
  { value: 'not_contains', labelKey: 'collections.filter_op_not_contains' },
  { value: 'equals', labelKey: 'collections.filter_op_equals' },
  { value: 'not_equals', labelKey: 'collections.filter_op_not_equals' },
  { value: 'regex', labelKey: 'collections.filter_op_regex' },
  { value: 'not_regex', labelKey: 'collections.filter_op_not_regex' },
  { value: 'in', labelKey: 'collections.filter_op_in' },
  { value: 'not_in', labelKey: 'collections.filter_op_not_in' },
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

const RENAME_TYPES: Array<{ value: NodeRename['type']; labelKey: string }> = [
  { value: 'replace', labelKey: 'collections.rename_type_replace' },
  { value: 'regex', labelKey: 'collections.rename_type_regex' },
  { value: 'prefix', labelKey: 'collections.rename_type_prefix' },
  { value: 'suffix', labelKey: 'collections.rename_type_suffix' },
  { value: 'strip_emoji', labelKey: 'collections.rename_type_strip_emoji' },
  { value: 'standardize_country', labelKey: 'collections.rename_type_standardize_country' },
  { value: 'auto_number', labelKey: 'collections.rename_type_auto_number' },
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

function createAutoEditorSnapshot(
  autoCountries: Set<string>,
  autoTags: Set<string>,
  autoTypes: Set<GeneratedGroupType>,
  sourceGroupKeys: Set<string>,
  includeFlag: boolean,
): AutoEditorSnapshot {
  return {
    autoCountries: [...autoCountries].sort(),
    autoTags: [...autoTags].sort(),
    autoTypes: [...autoTypes].sort(),
    sourceGroupKeys: [...sourceGroupKeys].sort(),
    includeFlag,
  }
}

export function Collections() {
  const { t } = useTranslation()
  const confirmAction = useConfirmDialog()
  const {
    collections,
    previews,
    loading,
    error: loadError,
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
  const [initialForm, setInitialForm] = useState<CollectionForm>(createEmptyForm)
  const [formError, setFormError] = useState<unknown | null>(null)
  const [actionError, setActionError] = useState<unknown | null>(null)
  const [autoError, setAutoError] = useState<unknown | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [rowActionId, setRowActionId] = useState<string | null>(null)
  const [openingAuto, setOpeningAuto] = useState(false)
  const [loadingPreviewIds, setLoadingPreviewIds] = useState<Set<string>>(() => new Set())
  const [requestedPreviewIds, setRequestedPreviewIds] = useState<Set<string>>(() => new Set())
  const [expandedAutoPreviewIds, setExpandedAutoPreviewIds] = useState<Set<string>>(() => new Set())
  const [expandedManualPreviewIds, setExpandedManualPreviewIds] = useState<Set<string>>(() => new Set())
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({})
  const [showAutoModal, setShowAutoModal] = useState(false)
  const [selectedAutoCountries, setSelectedAutoCountries] = useState<Set<string>>(() => new Set())
  const [selectedAutoTags, setSelectedAutoTags] = useState<Set<string>>(() => new Set())
  const [selectedAutoTypes, setSelectedAutoTypes] = useState<Set<GeneratedGroupType>>(() => new Set(['url-test']))
  const [selectedSourceGroupKeys, setSelectedSourceGroupKeys] = useState<Set<string>>(() => new Set())
  const [autoNamesIncludeFlag, setAutoNamesIncludeFlag] = useState(true)
  const [autoApplying, setAutoApplying] = useState(false)
  const [manualGroupType, setManualGroupType] = useState<GeneratedGroupType>('url-test')
  const [initialManualGroupType, setInitialManualGroupType] = useState<GeneratedGroupType>('url-test')
  const [initialAutoEditor, setInitialAutoEditor] = useState<AutoEditorSnapshot>(() =>
    createAutoEditorSnapshot(new Set(), new Set(), new Set(['url-test']), new Set(), true)
  )
  const formDirty = showModal && (
    !formValuesEqual(form, initialForm)
    || manualGroupType !== initialManualGroupType
  )
  const autoEditorDirty = showAutoModal && !formValuesEqual(
    createAutoEditorSnapshot(
      selectedAutoCountries,
      selectedAutoTags,
      selectedAutoTypes,
      selectedSourceGroupKeys,
      autoNamesIncludeFlag,
    ),
    initialAutoEditor,
  )
  const autoSelectionMissingType = selectedAutoTypes.size === 0
    && (selectedAutoCountries.size > 0 || selectedAutoTags.size > 0)
  useUnsavedChangesGuard(formDirty)
  useUnsavedChangesGuard(autoEditorDirty)

  useEffect(() => {
    void fetchCollections()
    void fetchGroups()
    void fetchSources()
    void fetchNodes()
  }, [fetchCollections, fetchGroups, fetchNodes, fetchSources])

  useEffect(() => {
    const missingIds = collections
      .filter(collection => isManagedNodeGroup(collection)
        ? expandedAutoPreviewIds.has(collection.id)
        : expandedManualPreviewIds.has(collection.id))
      .map(collection => collection.id)
      .filter(id => previews[id] === undefined && !loadingPreviewIds.has(id) && !requestedPreviewIds.has(id))

    if (missingIds.length === 0) return

    queueMicrotask(() => {
      setLoadingPreviewIds(current => new Set([...current, ...missingIds]))
      setRequestedPreviewIds(current => new Set([...current, ...missingIds]))
      void Promise.all(missingIds.map(async id => {
        try {
          await previewCollection(id)
          setPreviewErrors(current => {
            if (!current[id]) return current
            const next = { ...current }
            delete next[id]
            return next
          })
        } catch (error) {
          setPreviewErrors(current => ({ ...current, [id]: (error as Error).message }))
        }
      }))
        .finally(() => {
          setLoadingPreviewIds(current => {
            const next = new Set(current)
            for (const id of missingIds) next.delete(id)
            return next
          })
        })
    })
  }, [collections, expandedAutoPreviewIds, expandedManualPreviewIds, loadingPreviewIds, previewCollection, previews, requestedPreviewIds])

  const togglePreview = (collection: NodeCollection) => {
    if (isManagedNodeGroup(collection)) {
      setExpandedAutoPreviewIds(current => toggleSet(current, collection.id))
    } else {
      setExpandedManualPreviewIds(current => toggleSet(current, collection.id))
    }
  }

  const retryPreview = (id: string) => {
    setPreviewErrors(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setRequestedPreviewIds(current => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

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
  const allRecognizedCountriesSelected = countrySuggestions.length > 0
    && countrySuggestions.every(item => selectedAutoCountries.has(item.countryCode))
  const tagSuggestions = useMemo(() => buildAutoNodeTagSuggestions(nodes), [nodes])
  const sourceGroupSuggestions = useMemo(
    () => buildSourceGroupSuggestions(sources, nodes, collections),
    [collections, nodes, sources]
  )
  const openCreate = () => {
    const nextForm = createEmptyForm()
    setEditingCollection(null)
    setForm(nextForm)
    setInitialForm(nextForm)
    setManualGroupType('url-test')
    setInitialManualGroupType('url-test')
    setFormError(null)
    setShowModal(true)
  }

  const openAutoGenerate = async () => {
    setOpeningAuto(true)
    setActionError(null)
    try {
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
            : buildAutoNodeGroupKeysForSuggestions({
                countryCodes: countrySuggestions.map(item => item.countryCode),
                tagKeys: tagSuggestions.map(item => item.key),
                types: configuredTypes.length > 0 ? configuredTypes : (['url-test'] as GeneratedGroupType[]),
              }))
      const defaultTypes = new Set<GeneratedGroupType>(configuredTypes.filter(isGeneratedGroupType))
      const defaultCountries = new Set<string>()
      const defaultTags = new Set<string>()
      for (const key of defaultKeys) {
        const marker = parseAutoNodeGroupKey(key)
        if (!marker) continue
        defaultTypes.add(marker.type)
        if (marker.countryCode) defaultCountries.add(marker.countryCode)
        if (marker.tagKey) defaultTags.add(marker.tagKey)
      }
      const nextTypes: Set<GeneratedGroupType> = defaultTypes.size > 0
        ? defaultTypes
        : (settings.autoNodeGroupsEnabled
            ? new Set<GeneratedGroupType>(['url-test'])
            : new Set<GeneratedGroupType>())
      const nextSourceGroupKeys = new Set<string>()
      setSelectedAutoCountries(defaultCountries)
      setSelectedAutoTags(defaultTags)
      setSelectedAutoTypes(nextTypes)
      setSelectedSourceGroupKeys(nextSourceGroupKeys)
      setAutoNamesIncludeFlag(settings.autoNodeGroupIncludeFlag)
      setInitialAutoEditor(createAutoEditorSnapshot(
        defaultCountries,
        defaultTags,
        nextTypes,
        nextSourceGroupKeys,
        settings.autoNodeGroupIncludeFlag,
      ))
      setAutoError(null)
      setShowAutoModal(true)
    } catch (error) {
      setActionError(error)
    } finally {
      setOpeningAuto(false)
    }
  }

  const openEdit = (collection: NodeCollection) => {
    const linkedGroup = groups.find(group => group.collectionIds.includes(collection.id) && isGeneratedGroupType(group.type))
    const nextGroupType = linkedGroup && isGeneratedGroupType(linkedGroup.type) ? linkedGroup.type : 'url-test'
    const nextForm: CollectionForm = {
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
    }
    setEditingCollection(collection)
    setManualGroupType(nextGroupType)
    setInitialManualGroupType(nextGroupType)
    setForm(nextForm)
    setInitialForm(nextForm)
    setFormError(null)
    setShowModal(true)
  }

  const closeFormModal = () => {
    setShowModal(false)
    setEditingCollection(null)
    setFormError(null)
  }

  const closeAutoModal = () => {
    setShowAutoModal(false)
    setAutoError(null)
  }

  const handleSave = async () => {
    const payload: CollectionForm = {
      ...form,
      name: form.name.trim(),
      notes: form.notes?.trim() ?? '',
      filters: form.filters.map(filter => ({
        ...filter,
        value: normalizeListValue(filter.operator, filter.value),
      })),
    }

    if (!payload.name) {
      setFormError(t('collections.name_required'))
      return
    }

    setFormSaving(true)
    setFormError(null)
    try {
      const result = editingCollection
        ? await api.collections.updateWithGroup(editingCollection.id, payload, manualGroupType)
        : await api.collections.createWithGroup(payload, manualGroupType)

      await Promise.all([fetchCollections(), fetchGroups()])
      void previewCollection(result.collection.id)
      setShowModal(false)
      setEditingCollection(null)
      setForm(createEmptyForm())
      setManualGroupType('url-test')
    } catch (error) {
      setFormError(error)
    } finally {
      setFormSaving(false)
    }
  }

  const handleDeleteCollection = async (collection: NodeCollection) => {
    if (!(await confirmAction({
      description: t('collections.delete_confirm'),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    setRowActionId(collection.id)
    setActionError(null)
    try {
      await deleteCollection(collection.id)
      await fetchGroups()
    } catch (error) {
      setActionError(error)
    } finally {
      setRowActionId(null)
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

  const toggleAutoType = (type: GeneratedGroupType) => {
    setSelectedAutoTypes(currentTypes => toggleSet(currentTypes, type))
  }

  const applyAutoGenerate = async () => {
    if (autoSelectionMissingType) {
      setAutoError(new Error(t('collections.group_type_required')))
      return
    }
    setAutoApplying(true)
    setAutoError(null)
    try {
      const selectedTypes = [...selectedAutoTypes]
      const selectedKeys = buildAutoNodeGroupKeysForSuggestions({
        countryCodes: selectedAutoCountries,
        tagKeys: selectedAutoTags,
        types: selectedAutoTypes,
      })

      const updatedSettings = await api.settings.update(buildAutoNodeGroupSettingsPatch({
        selectedTypes,
        selectedKeys,
        includeFlag: autoNamesIncludeFlag,
      }))
      applySettings(updatedSettings)
      for (const key of selectedSourceGroupKeys) {
        const suggestion = sourceGroupSuggestions.find(item => item.key === key)
        if (!suggestion || suggestion.exists || suggestion.nodeIds.length === 0) continue

        await api.collections.createWithGroup({
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
        }, mapUpstreamGroupType(suggestion.group.type))
      }

      await Promise.all([fetchCollections(), fetchGroups()])
      setShowAutoModal(false)
    } catch (error) {
      setAutoError(error)
      await Promise.allSettled([fetchCollections(), fetchGroups()])
    } finally {
      setAutoApplying(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('collections.title')}
        description={t('collections.description', { count: collections.length })}
        actions={<><Button variant="secondary" loading={openingAuto} onClick={() => void openAutoGenerate()}>{t('collections.auto_generate')}</Button><Button onClick={openCreate} icon={<PlusIcon />}>{t('collections.new')}</Button></>}
      />
      {loadError != null && <ErrorNotice error={loadError} />}
      {actionError != null && <ErrorNotice error={actionError} />}
      {loading && collections.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : collections.length === 0 ? (
        <EmptyState
          title={t('collections.empty_title')}
          description={t('collections.empty_description')}
          action={{ label: t('collections.new'), onClick: openCreate }}
        />
      ) : (
        <div className={styles.grid}>
          {collections.map(collection => {
            const autoNodeGroup = isAutoNodeGroup(collection)
            const defaultNodePool = isDefaultNodePool(collection)
            const managedNodeGroup = autoNodeGroup || defaultNodePool
            const previewExpanded = managedNodeGroup
              ? expandedAutoPreviewIds.has(collection.id)
              : expandedManualPreviewIds.has(collection.id)
            const nodeCount = previews[collection.id]?.length ?? collection.nodeCount
            return <Card key={collection.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>{collection.name}</div>
                  {defaultNodePool && <div className={styles.cardNotes}>{t('collections.default_pool_description')}</div>}
                  {collection.notes && !managedNodeGroup && <div className={styles.cardNotes}>{collection.notes}</div>}
                </div>
                <Badge variant={collection.enabled ? 'success' : 'default'}>
                  {collection.enabled ? t('common.enabled') : t('common.disabled')}
                </Badge>
              </div>

              <div className={styles.cardMeta}>
                <Badge variant="info">{scopeText(collection, t)}</Badge>
                <Badge variant={managedNodeGroup ? 'success' : 'default'}>
                  {defaultNodePool
                    ? t('collections.system_label')
                    : autoNodeGroup
                      ? t('collections.auto_label')
                      : t('collections.manual_label')}
                </Badge>
                <Badge variant="default">{sortLabel(collection.sort, t)}</Badge>
                <Badge variant="default">{dedupLabel(collection.dedup, t)}</Badge>
                {collection.filters.length > 0 && <Badge variant="warning">{t('collections.filter_count', { count: collection.filters.length })}</Badge>}
                {collection.renames.length > 0 && <Badge variant="purple">{t('collections.rename_count', { count: collection.renames.length })}</Badge>}
              </div>

              <button
                type="button"
                className={styles.previewToggle}
                aria-label={t('collections.preview_toggle_label', { name: collection.name })}
                aria-expanded={previewExpanded}
                aria-controls={`collection-preview-${collection.id}`}
                onClick={() => togglePreview(collection)}
              >
                <span>{t('collections.preview_count', { count: nodeCount })}</span>
                <span>{previewExpanded ? t('collections.collapse') : t('collections.expand')}</span>
              </button>

              {previewExpanded && (
                <div id={`collection-preview-${collection.id}`}>
                  <PreviewList
                    nodes={previews[collection.id] ?? []}
                    loading={loadingPreviewIds.has(collection.id) && previews[collection.id] === undefined}
                    error={previewErrors[collection.id]}
                    onRetry={() => retryPreview(collection.id)}
                    sourceNameById={sourceNameById}
                  />
                </div>
              )}

              <div className={styles.cardActions}>
                {!managedNodeGroup && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(collection)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={rowActionId === collection.id}
                      disabled={rowActionId === collection.id}
                      aria-label={t('collections.delete_collection', { name: collection.name })}
                      onClick={() => void handleDeleteCollection(collection)}
                    >
                      {t('common.delete')}
                    </Button>
                  </>
                )}
              </div>
            </Card>
          })}
        </div>
      )}

      <Modal
        open={showModal}
        dirty={formDirty}
        onOpenChange={open => {
          if (!open) closeFormModal()
        }}
        title={editingCollection ? t('common.edit') : t('collections.new')}
        size="lg"
        closeDisabled={formSaving}
        footer={
          <>
            <ModalClose><Button variant="secondary" disabled={formSaving}>{t('common.cancel')}</Button></ModalClose>
            <Button loading={formSaving} onClick={() => void handleSave()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError != null && <ErrorNotice error={formError} className={styles.formError} />}

        <div className={styles.formGrid}>
          <Input label={t('common.name')} value={form.name} onChange={e => setFormValue('name', e.target.value, setForm)} />
          <div>
            <label className={styles.selectLabel} htmlFor="collection-group-type">{t('collections.group_type')}</label>
            <select id="collection-group-type" className={styles.select} value={manualGroupType} onChange={e => setManualGroupType(e.target.value as GeneratedGroupType)}>
              {GENERATED_GROUP_TYPES.map(type => <option key={type.value} value={type.value}>{t(type.labelKey)}</option>)}
            </select>
          </div>
          <div>
            <label className={styles.selectLabel} htmlFor="collection-dedup">{t('collections.dedup')}</label>
            <select id="collection-dedup" className={styles.select} value={form.dedup} onChange={e => setFormValue('dedup', e.target.value as DedupStrategy, setForm)}>
              {DEDUP_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
            </select>
          </div>
          <div>
            <label className={styles.selectLabel} htmlFor="collection-sort">{t('collections.sort')}</label>
            <select id="collection-sort" className={styles.select} value={form.sort} onChange={e => setFormValue('sort', e.target.value as SortStrategy, setForm)}>
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
          label={t('collections.specific_nodes')}
          emptyText={t('collections.no_specific_nodes')}
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
            <div className={styles.inlineEmpty}>{t('collections.no_filters')}</div>
          ) : form.filters.map((filter, index) => (
            <FilterRow
              key={filter.id}
              index={index}
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
            <div className={styles.inlineEmpty}>{t('collections.no_renames')}</div>
          ) : form.renames.map((rename, index) => (
            <RenameRow
              key={rename.id}
              index={index}
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
        dirty={autoEditorDirty}
        onOpenChange={open => {
          if (!open) closeAutoModal()
        }}
        title={t('collections.auto_generate_title')}
        size="lg"
        closeDisabled={autoApplying}
        footer={
          <>
            <ModalClose><Button variant="secondary" disabled={autoApplying}>{t('common.cancel')}</Button></ModalClose>
            <Button
              loading={autoApplying}
              disabled={autoSelectionMissingType}
              onClick={() => void applyAutoGenerate()}
            >
              {t('common.apply')}
            </Button>
          </>
        }
      >
        {autoError != null && <ErrorNotice error={autoError} className={styles.formError} />}
        <div className={styles.autoPanel}>
          <div className={styles.autoSection}>
            <div className={styles.sectionHeader}>{t('collections.group_type')}</div>
            <div className={styles.optionListCompact}>
              {GENERATED_GROUP_TYPES.map(type => (
                <label key={type.value} className={styles.optionItem}>
                  <input
                    type="checkbox"
                    checked={selectedAutoTypes.has(type.value)}
                    onChange={() => toggleAutoType(type.value)}
                  />
                  <span>{t(type.labelKey)}</span>
                </label>
              ))}
            </div>
            <label className={styles.optionItem}>
              <input
                type="checkbox"
                checked={autoNamesIncludeFlag}
                onChange={e => setAutoNamesIncludeFlag(e.target.checked)}
              />
              <span>{t('collections.include_flag')}</span>
            </label>
            {autoSelectionMissingType && (
              <div className={styles.inlineEmpty}>{t('collections.group_type_required')}</div>
            )}
          </div>
          <div className={styles.autoSection}>
            <div className={styles.sectionHeader}>
              <span>{t('collections.recognized_countries')}</span>
              {countrySuggestions.length > 0 && (
                <button
                  type="button"
                  className={styles.clearButton}
                  onClick={() => setSelectedAutoCountries(current => toggleAllAutoNodeGroupScopes(
                    current,
                    countrySuggestions.map(item => item.countryCode),
                  ))}
                >
                  {allRecognizedCountriesSelected
                    ? t('collections.clear_all_countries')
                    : t('collections.select_all_countries')}
                </button>
              )}
            </div>
            {countrySuggestions.length === 0 ? (
              <div className={styles.inlineEmpty}>{t('collections.no_recognized_countries')}</div>
            ) : (
              <div className={styles.autoSuggestionList}>
                {countrySuggestions.map(item => (
                  <label key={item.countryCode} className={styles.autoSuggestion}>
                    <input
                      type="checkbox"
                      checked={selectedAutoCountries.has(item.countryCode)}
                      onChange={() => setSelectedAutoCountries(current => toggleSet(current, item.countryCode))}
                    />
                    <span className={styles.autoSuggestionMain}>{item.label}</span>
                    <span className={styles.autoSuggestionMeta}>{t('collections.node_count', { count: item.count })}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className={styles.autoSection}>
            <div className={styles.sectionHeader}>{t('collections.recognized_tag_pools')}</div>
            {tagSuggestions.length === 0 ? (
              <div className={styles.inlineEmpty}>{t('collections.no_recognized_tag_pools')}</div>
            ) : (
              <div className={styles.autoSuggestionList}>
                {tagSuggestions.map(item => (
                  <label key={item.key} className={styles.autoSuggestion}>
                    <input
                      type="checkbox"
                      checked={selectedAutoTags.has(item.key)}
                      onChange={() => setSelectedAutoTags(current => toggleSet(current, item.key))}
                    />
                    <span className={styles.autoSuggestionMain}>{item.label}</span>
                    <span className={styles.autoSuggestionMeta}>{t('collections.node_count', { count: item.count })}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className={styles.autoSection}>
            <div className={styles.sectionHeader}>{t('collections.source_groups')}</div>
            {sourceGroupSuggestions.length === 0 ? (
              <div className={styles.inlineEmpty}>{t('collections.no_source_groups')}</div>
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
                      {item.exists
                        ? t('collections.already_added')
                        : t('collections.source_group_node_count', { selected: item.nodeIds.length, total: item.group.memberNames.length })}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className={styles.inlineEmpty}>
            {t('collections.auto_generate_help')}
          </div>
        </div>
      </Modal>
    </div>
  )
}

function FilterRow({ filter, index, onChange, onRemove }: {
  filter: NodeFilter
  index: number
  onChange: (filter: NodeFilter) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const value = Array.isArray(filter.value) ? filter.value.join(', ') : filter.value
  const row = index + 1

  return (
    <div className={styles.ruleRow} role="group" aria-label={t('collections.filter_row', { row })}>
      <label className={styles.ruleToggle}>
        <input
          type="checkbox"
          aria-label={t('collections.filter_enabled', { row })}
          checked={filter.enabled}
          onChange={e => onChange({ ...filter, enabled: e.target.checked })}
        />
      </label>
      <select aria-label={t('collections.filter_field', { row })} className={styles.select} value={filter.field} onChange={e => onChange({ ...filter, field: e.target.value as NodeFilter['field'] })}>
        {FILTER_FIELDS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
      </select>
      <select aria-label={t('collections.filter_operator', { row })} className={styles.select} value={filter.operator} onChange={e => onChange({ ...filter, operator: e.target.value as FilterOperator })}>
        {FILTER_OPERATORS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
      </select>
      <input
        aria-label={t('collections.filter_value', { row })}
        className={styles.textInput}
        value={value}
        onChange={e => onChange({ ...filter, value: e.target.value })}
        placeholder={t('collections.filter_value_placeholder')}
      />
      <Button type="button" variant="ghost" size="sm" aria-label={t('collections.remove_filter', { row })} onClick={onRemove}>{t('common.delete')}</Button>
    </div>
  )
}

function RenameRow({ rename, index, onChange, onRemove }: {
  rename: NodeRename
  index: number
  onChange: (rename: NodeRename) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const needsPattern = rename.type === 'replace' || rename.type === 'regex'
  const needsReplacement = rename.type !== 'strip_emoji' && rename.type !== 'standardize_country' && rename.type !== 'auto_number'
  const row = index + 1

  return (
    <div className={styles.ruleRow} role="group" aria-label={t('collections.rename_row', { row })}>
      <label className={styles.ruleToggle}>
        <input
          type="checkbox"
          aria-label={t('collections.rename_enabled', { row })}
          checked={rename.enabled}
          onChange={e => onChange({ ...rename, enabled: e.target.checked })}
        />
      </label>
      <select aria-label={t('collections.rename_type', { row })} className={styles.select} value={rename.type} onChange={e => onChange({ ...rename, type: e.target.value as NodeRename['type'] })}>
        {RENAME_TYPES.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
      </select>
      <input
        aria-label={t('collections.rename_pattern', { row })}
        className={styles.textInput}
        value={rename.pattern ?? ''}
        onChange={e => onChange({ ...rename, pattern: e.target.value })}
        placeholder={needsPattern ? t('collections.rename_pattern_placeholder') : t('collections.not_required')}
        disabled={!needsPattern}
      />
      <input
        aria-label={t('collections.rename_replacement', { row })}
        className={styles.textInput}
        value={rename.replacement ?? ''}
        onChange={e => onChange({ ...rename, replacement: e.target.value })}
        placeholder={needsReplacement ? t('collections.rename_replacement_placeholder') : t('collections.not_required')}
        disabled={!needsReplacement}
      />
      <Button type="button" variant="ghost" size="sm" aria-label={t('collections.remove_rename', { row })} onClick={onRemove}>{t('common.delete')}</Button>
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
  const { t } = useTranslation()
  const selected = new Set(value)
  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter(item => item !== id) : [...value, id])
  }

  return (
    <div className={styles.selector} role="group" aria-label={label}>
      <div className={styles.selectorHeader}>
        <span className={styles.selectLabel}>{label}</span>
        {value.length > 0 && <button type="button" className={styles.clearButton} onClick={() => onChange([])}>{t('collections.clear_selection')}</button>}
      </div>
      {options.length === 0 ? (
        <div className={styles.selectorEmpty}>{t('collections.no_options')}</div>
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
  error,
  onRetry,
  sourceNameById,
}: {
  nodes: ProxyNode[]
  loading: boolean
  error?: string
  onRetry: () => void
  sourceNameById: Record<string, string>
}) {
  const { t } = useTranslation()
  return (
    <div className={styles.preview}>
      {error ? (
        <div className={styles.previewError} role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>{t('collections.preview_retry')}</button>
        </div>
      ) : loading ? (
        <div className={styles.previewEmpty}>{t('collections.preview_loading')}</div>
      ) : nodes.length === 0 ? (
        <div className={styles.previewEmpty}>{t('collections.preview_empty')}</div>
      ) : (
        <div className={styles.previewTableWrap}>
          <table className={styles.previewTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('collections.table_node')}</th>
                <th>{t('collections.table_protocol')}</th>
                <th>{t('collections.table_address')}</th>
                <th>{t('collections.table_source')}</th>
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

function scopeText(
  collection: NodeCollection,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (collection.nodeIds.length > 0) {
    return t('collections.scope_specific_nodes', { count: collection.nodeIds.length })
  }
  return collection.sourceIds.length === 0
    ? t('collections.scope_all_sources')
    : t('collections.scope_sources', { count: collection.sourceIds.length })
}

function sortLabel(
  sort: SortStrategy,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const option = SORT_OPTIONS.find(item => item.value === sort)
  return t('collections.sort_summary', { value: option ? t(option.labelKey) : sort })
}

function dedupLabel(
  dedup: DedupStrategy,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const option = DEDUP_OPTIONS.find(item => item.value === dedup)
  return t('collections.dedup_summary', { value: option ? t(option.labelKey) : dedup })
}

function buildCountrySuggestions(nodes: ProxyNode[]): Array<{ countryCode: string; label: string; count: number }> {
  const countries = new Map<string, { label: string; count: number }>()
  for (const node of nodes) {
    if (node.tags.includes('high-multiplier')) continue
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

function parseAutoNodeGroupMarker(notes?: string): AutoNodeGroupMarker | null {
  if (!notes?.startsWith(AUTO_NODE_GROUP_PREFIX)) return null
  return parseAutoNodeGroupKey(notes.slice(AUTO_NODE_GROUP_PREFIX.length).trim())
}

function isAutoNodeGroup(collection: NodeCollection): boolean {
  return parseAutoNodeGroupMarker(collection.notes) !== null
}

function isDefaultNodePool(collection: NodeCollection): boolean {
  return collection.id === DEFAULT_NODE_POOL_COLLECTION_ID
    || collection.notes?.startsWith(DEFAULT_NODE_POOL_PREFIX) === true
}

function isManagedNodeGroup(collection: NodeCollection): boolean {
  return isAutoNodeGroup(collection) || isDefaultNodePool(collection)
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

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
