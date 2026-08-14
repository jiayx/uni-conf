import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Badge } from '@/components/ui/Badge/Badge'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { Input } from '@/components/ui/Input/Input'
import { Modal, ModalClose } from '@/components/ui/Modal/Modal'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { getRemoteRuleSetCompatibilityMode } from '@/core/remote-rules/compatibility'
import { isSystemDisabledRemoteRuleSet, visibleRemoteRuleSetNotes } from '@/core/remote-rules/managed-notes'
import {
  inferQuixoticRuleSetSourceFromUrl,
  RULE_SET_FORMAT_OPTIONS,
} from '@/core/remote-rules/quixotic-presets'
import { api } from '@/lib/api'
import { useRequestedEdit } from '@/core/navigation/use-requested-edit'
import { formValuesEqual, useUnsavedChangesGuard } from '@/core/forms/use-unsaved-changes'
import { useGroupsStore } from '@/store/groups.store'
import { useSettingsStore } from '@/store/settings.store'
import {
  DEFAULT_RULE_TARGET_GROUP_ID,
  FULL_CONFIG_EXPORT_FORMATS,
  GLOBAL_NODE_OUTLET_GROUP_NAMES,
  isRuleTargetGroup,
  RULE_TARGET_FOUNDATION_GROUP_NAMES,
  resolveQuixoticRuleSetForExport as resolveQuixoticPresetSourceForExport,
} from '@uni-conf/shared'
import type {
  ExportFormat,
  ProxySource,
  RemoteRuleSet,
  RemoteRuleSetSourceOverrideTarget,
  RuleSetBehavior,
  RuleSetCatalog,
  RuleSetCatalogItem,
  RuleSetFormat,
  SourceRemoteRuleSetCandidate,
} from '@uni-conf/types'
import styles from './RemoteRuleSets.module.css'

type RemoteSetForm = Omit<RemoteRuleSet, 'id' | 'createdAt' | 'updatedAt'>

const RULE_SET_BEHAVIOR_OPTIONS: Array<{ value: RuleSetBehavior; labelKey: string }> = [
  { value: 'domain', labelKey: 'remoteRuleSets.behavior_domain' },
  { value: 'ipcidr', labelKey: 'remoteRuleSets.behavior_ipcidr' },
  { value: 'classical', labelKey: 'remoteRuleSets.behavior_classical' },
]

const SOURCE_OVERRIDE_TARGETS = FULL_CONFIG_EXPORT_FORMATS

const REQUESTED_EDIT_PARAMS = ['nativeSource'] as const

type CompatibilityMode = 'all' | 'direct' | 'converted' | 'unsupported'
function createEmptyForm(targetGroupId = ''): RemoteSetForm {
  return {
    name: '',
    url: '',
    format: 'text',
    behavior: 'domain',
    sourceOverrides: {},
    targetGroupId,
    updateInterval: 24,
    enabled: true,
    sortOrder: 500,
    notes: '',
  }
}

export function RemoteRuleSets() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirmAction = useConfirmDialog()
  const { groups, fetchGroups } = useGroupsStore()
  const applySettings = useSettingsStore(state => state.applySettings)
  const [sets, setSets] = useState<RemoteRuleSet[]>([])
  const [sources, setSources] = useState<ProxySource[]>([])
  const [quixoticCatalog, setQuixoticCatalog] = useState<RuleSetCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingSet, setEditingSet] = useState<RemoteRuleSet | null>(null)
  const [form, setForm] = useState<RemoteSetForm>(() => createEmptyForm())
  const [initialForm, setInitialForm] = useState<RemoteSetForm>(() => createEmptyForm())
  const [selectedCatalogItemKey, setSelectedCatalogItemKey] = useState('')
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [sourceCandidates, setSourceCandidates] = useState<SourceRemoteRuleSetCandidate[]>([])
  const [loadingSourceCandidates, setLoadingSourceCandidates] = useState(false)
  const [sourceCandidateError, setSourceCandidateError] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [autoDiscoveredSourceOverrides, setAutoDiscoveredSourceOverrides] = useState<RemoteRuleSet['sourceOverrides']>({})
  const [sourceOverridesExpanded, setSourceOverridesExpanded] = useState(false)
  const [sourceOverrideFocusTarget, setSourceOverrideFocusTarget] = useState<RemoteRuleSetSourceOverrideTarget | null>(null)
  const [targetOverrideSet, setTargetOverrideSet] = useState<RemoteRuleSet | null>(null)
  const [targetOverrideGroupId, setTargetOverrideGroupId] = useState('')
  const [targetOverrideError, setTargetOverrideError] = useState('')
  const [savingTargetOverride, setSavingTargetOverride] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [compatibilityTarget, setCompatibilityTarget] = useState<ExportFormat | ''>('')
  const [compatibilityMode, setCompatibilityMode] = useState<CompatibilityMode>('all')
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string> | null>(null)
  const formDirty = showModal && !formValuesEqual(form, initialForm)
  useUnsavedChangesGuard(formDirty)

  useEffect(() => {
    let cancelled = false
    api.remoteRuleSets.list()
      .then(result => { if (!cancelled) setSets(result) })
      .catch(e => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    void fetchGroups()
    void api.settings.get()
      .then(settings => {
        if (!cancelled) applySettings(settings)
      })
      .catch(e => {
        if (!cancelled) setError(e)
      })
    void api.sources.list()
      .then(result => {
        if (!cancelled) setSources(result.filter(source => source.type !== 'manual'))
      })
      .catch(e => { if (!cancelled) setError(e) })
    return () => { cancelled = true }
  }, [applySettings, fetchGroups])

  const ruleTargetGroups = groups.filter(isRuleTargetGroup)
  const enabledGroups = ruleTargetGroups.filter(group => group.enabled)
  const targetGroups = enabledGroups.length > 0 ? enabledGroups : ruleTargetGroups
  const defaultTargetGroupId = DEFAULT_RULE_TARGET_GROUP_ID
  const setsByTargetGroup = useMemo(() => groupSetsByTargetGroup(sets, groups), [groups, sets])
  const defaultExpandedGroupIds = useMemo(
    () => new Set(setsByTargetGroup.length <= 3 ? setsByTargetGroup.map(section => section.groupId) : []),
    [setsByTargetGroup],
  )
  const searchedSections = useMemo(
    () => filterRuleSetSections(setsByTargetGroup, searchQuery),
    [searchQuery, setsByTargetGroup],
  )
  const compatibilityCounts = useMemo(
    () => countCompatibilityModes(searchedSections, compatibilityTarget),
    [compatibilityTarget, searchedSections],
  )
  const compatibilitySections = useMemo(
    () => filterSectionsByCompatibility(searchedSections, compatibilityTarget, compatibilityMode),
    [compatibilityMode, compatibilityTarget, searchedSections],
  )
  const visibleSections = compatibilitySections
  const normalizedSearchQuery = searchQuery.trim()
  const compatibilityFilterActive = compatibilityTarget !== '' && compatibilityMode !== 'all'
  const listFilterActive = normalizedSearchQuery.length > 0 || compatibilityFilterActive
  const resolvedExpandedGroupIds = expandedGroupIds ?? defaultExpandedGroupIds
  const allSectionsExpanded = setsByTargetGroup.length > 0
    && setsByTargetGroup.every(section => resolvedExpandedGroupIds.has(section.groupId))
  const visibleSetCount = visibleSections.reduce((count, section) => count + section.sets.length, 0)
  const selectedFormatOption = RULE_SET_FORMAT_OPTIONS.find(item => item.value === form.format)
  const editingManagedSet = Boolean(editingSet && !canEditRemoteRuleSet(editingSet))
  const editingPresetId = editingSet?.presetSource === 'quixotic' ? editingSet.presetId : undefined
  const formPresetId = form.presetId || editingPresetId
  const formSourceLinked = Boolean(form.sourceId && form.sourceRuleSetKey)
  const inferredQuixoticSource = formPresetId
    ? { id: formPresetId, format: form.format }
    : inferQuixoticRuleSetSourceFromUrl(form.url)
  const discoverableSourceOverrides = inferredQuixoticSource
    ? SOURCE_OVERRIDE_TARGETS.flatMap(target => {
        if (form.sourceOverrides[target]?.trim()) return []
        const resolved = resolveQuixoticPresetSourceForExport(inferredQuixoticSource.id, target)
        return resolved.format === inferredQuixoticSource.format ? [] : [{ target, url: resolved.url }]
      })
    : []
  const loadSets = async () => {
    setLoading(true)
    setError(null)
    try {
      setSets(await api.remoteRuleSets.list())
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  const loadQuixoticCatalog = async () => {
    if (catalogLoading || quixoticCatalog) return
    setCatalogLoading(true)
    setCatalogError('')
    try {
      setQuixoticCatalog(await api.ruleSetCatalogs.getQuixotic())
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : t('remoteRuleSets.quixotic_load_error'))
    } finally {
      setCatalogLoading(false)
    }
  }

  const resetSourceOverrideDiscovery = () => {
    setAutoDiscoveredSourceOverrides({})
  }

  const openCreate = (targetGroupId = defaultTargetGroupId) => {
    const nextForm = createEmptyForm(targetGroupId)
    setEditingSet(null)
    setForm(nextForm)
    setInitialForm(nextForm)
    setSelectedCatalogItemKey('')
    setSelectedSourceId('')
    setSourceCandidates([])
    setSourceCandidateError('')
    setFormError('')
    setSourceOverridesExpanded(false)
    setSourceOverrideFocusTarget(null)
    resetSourceOverrideDiscovery()
    setShowModal(true)
    void loadQuixoticCatalog()
  }

  const openEdit = (set: RemoteRuleSet, focusTarget?: RemoteRuleSetSourceOverrideTarget) => {
    const nextForm: RemoteSetForm = {
      name: set.name,
      url: set.url,
      format: set.format,
      behavior: set.behavior,
      sourceOverrides: { ...set.sourceOverrides },
      targetGroupId: set.targetGroupId,
      updateInterval: set.updateInterval,
      enabled: set.enabled,
      sortOrder: set.sortOrder,
      lastUpdated: set.lastUpdated,
      notes: set.notes ?? '',
      presetSource: set.presetSource,
      presetId: set.presetId,
    }
    setEditingSet(set)
    setForm(nextForm)
    setInitialForm(nextForm)
    setSelectedCatalogItemKey('')
    setSelectedSourceId(set.sourceId ?? '')
    setSourceCandidates([])
    setSourceCandidateError('')
    setFormError('')
    setSourceOverridesExpanded(Boolean(focusTarget))
    setSourceOverrideFocusTarget(focusTarget ?? null)
    resetSourceOverrideDiscovery()
    setShowModal(true)
  }

  const openManagedSourceEditor = (set: RemoteRuleSet, focusTarget?: RemoteRuleSetSourceOverrideTarget) => {
    openEdit(set, focusTarget)
    setSourceOverridesExpanded(true)
  }

  useRequestedEdit(sets, (set, requestParams) => {
    const requestedTarget = requestParams.get('nativeSource')
    openEdit(
      set,
      isSourceOverrideTarget(requestedTarget) ? requestedTarget : undefined,
    )
  }, REQUESTED_EDIT_PARAMS)

  const closeFormModal = () => {
    setShowModal(false)
    setEditingSet(null)
    setFormError('')
    resetSourceOverrideDiscovery()
  }

  const applyCatalogItem = (item: RuleSetCatalogItem, selection: string) => {
    const defaultSource = item.sources.find(source => source.default)
    if (!defaultSource) return
    const sourceOverrides = Object.fromEntries(
      item.sources
        .filter(source => !source.default)
        .flatMap(source => source.nativeFor.map(target => [target, source.url] as const)),
    )
    const suggestedTarget = item.suggestedTarget?.toUpperCase()
    const targetGroupId = suggestedTarget
      ? targetGroups.find(group => group.name.toUpperCase() === suggestedTarget)?.id ?? ''
      : ''

    setSelectedSourceId('')
    setSelectedCatalogItemKey(selection)
    setSourceCandidates([])
    setSourceCandidateError('')
    resetSourceOverrideDiscovery()
    setForm(current => ({
      ...current,
      name: item.name,
      url: defaultSource.url,
      format: defaultSource.format,
      behavior: defaultSource.behavior,
      sourceOverrides,
      targetGroupId,
      updateInterval: 24,
      enabled: true,
      sortOrder: item.sortOrder ?? 500,
      notes: '',
      sourceId: undefined,
      sourceRuleSetKey: undefined,
      sourceMissing: false,
      presetSource: undefined,
      presetId: undefined,
    }))
  }

  const handleSourceOptionChange = async (value: string) => {
    if (value.startsWith('catalog:')) {
      const id = decodeURIComponent(value.slice('catalog:'.length))
      const item = quixoticCatalog?.items.find(candidate => candidate.id === id)
      if (item) applyCatalogItem(item, value)
      return
    }
    if (!value.startsWith('source:')) {
      setSelectedCatalogItemKey('')
      setSelectedSourceId('')
      setForm(current => ({
        ...current,
        sourceId: undefined,
        sourceRuleSetKey: undefined,
        sourceMissing: false,
        presetSource: undefined,
        presetId: undefined,
      }))
      return
    }
    const sourceId = value.slice('source:'.length)
    setSelectedCatalogItemKey('')
    setSelectedSourceId(sourceId)
    setSourceCandidates([])
    setSourceCandidateError('')
    setForm(current => ({
      ...current,
      name: '',
      url: '',
      sourceOverrides: {},
      presetSource: undefined,
      presetId: undefined,
      sourceId: undefined,
      sourceRuleSetKey: undefined,
      sourceMissing: false,
    }))
    setLoadingSourceCandidates(true)
    try {
      setSourceCandidates(await api.sources.listRuleSets(sourceId))
    } catch (candidateError) {
      setSourceCandidateError(candidateError instanceof Error ? candidateError.message : String(candidateError))
    } finally {
      setLoadingSourceCandidates(false)
    }
  }

  const applySourceCandidate = (key: string) => {
    const candidate = sourceCandidates.find(item => item.key === key)
    if (!candidate) return
    const upstreamTarget = candidate.upstreamTarget?.toUpperCase()
    const targetGroupId = upstreamTarget
      ? targetGroups.find(group => group.name.toUpperCase() === upstreamTarget)?.id ?? defaultTargetGroupId
      : defaultTargetGroupId
    setForm(current => ({
      ...current,
      name: candidate.name,
      url: candidate.url,
      format: candidate.format,
      behavior: candidate.behavior,
      targetGroupId,
      updateInterval: candidate.updateInterval,
      sourceId: selectedSourceId,
      sourceRuleSetKey: candidate.key,
      sourceMissing: false,
      presetSource: undefined,
      presetId: undefined,
      notes: '',
    }))
  }

  const handleFormatChange = (format: RuleSetFormat) => {
    setFormValue('format', format, setForm)
  }

  const handleSave = async () => {
    const formPayload: RemoteSetForm = {
      ...form,
      name: form.name.trim(),
      url: form.url.trim(),
      targetGroupId: form.targetGroupId,
      notes: form.notes?.trim() ?? '',
      updateInterval: Number(form.updateInterval) || 24,
      sortOrder: Number(form.sortOrder) || 500,
      sourceOverrides: Object.fromEntries(
        Object.entries(form.sourceOverrides)
          .map(([target, url]) => [target, url?.trim()])
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
      ),
    }
    const payload: Omit<RemoteRuleSet, 'id' | 'createdAt' | 'updatedAt'> = {
      name: formPayload.name,
      url: formPayload.url,
      format: formPayload.format,
      behavior: formPayload.behavior,
      sourceOverrides: formPayload.sourceOverrides,
      sourceId: formPayload.sourceId,
      sourceRuleSetKey: formPayload.sourceRuleSetKey,
      sourceMissing: formPayload.sourceMissing,
      targetGroupId: formPayload.targetGroupId,
      updateInterval: formPayload.updateInterval,
      enabled: formPayload.enabled,
      sortOrder: formPayload.sortOrder,
      notes: formPayload.notes,
    }

    if (!payload.name || !payload.url || !payload.targetGroupId) {
      setFormError(t('remoteRuleSets.required_error'))
      return
    }

    setFormError('')
    setSaving(true)
    try {
      if (editingSet) {
        const updated = await api.remoteRuleSets.update(
          editingSet.id,
          editingManagedSet ? { sourceOverrides: payload.sourceOverrides } : payload,
        )
        setSets(current => current.map(item => (item.id === editingSet.id ? updated : item)))
      } else {
        const created = await api.remoteRuleSets.create(payload)
        setSets(current => [created, ...current])
      }

      setShowModal(false)
      setEditingSet(null)
    } catch (saveError) {
      setFormError(saveError instanceof Error && saveError.message
        ? saveError.message
        : t('remoteRuleSets.save_error'))
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (set: RemoteRuleSet, usableByCurrentRouting: boolean) => {
    if (!usableByCurrentRouting && !set.enabled) {
      setError(t('remoteRuleSets.disabled_target_error'))
      return
    }
    setError(null)
    try {
      const updated = await api.remoteRuleSets.update(set.id, { enabled: !set.enabled })
      setSets(current => current.map(item => (item.id === set.id ? updated : item)))
    } catch (e) {
      setError(e)
    }
  }

  const handleDelete = async (set: RemoteRuleSet) => {
    if (!(await confirmAction({
      description: t('remoteRuleSets.delete_confirm', { name: set.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    await api.remoteRuleSets.remove(set.id)
    setSets(current => current.filter(item => item.id !== set.id))
  }

  const handleSourceOverrideChange = (target: RemoteRuleSetSourceOverrideTarget, url: string) => {
    setAutoDiscoveredSourceOverrides(current => {
      const next = { ...current }
      delete next[target]
      return next
    })
    setForm(current => ({
      ...current,
      sourceOverrides: { ...current.sourceOverrides, [target]: url },
    }))
  }

  const handleDefaultSourceUrlChange = (url: string) => {
    setForm(current => {
      const sourceOverrides = { ...current.sourceOverrides }
      for (const [target, discoveredUrl] of Object.entries(autoDiscoveredSourceOverrides)) {
        const typedTarget = target as RemoteRuleSetSourceOverrideTarget
        if (sourceOverrides[typedTarget] === discoveredUrl) delete sourceOverrides[typedTarget]
      }
      return { ...current, url, sourceOverrides }
    })
    resetSourceOverrideDiscovery()
  }

  const handleDiscoverSourceOverrides = () => {
    if (discoverableSourceOverrides.length === 0) return
    const discovered = Object.fromEntries(
      discoverableSourceOverrides.map(candidate => [candidate.target, candidate.url])
    ) as RemoteRuleSet['sourceOverrides']
    setForm(current => {
      const sourceOverrides = { ...current.sourceOverrides }
      for (const [target, url] of Object.entries(discovered)) {
        const typedTarget = target as RemoteRuleSetSourceOverrideTarget
        if (!sourceOverrides[typedTarget]?.trim()) sourceOverrides[typedTarget] = url
      }
      return { ...current, sourceOverrides }
    })
    setAutoDiscoveredSourceOverrides(current => ({ ...current, ...discovered }))
  }

  const openTargetOverride = (ruleSet: RemoteRuleSet) => {
    setTargetOverrideSet(ruleSet)
    setTargetOverrideGroupId(ruleSet.targetOverrideGroupId ?? '')
    setTargetOverrideError('')
  }

  const closeTargetOverride = () => {
    setTargetOverrideSet(null)
    setTargetOverrideGroupId('')
    setTargetOverrideError('')
  }

  const saveTargetOverride = async () => {
    if (!targetOverrideSet) return
    setSavingTargetOverride(true)
    setTargetOverrideError('')
    try {
      const updated = await api.remoteRuleSets.update(targetOverrideSet.id, {
        targetOverrideGroupId: targetOverrideGroupId || null,
      })
      setSets(current => current.map(item => item.id === updated.id ? updated : item))
      closeTargetOverride()
    } catch (error) {
      setTargetOverrideError(error instanceof Error ? error.message : String(error))
    } finally {
      setSavingTargetOverride(false)
    }
  }

  const toggleSection = (groupId: string) => {
    setExpandedGroupIds(current => {
      const next = new Set(current ?? defaultExpandedGroupIds)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('remoteRuleSets.title')}
        description={t('remoteRuleSets.description', { strategyCount: setsByTargetGroup.length, setCount: sets.length })}
        actions={
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => void loadSets()} loading={loading}>{t('common.refresh')}</Button>
            <Button onClick={() => openCreate()} icon={<PlusIcon />}>{t('remoteRuleSets.add_supplement')}</Button>
          </div>
        }
      />

      {error != null && <ErrorNotice error={error} className={styles.error} />}

      <section className={styles.foundationPanel}>
        <div>
          <div className={styles.foundationTitle}>{t('remoteRuleSets.foundation_title')}</div>
          <div className={styles.foundationMeta}>{t('remoteRuleSets.foundation_meta')}</div>
        </div>
        <div className={styles.foundationRows}>
          <div className={styles.foundationRow}>
            <span className={styles.foundationLabel}>{t('groups.rule_foundation')}</span>
            <div className={styles.foundationBadges}>
              {RULE_TARGET_FOUNDATION_GROUP_NAMES.map(name => (
                <Badge key={name} variant="default">{name}</Badge>
              ))}
            </div>
          </div>
          <div className={styles.foundationRow}>
            <span className={styles.foundationLabel}>{t('groups.node_outlets')}</span>
            <div className={styles.foundationBadges}>
              {GLOBAL_NODE_OUTLET_GROUP_NAMES.map(name => (
                <Badge key={name} variant="default">{name}</Badge>
              ))}
            </div>
          </div>
        </div>
      </section>

      {loading && sets.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : sets.length === 0 ? (
        <EmptyState
          title={t('remoteRuleSets.empty_title')}
          description={t('remoteRuleSets.empty_description')}
          action={{ label: t('remoteRuleSets.add_supplement'), onClick: () => openCreate() }}
        />
      ) : (
        <div className={styles.groupedList}>
          <div className={styles.listToolbar}>
            <Input
              id="rule-set-search"
              label={t('remoteRuleSets.search_label')}
              placeholder={t('remoteRuleSets.search_placeholder')}
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
            />
            <div>
              <label className={styles.label} htmlFor="rule-set-compatibility-target">
                {t('remoteRuleSets.compatibility_target')}
              </label>
              <select
                id="rule-set-compatibility-target"
                className={styles.select}
                value={compatibilityTarget}
                onChange={event => {
                  const target = event.target.value as ExportFormat | ''
                  setCompatibilityTarget(target)
                  setCompatibilityMode('all')
                }}
              >
                <option value="">{t('remoteRuleSets.compatibility_target_all')}</option>
                {SOURCE_OVERRIDE_TARGETS.map(format => (
                  <option key={format} value={format}>{t(`export.formats.${format}`)}</option>
                ))}
              </select>
            </div>
            <div className={styles.listToolbarActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setExpandedGroupIds(allSectionsExpanded
                  ? new Set()
                  : new Set(setsByTargetGroup.map(section => section.groupId)))}
                disabled={listFilterActive}
              >{t(allSectionsExpanded ? 'remoteRuleSets.collapse_all' : 'remoteRuleSets.expand_all')}</Button>
            </div>
            <div className={styles.toolbarSummary} aria-live="polite">
              <div className={styles.searchSummary}>
                {listFilterActive
                  ? t('remoteRuleSets.search_results', { setCount: visibleSetCount, strategyCount: visibleSections.length })
                  : t('remoteRuleSets.browse_hint')}
              </div>
              {compatibilityTarget && (
                <div className={styles.compatibilityFilters} aria-label={t('remoteRuleSets.compatibility_filter_label')}>
                  {(['all', 'direct', 'converted', 'unsupported'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      className={`${styles.compatibilityFilter} ${compatibilityMode === mode ? styles.compatibilityFilterActive : ''}`}
                      aria-pressed={compatibilityMode === mode}
                      disabled={mode !== 'all' && compatibilityCounts[mode] === 0}
                      onClick={() => setCompatibilityMode(mode)}
                    >
                      {t(`remoteRuleSets.compatibility_${mode}`, {
                        count: mode === 'all'
                          ? compatibilityCounts.direct + compatibilityCounts.converted + compatibilityCounts.unsupported
                          : compatibilityCounts[mode],
                      })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {visibleSections.length === 0 ? (
            <EmptyState
              title={t('remoteRuleSets.no_search_results')}
              description={t(compatibilityFilterActive
                ? 'remoteRuleSets.no_compatibility_results_help'
                : 'remoteRuleSets.no_search_results_help')}
            />
          ) : visibleSections.map(section => {
            const sectionExpanded = listFilterActive || resolvedExpandedGroupIds.has(section.groupId)
            const contentId = `rule-set-section-${section.groupId}`
            const activeCount = section.sets.filter(set =>
              set.enabled && isRuleSetUsableByCurrentRouting(section.targetEnabled)
            ).length
            return (
            <section key={section.groupId} className={styles.ruleSetSection}>
              <div className={styles.sectionHeader}>
                <button
                  type="button"
                  className={styles.sectionToggle}
                  aria-expanded={sectionExpanded}
                  aria-controls={contentId}
                  aria-label={t('remoteRuleSets.toggle_section', { name: section.groupName })}
                  onClick={() => toggleSection(section.groupId)}
                >
                  <ChevronIcon expanded={sectionExpanded} />
                  <div>
                    <div className={styles.sectionTitle}>{section.groupName}</div>
                    <div className={styles.sectionMeta}>
                      {t('remoteRuleSets.section_meta', {
                        activeCount,
                        inactiveCount: section.sets.length - activeCount,
                      })}
                    </div>
                  </div>
                  {!section.targetEnabled && (
                    <span className={styles.sectionStatus}>
                      <Badge variant="default">{t('remoteRuleSets.target_disabled')}</Badge>
                    </span>
                  )}
                </button>
              </div>
              {sectionExpanded && <div id={contentId} className={styles.grid}>
                {section.sets.map(set => {
                  const hasSourceOverrides = Object.keys(set.sourceOverrides).length > 0
                  const managed = !canEditRemoteRuleSet(set)
                  const usableByCurrentRouting = isRuleSetUsableByCurrentRouting(
                    section.targetEnabled,
                  )
                  const automaticallyUnused = managed
                    && (!usableByCurrentRouting || isSystemDisabledRemoteRuleSet(set.notes))
                  const effective = usableByCurrentRouting && set.enabled && !automaticallyUnused
                  return (
                  <Card key={set.id} className={`${styles.card} ${effective ? '' : styles.cardInactive}`}>
                    <div className={styles.cardHeader}>
                      {automaticallyUnused ? (
                        <Badge variant="default">{t('remoteRuleSets.automatically_unused')}</Badge>
                      ) : (
                        <label className={styles.enableSwitch}>
                          <input
                            type="checkbox"
                            checked={set.enabled}
                            onChange={() => void handleToggle(set, usableByCurrentRouting)}
                            disabled={!usableByCurrentRouting && !set.enabled}
                          />
                          <span>{set.enabled ? t('common.enabled') : t('common.disabled')}</span>
                        </label>
                      )}
                      <div className={styles.cardTitle}>{set.name}</div>
                    </div>
                    <div className={styles.meta}>
                      <Badge variant="info">{ruleSetBadgeLabel(set, t)}</Badge>
                      <Badge variant="default">{ruleSetBehaviorLabel(set.behavior, t)}</Badge>
                      <Badge variant="default">{set.updateInterval}h</Badge>
                      {set.sourceId && !set.sourceMissing && (
                        <Badge variant="success">{t('remoteRuleSets.subscription_linked')}</Badge>
                      )}
                      {set.sourceMissing && (
                        <Badge variant="warning">{t('remoteRuleSets.subscription_missing')}</Badge>
                      )}
                      {hasSourceOverrides && (
                        <Badge variant="success">{t('remoteRuleSets.source_override_badge', { count: Object.keys(set.sourceOverrides).length })}</Badge>
                      )}
                      {compatibilityTarget && (
                        <CompatibilityBadge mode={getRemoteRuleSetCompatibilityMode(compatibilityTarget, set)} />
                      )}
                      {set.targetOverrideGroupId && (
                        <Badge variant="purple">
                          {t('remoteRuleSets.target_override_badge', {
                            default: groups.find(group => group.id === set.defaultTargetGroupId)?.name ?? set.defaultTargetGroupId,
                            target: groups.find(group => group.id === set.targetGroupId)?.name ?? set.targetGroupId,
                          })}
                        </Badge>
                      )}
                    </div>
                    <div className={styles.url}>{set.url}</div>
                    {automaticallyUnused && (
                      <div className={styles.systemNotice}>
                        <span>{t('remoteRuleSets.system_disabled_notice')}</span>
                        <div className={styles.systemNoticeActions}>
                          <Button variant="ghost" size="sm" onClick={() => void navigate('/groups')}>
                            {t('remoteRuleSets.adjust_routing_plan')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openTargetOverride(set)}>
                            {t('remoteRuleSets.change_target')}
                          </Button>
                        </div>
                      </div>
                    )}
                    {visibleRemoteRuleSetNotes(set.notes) && <div className={styles.notes}>{visibleRemoteRuleSetNotes(set.notes)}</div>}
                    <div className={styles.cardActions}>
                      {canEditRemoteRuleSet(set) ? (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(set)}>
                          {t('common.edit')}
                        </Button>
                      ) : (
                        <>
                          {!automaticallyUnused && (
                            <Button variant="ghost" size="sm" onClick={() => openTargetOverride(set)}>
                              {t('remoteRuleSets.change_target')}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => openManagedSourceEditor(set)}>
                            {t('remoteRuleSets.configure_native_sources')}
                          </Button>
                          <Badge variant="default">{t('remoteRuleSets.system_managed')}</Badge>
                        </>
                      )}
                      {canEditRemoteRuleSet(set) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('common.delete')}
                          onClick={() => void handleDelete(set)}
                        >
                          <TrashIcon />
                        </Button>
                      )}
                    </div>
                  </Card>
                  )
                })}
              </div>}
            </section>
            )
          })}
        </div>
      )}

      <Modal
        open={targetOverrideSet !== null}
        onOpenChange={open => { if (!open) closeTargetOverride() }}
        title={t('remoteRuleSets.target_override_title', { name: targetOverrideSet?.name ?? '' })}
        footer={
          <>
            <ModalClose><Button variant="secondary" disabled={savingTargetOverride}>{t('common.cancel')}</Button></ModalClose>
            <Button loading={savingTargetOverride} onClick={() => void saveTargetOverride()}>{t('common.save')}</Button>
          </>
        }
      >
        {targetOverrideError && <div className={styles.formError} role="alert">{targetOverrideError}</div>}
        <div>
          <label className={styles.label} htmlFor="remote-rule-set-target-override">
            {t('remoteRuleSets.new_destination')}
          </label>
          <select
            id="remote-rule-set-target-override"
            className={styles.select}
            value={targetOverrideGroupId}
            onChange={event => setTargetOverrideGroupId(event.target.value)}
          >
            <option value="">
              {t('remoteRuleSets.use_default_target', {
                target: groups.find(group => group.id === targetOverrideSet?.defaultTargetGroupId)?.name
                  ?? targetOverrideSet?.defaultTargetGroupId
                  ?? '',
              })}
            </option>
            {targetGroups
              .filter(group => group.id !== targetOverrideSet?.defaultTargetGroupId)
              .map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
              ))}
          </select>
          <div className={styles.helperText}>{t('remoteRuleSets.target_override_help')}</div>
        </div>
      </Modal>

      <Modal
        open={showModal}
        dirty={formDirty}
        onOpenChange={open => {
          if (!open) closeFormModal()
        }}
        title={editingManagedSet
          ? t('remoteRuleSets.configure_managed_sources_title', { name: editingSet?.name ?? '' })
          : editingSet ? t('remoteRuleSets.edit_supplement') : t('remoteRuleSets.add_supplement')}
        footer={
          <>
            <ModalClose><Button variant="secondary" disabled={saving}>{t('common.cancel')}</Button></ModalClose>
            <Button loading={saving} onClick={() => void handleSave()}>{t('common.save')}</Button>
          </>
        }
      >
        {formError && <div className={styles.formError} role="alert">{formError}</div>}
        {!editingSet && (
          <div className={styles.presetSection}>
            <label className={styles.label} htmlFor="remote-rule-set-preset">{t('remoteRuleSets.source_selection_label')}</label>
            <select
              id="remote-rule-set-preset"
              className={styles.select}
              value={selectedSourceId
                ? `source:${selectedSourceId}`
                : selectedCatalogItemKey}
              onChange={e => void handleSourceOptionChange(e.target.value)}
            >
              <option value="">{t('remoteRuleSets.manual_url_option')}</option>
              {sources.length > 0 && (
                <optgroup label={t('remoteRuleSets.subscription_sources')}>
                  {sources.map(source => (
                    <option key={source.id} value={`source:${source.id}`}>{source.name}</option>
                  ))}
                </optgroup>
              )}
              {catalogLoading && <option disabled>{t('common.loading')}</option>}
              {quixoticCatalog && (
                <optgroup label="QuixoticHeart">
                  {quixoticCatalog.items.map(item => (
                    <option key={item.id} value={`catalog:${encodeURIComponent(item.id)}`}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className={styles.helperText}>
              {t('remoteRuleSets.preset_help')}
            </div>
            {catalogError && (
              <div className={styles.formError} role="alert">
                {t('remoteRuleSets.quixotic_load_error')}: {catalogError}
              </div>
            )}
            {selectedSourceId && (
              <div>
                <label className={styles.label} htmlFor="remote-rule-set-source-candidate">
                  {t('remoteRuleSets.subscription_rule_set')}
                </label>
                <select
                  id="remote-rule-set-source-candidate"
                  className={styles.select}
                  value={form.sourceRuleSetKey ?? ''}
                  disabled={loadingSourceCandidates}
                  onChange={event => applySourceCandidate(event.target.value)}
                >
                  <option value="">{loadingSourceCandidates
                    ? t('common.loading')
                    : t('remoteRuleSets.select_subscription_rule_set')}</option>
                  {sourceCandidates.map(candidate => {
                    const alreadyAdded = sets.some(set =>
                      set.sourceId === selectedSourceId && set.sourceRuleSetKey === candidate.key
                    )
                    return (
                      <option key={candidate.key} value={candidate.key} disabled={alreadyAdded}>
                        {candidate.name} · {candidate.upstreamTarget ?? t('remoteRuleSets.unreferenced')}
                        {alreadyAdded ? ` · ${t('remoteRuleSets.already_added')}` : ''}
                      </option>
                    )
                  })}
                </select>
                {sourceCandidateError && <div className={styles.formError} role="alert">{sourceCandidateError}</div>}
                {!loadingSourceCandidates && !sourceCandidateError && sourceCandidates.length === 0 && (
                  <div className={styles.helperText}>{t('remoteRuleSets.no_subscription_rule_sets')}</div>
                )}
              </div>
            )}
          </div>
        )}
        {editingManagedSet ? (
          <div className={styles.managedSourceNotice}>
            <strong>{form.name}</strong>
            <span>{t('remoteRuleSets.managed_sources_help')}</span>
          </div>
        ) : (
          <Input label={t('common.name')} value={form.name} onChange={e => setFormValue('name', e.target.value, setForm)} />
        )}
        {formPresetId ? (
          <div>
            <label className={styles.label}>{t('remoteRuleSets.source_label')}</label>
            <div className={styles.helperText}>{t(editingManagedSet
              ? 'remoteRuleSets.managed_preset_source_help'
              : 'remoteRuleSets.preset_source_help', { presetId: formPresetId })}</div>
          </div>
        ) : formSourceLinked ? (
          <div>
            <label className={styles.label}>{t('remoteRuleSets.source_label')}</label>
            <div className={styles.helperText}>
              {t('remoteRuleSets.subscription_source_linked', {
                source: sources.find(source => source.id === form.sourceId)?.name ?? form.sourceId,
                ruleSet: form.sourceRuleSetKey,
              })}
            </div>
          </div>
        ) : (
          <>
            <Input label="URL" value={form.url} onChange={e => handleDefaultSourceUrlChange(e.target.value)} />
            <div>
              <label className={styles.label} htmlFor="remote-rule-set-format">{t('remoteRuleSets.format_label')}</label>
              <select id="remote-rule-set-format" className={styles.select} value={form.format} onChange={e => handleFormatChange(e.target.value as RuleSetFormat)}>
                {RULE_SET_FORMAT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {selectedFormatOption && (
                <div className={styles.helperText}>{t('remoteRuleSets.export_targets', { targets: selectedFormatOption.exportTargets })}</div>
              )}
            </div>
            <div>
              <label className={styles.label} htmlFor="remote-rule-set-behavior">{t('remoteRuleSets.behavior_label')}</label>
              <select id="remote-rule-set-behavior" className={styles.select} value={form.behavior} onChange={e => setFormValue('behavior', e.target.value as RuleSetBehavior, setForm)}>
                {RULE_SET_BEHAVIOR_OPTIONS.map(option => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
              </select>
              <div className={styles.helperText}>{t('remoteRuleSets.behavior_help')}</div>
            </div>
          </>
        )}
        <details
              className={styles.sourceOverrides}
              open={sourceOverridesExpanded}
              onToggle={event => setSourceOverridesExpanded(event.currentTarget.open)}
            >
              <summary>{t('remoteRuleSets.source_overrides_title')}</summary>
              <div className={styles.helperText}>{t('remoteRuleSets.source_overrides_help')}</div>
              <div className={styles.sourceOverrideBulkActions}>
                {discoverableSourceOverrides.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDiscoverSourceOverrides}
                  >{t('remoteRuleSets.source_override_discover', { count: discoverableSourceOverrides.length })}</Button>
                )}
                {Object.keys(autoDiscoveredSourceOverrides).length > 0 && (
                  <span className={styles.sourceOverrideDiscoveryNotice}>
                    {t('remoteRuleSets.source_override_discovered', { count: Object.keys(autoDiscoveredSourceOverrides).length })}
                  </span>
                )}
              </div>
              <div className={styles.sourceOverrideGrid}>
                {SOURCE_OVERRIDE_TARGETS.map(target => {
                  const clientName = t(`export.formats.${target}`)
                  const url = form.sourceOverrides[target] ?? ''
                  return (
                    <div className={styles.sourceOverrideField} key={target}>
                      <Input
                        label={t('remoteRuleSets.source_override_label', { client: clientName })}
                        type="url"
                        placeholder={t('remoteRuleSets.source_override_placeholder')}
                        value={url}
                        autoFocus={sourceOverrideFocusTarget === target}
                        onChange={event => handleSourceOverrideChange(target, event.target.value)}
                      />
                    </div>
                  )
                })}
              </div>
        </details>

        {!editingManagedSet && (
          <>
            <div>
              <label className={styles.label} htmlFor="remote-rule-set-target">{t('remoteRuleSets.traffic_destination')}</label>
              <select id="remote-rule-set-target" className={styles.select} value={form.targetGroupId} onChange={e => setFormValue('targetGroupId', e.target.value, setForm)}>
                <option value="">{t('remoteRuleSets.default_target')}</option>
                {targetGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
              <div className={styles.helperText}>{t('remoteRuleSets.traffic_destination_help')}</div>
            </div>
            {!formSourceLinked && (
              <Input label={t('remoteRuleSets.update_interval')} type="number" min="1" value={form.updateInterval} onChange={e => setFormValue('updateInterval', Number(e.target.value), setForm)} />
            )}
            <Input label={t('common.notes')} value={form.notes ?? ''} onChange={e => setFormValue('notes', e.target.value, setForm)} />
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={form.enabled} onChange={e => setFormValue('enabled', e.target.checked, setForm)} />
              <span>{t('common.enabled')}</span>
            </label>
          </>
        )}
      </Modal>
    </div>
  )
}

function CompatibilityBadge({ mode }: { mode: Exclude<CompatibilityMode, 'all'> }) {
  const { t } = useTranslation()
  const variant = mode === 'direct' ? 'success' : mode === 'converted' ? 'info' : 'error'
  return <Badge variant={variant}>{t(`remoteRuleSets.preview_mode_${mode}`)}</Badge>
}

function isSourceOverrideTarget(value: string | null): value is RemoteRuleSetSourceOverrideTarget {
  return value !== null && SOURCE_OVERRIDE_TARGETS.some(target => target === value)
}

function setFormValue<K extends keyof RemoteSetForm>(
  key: K,
  value: RemoteSetForm[K],
  setForm: React.Dispatch<React.SetStateAction<RemoteSetForm>>
) {
  setForm(current => ({ ...current, [key]: value }))
}

function ruleSetBadgeLabel(set: Pick<RemoteRuleSet, 'format' | 'presetSource'>, t: (key: string) => string): string {
  if (set.presetSource === 'quixotic') return t('remoteRuleSets.preset_badge')
  if (set.presetSource) return t('remoteRuleSets.builtin_badge')
  return set.format
}

function ruleSetBehaviorLabel(behavior: RuleSetBehavior, t: (key: string) => string): string {
  const option = RULE_SET_BEHAVIOR_OPTIONS.find(option => option.value === behavior)
  return option ? t(option.labelKey) : behavior
}

function canEditRemoteRuleSet(set: Pick<RemoteRuleSet, 'presetSource' | 'presetId'>): boolean {
  return !(set.presetSource && set.presetId)
}

function groupSetsByTargetGroup(sets: RemoteRuleSet[], groups: Array<{ id: string; name: string; order?: number; enabled?: boolean }>) {
  const byId = new Map(groups.map(group => [group.id, group.name]))
  const orderById = new Map(groups.map((group, index) => [group.id, group.order ?? index]))
  const enabledById = new Map(groups.map(group => [group.id, group.enabled !== false]))
  const sections = new Map<string, { groupId: string; groupName: string; targetEnabled: boolean; sets: RemoteRuleSet[] }>()

  for (const set of sets) {
    const groupId = set.targetGroupId
    const groupName = byId.get(groupId) ?? groupId
    const section = sections.get(groupId) ?? {
      groupId,
      groupName,
      targetEnabled: enabledById.get(groupId) ?? false,
      sets: [],
    }
    section.sets.push(set)
    sections.set(groupId, section)
  }

  return [...sections.values()]
    .map(section => ({
      ...section,
      sets: section.sets.sort((a, b) =>
        Number(b.enabled) - Number(a.enabled)
        || a.sortOrder - b.sortOrder
        || a.name.localeCompare(b.name)
      ),
    }))
    .sort((a, b) =>
      Number(b.targetEnabled) - Number(a.targetEnabled)
      || (orderById.get(a.groupId) ?? 9999) - (orderById.get(b.groupId) ?? 9999)
      || a.groupName.localeCompare(b.groupName)
    )
}

function isRuleSetUsableByCurrentRouting(
  targetEnabled: boolean,
): boolean {
  return targetEnabled
}

function filterRuleSetSections<T extends { groupName: string; sets: RemoteRuleSet[] }>(sections: T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return sections

  return sections.flatMap(section => {
    const groupMatches = section.groupName.toLocaleLowerCase().includes(normalizedQuery)
    const matchingSets = groupMatches ? section.sets : section.sets.filter(set => [
      set.name,
      set.url,
      set.format,
      set.behavior,
      visibleRemoteRuleSetNotes(set.notes) ?? '',
    ].some(value => value.toLocaleLowerCase().includes(normalizedQuery)))
    return matchingSets.length > 0 ? [{ ...section, sets: matchingSets }] : []
  })
}

function countCompatibilityModes<T extends { sets: RemoteRuleSet[] }>(
  sections: T[],
  target: ExportFormat | '',
): Record<Exclude<CompatibilityMode, 'all'>, number> {
  const counts = { direct: 0, converted: 0, unsupported: 0 }
  if (!target) return counts
  for (const section of sections) {
    for (const set of section.sets) counts[getRemoteRuleSetCompatibilityMode(target, set)] += 1
  }
  return counts
}

function filterSectionsByCompatibility<T extends { sets: RemoteRuleSet[] }>(
  sections: T[],
  target: ExportFormat | '',
  mode: CompatibilityMode,
): T[] {
  if (!target || mode === 'all') return sections
  return sections.flatMap(section => {
    const matchingSets = section.sets.filter(set => getRemoteRuleSetCompatibilityMode(target, set) === mode)
    return matchingSets.length > 0 ? [{ ...section, sets: matchingSets }] : []
  })
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}

function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
