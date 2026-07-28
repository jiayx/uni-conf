import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
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
import { getDefaultRuleTargetGroupId, isRuleTargetGroup } from '@/core/groups/rule-target-groups'
import { getRemoteRuleSetCompatibilityMode } from '@/core/remote-rules/compatibility'
import { isSystemDisabledRemoteRuleSet, visibleRemoteRuleSetNotes } from '@/core/remote-rules/managed-notes'
import {
  inferQuixoticRuleSetSourceFromUrl,
  RULE_SET_FORMAT_OPTIONS,
} from '@/core/remote-rules/quixotic-presets'
import { api, ApiError } from '@/lib/api'
import { useRequestedEdit } from '@/core/navigation/use-requested-edit'
import { formValuesEqual, useUnsavedChangesGuard } from '@/core/forms/use-unsaved-changes'
import { useGroupsStore } from '@/store/groups.store'
import { useSettingsStore } from '@/store/settings.store'
import {
  FULL_CONFIG_EXPORT_FORMATS,
  GLOBAL_NODE_OUTLET_GROUP_NAMES,
  RULE_TARGET_FOUNDATION_GROUP_NAMES,
  resolveQuixoticRuleSetForExport as resolveQuixoticPresetSourceForExport,
} from '@uni-conf/shared'
import type {
  ExportFormat,
  ProxySource,
  RemoteRuleSet,
  RemoteRuleSetConversionPreview,
  RemoteRuleSetSourceHealthResult,
  RemoteRuleSetSourceOverrideTarget,
  RemoteRuleSetSourceValidationInput,
  RemoteRuleSetValidationResult,
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

const CONVERSION_PREVIEW_TARGETS = FULL_CONFIG_EXPORT_FORMATS
const SOURCE_OVERRIDE_TARGETS = FULL_CONFIG_EXPORT_FORMATS

const REQUESTED_EDIT_PARAMS = ['nativeSource'] as const

interface ConversionPreviewState {
  ruleSet: RemoteRuleSet
  targetFormat: ExportFormat
  status: 'loading' | 'ready' | 'error'
  result?: RemoteRuleSetConversionPreview
  error?: string
}

interface SourceOverrideValidationState {
  status: 'loading' | 'ready' | 'error'
  result?: RemoteRuleSetValidationResult
  error?: string
  code?: string
}

type CompatibilityMode = 'all' | 'direct' | 'converted' | 'unsupported'
type AttentionMode = 'all' | 'attention'

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
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [validationById, setValidationById] = useState<Record<string, RemoteRuleSetValidationResult>>({})
  const [sourceHealthById, setSourceHealthById] = useState<Record<string, RemoteRuleSetSourceHealthResult>>({})
  const [conversionPreview, setConversionPreview] = useState<ConversionPreviewState | null>(null)
  const [sourceOverrideValidations, setSourceOverrideValidations] = useState<Partial<Record<RemoteRuleSetSourceOverrideTarget, SourceOverrideValidationState>>>({})
  const [validatingAllSourceOverrides, setValidatingAllSourceOverrides] = useState(false)
  const [autoDiscoveredSourceOverrides, setAutoDiscoveredSourceOverrides] = useState<RemoteRuleSet['sourceOverrides']>({})
  const [validateAfterDiscovery, setValidateAfterDiscovery] = useState(false)
  const [sourceOverridesExpanded, setSourceOverridesExpanded] = useState(false)
  const [sourceOverrideFocusTarget, setSourceOverrideFocusTarget] = useState<RemoteRuleSetSourceOverrideTarget | null>(null)
  const [targetOverrideSet, setTargetOverrideSet] = useState<RemoteRuleSet | null>(null)
  const [targetOverrideGroupId, setTargetOverrideGroupId] = useState('')
  const [targetOverrideError, setTargetOverrideError] = useState('')
  const [savingTargetOverride, setSavingTargetOverride] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [compatibilityTarget, setCompatibilityTarget] = useState<ExportFormat | ''>('')
  const [compatibilityMode, setCompatibilityMode] = useState<CompatibilityMode>('all')
  const [attentionMode, setAttentionMode] = useState<AttentionMode>(
    () => searchParams.get('attention') === '1' ? 'attention' : 'all',
  )
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string> | null>(null)
  const conversionRequestId = useRef(0)
  const sourceOverrideRequestIds = useRef<Partial<Record<RemoteRuleSetSourceOverrideTarget, number>>>({})
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
  const defaultTargetGroupId = getDefaultRuleTargetGroupId(targetGroups)
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
  const needsAttention = (set: RemoteRuleSet, targetEnabled: boolean) => ruleSetNeedsAttention(
    set,
    targetEnabled,
    sourceHealthById[set.id] ?? set.sourceHealth,
    validationById[set.id],
    compatibilityTarget,
  )
  const attentionCount = countRuleSets(compatibilitySections, needsAttention)
  const visibleSections = filterRuleSetSectionsByPredicate(
    compatibilitySections,
    attentionMode === 'attention' ? needsAttention : () => true,
  )
  const normalizedSearchQuery = searchQuery.trim()
  const compatibilityFilterActive = compatibilityTarget !== '' && compatibilityMode !== 'all'
  const attentionFilterActive = attentionMode === 'attention'
  const listFilterActive = normalizedSearchQuery.length > 0 || compatibilityFilterActive || attentionFilterActive
  const resolvedExpandedGroupIds = expandedGroupIds ?? defaultExpandedGroupIds
  const visibleSetCount = visibleSections.reduce((count, section) => count + section.sets.length, 0)
  const changeAttentionMode = (mode: AttentionMode) => {
    setAttentionMode(mode)
    const nextParams = new URLSearchParams(searchParams)
    if (mode === 'attention') nextParams.set('attention', '1')
    else nextParams.delete('attention')
    setSearchParams(nextParams, { replace: true })
  }
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
  const configuredSourceOverrides = SOURCE_OVERRIDE_TARGETS.flatMap(target => {
    const url = form.sourceOverrides[target]?.trim()
    return url ? [{ url, targetFormat: target, behavior: form.behavior }] : []
  })
  const sourceOverrideSummary = configuredSourceOverrides.reduce(
    (summary, source) => {
      const validation = sourceOverrideValidations[source.targetFormat]
      if (validation?.result) summary[validation.result.status] += 1
      else if (validation?.status === 'error') summary.error += 1
      return summary
    },
    { valid: 0, warning: 0, invalid: 0, error: 0 },
  )
  const checkedSourceOverrideCount = Object.values(sourceOverrideSummary).reduce((sum, count) => sum + count, 0)
  const configuredSourceOverrideTargets = new Set(configuredSourceOverrides.map(source => source.targetFormat))
  const sourceOverrideInputErrorCount = SOURCE_OVERRIDE_TARGETS.filter(target => {
    if (!configuredSourceOverrideTargets.has(target)) return false
    const validation = sourceOverrideValidations[target]
    return validation?.status === 'error' && ['unsafe_url', 'invalid_format', 'invalid_behavior'].includes(validation.code ?? '')
  }).length
  const sourceOverrideSaveRiskCount = SOURCE_OVERRIDE_TARGETS.filter(target => {
    if (!configuredSourceOverrideTargets.has(target)) return false
    const validation = sourceOverrideValidations[target]
    if (validation?.result?.status === 'invalid') return true
    return validation?.status === 'error' && !['unsafe_url', 'invalid_format', 'invalid_behavior'].includes(validation.code ?? '')
  }).length

  const loadSets = async () => {
    setLoading(true)
    setError(null)
    try {
      setSets(await api.remoteRuleSets.list())
      setSourceHealthById({})
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

  const resetSourceOverrideValidations = () => {
    for (const target of SOURCE_OVERRIDE_TARGETS) {
      sourceOverrideRequestIds.current[target] = (sourceOverrideRequestIds.current[target] ?? 0) + 1
    }
    setSourceOverrideValidations({})
    setValidatingAllSourceOverrides(false)
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
    setValidateAfterDiscovery(false)
    setSourceOverridesExpanded(false)
    setSourceOverrideFocusTarget(null)
    resetSourceOverrideValidations()
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
    setValidateAfterDiscovery(false)
    setSourceOverridesExpanded(Boolean(focusTarget))
    setSourceOverrideFocusTarget(focusTarget ?? null)
    resetSourceOverrideValidations()
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
    resetSourceOverrideValidations()
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
    resetSourceOverrideValidations()
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

    if (sourceOverrideInputErrorCount > 0) {
      setFormError(t('remoteRuleSets.source_override_input_errors_blocked', { count: sourceOverrideInputErrorCount }))
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
        setValidationById(current => omitRecordKey(current, editingSet.id))
        setSourceHealthById(current => omitRecordKey(current, editingSet.id))
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
    setValidationById(current => omitRecordKey(current, set.id))
    setSourceHealthById(current => omitRecordKey(current, set.id))
  }

  const handleValidate = async (set: RemoteRuleSet) => {
    setError(null)
    setValidatingId(set.id)
    try {
      if (Object.keys(set.sourceOverrides).length > 0) {
        const result = await api.remoteRuleSets.validateAllSources(set.id)
        setSourceHealthById(current => ({ ...current, [set.id]: result }))
      } else {
        const result = await api.remoteRuleSets.validate(set.id)
        setValidationById(current => ({ ...current, [set.id]: result }))
      }
    } catch (e) {
      setError(e)
    } finally {
      setValidatingId(null)
    }
  }

  const handleSourceOverrideChange = (target: RemoteRuleSetSourceOverrideTarget, url: string) => {
    sourceOverrideRequestIds.current[target] = (sourceOverrideRequestIds.current[target] ?? 0) + 1
    setSourceOverrideValidations(current => {
      const next = { ...current }
      delete next[target]
      return next
    })
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
    resetSourceOverrideValidations()
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
    if (validateAfterDiscovery) {
      const mergedOverrides = { ...form.sourceOverrides, ...discovered }
      const sources = SOURCE_OVERRIDE_TARGETS.flatMap(target => {
        const url = mergedOverrides[target]?.trim()
        return url ? [{ url, targetFormat: target, behavior: form.behavior }] : []
      })
      void validateSourceOverrideInputs(sources)
    }
  }

  const handleValidateSourceOverride = async (target: RemoteRuleSetSourceOverrideTarget) => {
    const url = form.sourceOverrides[target]?.trim()
    if (!url) return
    const requestId = (sourceOverrideRequestIds.current[target] ?? 0) + 1
    sourceOverrideRequestIds.current[target] = requestId
    setSourceOverrideValidations(current => ({ ...current, [target]: { status: 'loading' } }))
    try {
      const result = await api.remoteRuleSets.validateSource({ url, targetFormat: target, behavior: form.behavior })
      if (sourceOverrideRequestIds.current[target] !== requestId) return
      setSourceOverrideValidations(current => ({ ...current, [target]: { status: 'ready', result } }))
    } catch (validationError) {
      if (sourceOverrideRequestIds.current[target] !== requestId) return
      setSourceOverrideValidations(current => ({
        ...current,
        [target]: {
          status: 'error',
          error: sourceOverrideValidationError(validationError, t),
          code: validationError instanceof ApiError ? validationError.code : undefined,
        },
      }))
    }
  }

  const validateSourceOverrideInputs = async (sources: RemoteRuleSetSourceValidationInput[]) => {
    if (sources.length === 0) return
    const requestIds = new Map<RemoteRuleSetSourceOverrideTarget, number>()
    for (const source of sources) {
      const requestId = (sourceOverrideRequestIds.current[source.targetFormat] ?? 0) + 1
      sourceOverrideRequestIds.current[source.targetFormat] = requestId
      requestIds.set(source.targetFormat, requestId)
    }
    setSourceOverrideValidations(current => {
      const next = { ...current }
      for (const source of sources) next[source.targetFormat] = { status: 'loading' }
      return next
    })
    setValidatingAllSourceOverrides(true)
    try {
      const response = await api.remoteRuleSets.validateSources(sources)
      setSourceOverrideValidations(current => {
        const next = { ...current }
        for (const item of response.results) {
          if (sourceOverrideRequestIds.current[item.targetFormat] === requestIds.get(item.targetFormat)) {
            next[item.targetFormat] = { status: 'ready', result: item.result }
          }
        }
        return next
      })
    } catch (validationError) {
      const message = sourceOverrideValidationError(validationError, t)
      setSourceOverrideValidations(current => {
        const next = { ...current }
        for (const source of sources) {
          if (sourceOverrideRequestIds.current[source.targetFormat] === requestIds.get(source.targetFormat)) {
            next[source.targetFormat] = {
              status: 'error',
              error: message,
              code: validationError instanceof ApiError ? validationError.code : undefined,
            }
          }
        }
        return next
      })
    } finally {
      setValidatingAllSourceOverrides(false)
    }
  }

  const handleValidateAllSourceOverrides = async () => validateSourceOverrideInputs(configuredSourceOverrides)

  const runConversionPreview = async (ruleSet: RemoteRuleSet, targetFormat: ExportFormat) => {
    const requestId = ++conversionRequestId.current
    setConversionPreview(current =>
      current?.ruleSet.id === ruleSet.id && current.targetFormat === targetFormat
        ? { ...current, status: 'loading', error: undefined }
        : { ruleSet, targetFormat, status: 'loading' }
    )
    try {
      const result = await api.remoteRuleSets.previewConversion(ruleSet.id, targetFormat)
      if (conversionRequestId.current !== requestId) return
      setConversionPreview({ ruleSet, targetFormat, status: 'ready', result })
    } catch (e) {
      if (conversionRequestId.current !== requestId) return
      setConversionPreview(current => ({
        ruleSet,
        targetFormat,
        status: 'error',
        result: current?.ruleSet.id === ruleSet.id && current.targetFormat === targetFormat
          ? current.result
          : undefined,
        error: conversionPreviewError(e, t),
      }))
    }
  }

  const closeConversionPreview = () => {
    conversionRequestId.current += 1
    setConversionPreview(null)
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

  const openConversionPreview = (ruleSet: RemoteRuleSet) => {
    const targetFormat: ExportFormat = ruleSet.format === 'singbox' ? 'mihomo' : 'singbox'
    void runConversionPreview(ruleSet, targetFormat)
  }

  const openNativeSourceRemediation = () => {
    if (!conversionPreview) return
    const { ruleSet, targetFormat } = conversionPreview
    closeConversionPreview()
    if (canEditRemoteRuleSet(ruleSet)) {
      openEdit(ruleSet, targetFormat as RemoteRuleSetSourceOverrideTarget)
    } else {
      openManagedSourceEditor(ruleSet, targetFormat as RemoteRuleSetSourceOverrideTarget)
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
                {CONVERSION_PREVIEW_TARGETS.map(format => (
                  <option key={format} value={format}>{t(`export.formats.${format}`)}</option>
                ))}
              </select>
            </div>
            <div className={styles.listToolbarActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setExpandedGroupIds(new Set(setsByTargetGroup.map(section => section.groupId)))}
                disabled={listFilterActive}
              >{t('remoteRuleSets.expand_all')}</Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpandedGroupIds(new Set())}
                disabled={listFilterActive}
              >{t('remoteRuleSets.collapse_all')}</Button>
            </div>
            <div className={styles.toolbarSummary} aria-live="polite">
              <div className={styles.searchSummary}>
                {listFilterActive
                  ? t('remoteRuleSets.search_results', { setCount: visibleSetCount, strategyCount: visibleSections.length })
                  : t('remoteRuleSets.browse_hint')}
              </div>
              <div className={styles.statusFilters} aria-label={t('remoteRuleSets.status_filter_label')}>
                <button
                  type="button"
                  className={`${styles.compatibilityFilter} ${attentionMode === 'all' ? styles.compatibilityFilterActive : ''}`}
                  aria-pressed={attentionMode === 'all'}
                  onClick={() => changeAttentionMode('all')}
                >
                  {t('remoteRuleSets.status_all', { count: countRuleSets(compatibilitySections, () => true) })}
                </button>
                <button
                  type="button"
                  className={`${styles.compatibilityFilter} ${attentionMode === 'attention' ? styles.compatibilityFilterActive : ''}`}
                  aria-pressed={attentionMode === 'attention'}
                  disabled={attentionMode !== 'attention' && attentionCount === 0}
                  onClick={() => changeAttentionMode('attention')}
                >
                  {t('remoteRuleSets.status_attention', { count: attentionCount })}
                </button>
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
              description={t(attentionFilterActive
                ? 'remoteRuleSets.no_attention_results_help'
                : compatibilityFilterActive
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
                  const sourceHealth = sourceHealthById[set.id] ?? set.sourceHealth
                  const sourceHealthStale = Boolean(sourceHealth && 'stale' in sourceHealth && sourceHealth.stale)
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
                      {hasSourceOverrides && !sourceHealth && (
                        <Badge variant="warning">{t('remoteRuleSets.source_health_pending')}</Badge>
                      )}
                      {sourceHealthStale && (
                        <Badge variant="warning">{t('remoteRuleSets.source_health_stale')}</Badge>
                      )}
                      {sourceHealth && !sourceHealthStale && (
                        <Badge variant={validationBadgeVariant(sourceHealth.status)}>{t(`remoteRuleSets.validation_${sourceHealth.status}`)}</Badge>
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
                    {validationById[set.id] && (
                      <RuleSetValidationResult result={validationById[set.id]} language={i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en'} />
                    )}
                    {sourceHealth && (
                      <RuleSetSourceHealthResult result={sourceHealth} language={i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en'} />
                    )}
                    <div className={styles.cardActions}>
                      <Button variant="secondary" size="sm" onClick={() => openConversionPreview(set)}>
                        {t('remoteRuleSets.preview_compatibility')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={validatingId === set.id}
                        onClick={() => void handleValidate(set)}
                      >{t(hasSourceOverrides
                          ? sourceHealth ? 'remoteRuleSets.revalidate_all_sources' : 'remoteRuleSets.validate_all_sources'
                          : 'remoteRuleSets.validate_content')}</Button>
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
        open={conversionPreview !== null}
        onOpenChange={open => { if (!open) closeConversionPreview() }}
        title={t('remoteRuleSets.conversion_preview_title', { name: conversionPreview?.ruleSet.name ?? '' })}
        footer={
          <>
            <Button variant="secondary" onClick={closeConversionPreview}>{t('common.close')}</Button>
            {conversionPreview?.result
              && conversionPreview.result.mode !== 'direct'
              && (conversionPreview.result.mode === 'unsupported' || conversionPreview.result.skippedRuleCount > 0)
              && (
                <Button variant="secondary" onClick={openNativeSourceRemediation}>
                  {t('remoteRuleSets.preview_configure_native_source', {
                    client: t(`export.formats.${conversionPreview.targetFormat}`),
                  })}
                </Button>
              )}
            <Button
              loading={conversionPreview?.status === 'loading'}
              onClick={() => {
                if (conversionPreview) void runConversionPreview(conversionPreview.ruleSet, conversionPreview.targetFormat)
              }}
            >{t('remoteRuleSets.run_conversion_preview')}</Button>
          </>
        }
      >
        {conversionPreview && (
          <div className={styles.conversionPreviewBody}>
            <div>
              <label className={styles.label} htmlFor="rule-set-conversion-preview-target">{t('remoteRuleSets.preview_target')}</label>
              <select
                id="rule-set-conversion-preview-target"
                className={styles.select}
                value={conversionPreview.targetFormat}
                disabled={conversionPreview.status === 'loading'}
                onChange={event => {
                  const targetFormat = event.target.value as ExportFormat
                  setConversionPreview(current => current ? {
                    ruleSet: current.ruleSet,
                    targetFormat,
                    status: 'ready',
                  } : current)
                }}
              >
                {CONVERSION_PREVIEW_TARGETS.map(format => (
                  <option key={format} value={format}>{t(`export.formats.${format}`)}</option>
                ))}
              </select>
            </div>
            {conversionPreview.status === 'loading' && <div className={styles.previewLoading}>{t('remoteRuleSets.preview_loading')}</div>}
            {conversionPreview.status === 'error' && <div className={styles.formError} role="alert">{conversionPreview.error}</div>}
            {conversionPreview.status === 'error' && conversionPreview.result && (
              <div className={styles.previewLoading} role="status">{t('remoteRuleSets.preview_stale_after_error')}</div>
            )}
            {conversionPreview.result && <RuleSetConversionPreviewResult result={conversionPreview.result} />}
          </div>
        )}
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
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={validatingAllSourceOverrides}
                      onClick={handleDiscoverSourceOverrides}
                    >{t('remoteRuleSets.source_override_discover', { count: discoverableSourceOverrides.length })}</Button>
                    <label className={styles.sourceOverrideDiscoveryOption}>
                      <input
                        type="checkbox"
                        checked={validateAfterDiscovery}
                        onChange={event => setValidateAfterDiscovery(event.target.checked)}
                      />
                      <span>{t('remoteRuleSets.source_override_validate_after_discovery')}</span>
                    </label>
                  </>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={configuredSourceOverrides.length === 0}
                  loading={validatingAllSourceOverrides}
                  onClick={() => void handleValidateAllSourceOverrides()}
                >{t('remoteRuleSets.source_override_validate_all', { count: configuredSourceOverrides.length })}</Button>
                {Object.keys(autoDiscoveredSourceOverrides).length > 0 && (
                  <span className={styles.sourceOverrideDiscoveryNotice}>
                    {t('remoteRuleSets.source_override_discovered', { count: Object.keys(autoDiscoveredSourceOverrides).length })}
                  </span>
                )}
                {checkedSourceOverrideCount > 0 && (
                  <span className={styles.sourceOverrideSummary} role="status">
                    {t('remoteRuleSets.source_override_validation_summary', {
                      checked: checkedSourceOverrideCount,
                      total: configuredSourceOverrides.length,
                      valid: sourceOverrideSummary.valid,
                      warning: sourceOverrideSummary.warning,
                      invalid: sourceOverrideSummary.invalid,
                      error: sourceOverrideSummary.error,
                    })}
                  </span>
                )}
              </div>
              {sourceOverrideInputErrorCount > 0 && !formError && (
                <div className={styles.formError} role="alert">
                  {t('remoteRuleSets.source_override_input_errors_blocked', { count: sourceOverrideInputErrorCount })}
                </div>
              )}
              {sourceOverrideInputErrorCount === 0 && sourceOverrideSaveRiskCount > 0 && (
                <div className={styles.sourceOverrideCompatibleRisk}>
                  <p>{t('remoteRuleSets.source_override_risk_compatible', { count: sourceOverrideSaveRiskCount })}</p>
                </div>
              )}
              <div className={styles.sourceOverrideGrid}>
                {SOURCE_OVERRIDE_TARGETS.map(target => {
                  const clientName = t(`export.formats.${target}`)
                  const validation = sourceOverrideValidations[target]
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
                      {url.trim() && (
                        <div className={styles.sourceOverrideActions}>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={validation?.status === 'loading'}
                            aria-label={t('remoteRuleSets.source_override_validate_label', { client: clientName })}
                            onClick={() => void handleValidateSourceOverride(target)}
                          >{t('remoteRuleSets.source_override_validate')}</Button>
                        </div>
                      )}
                      {validation?.status === 'error' && <div className={styles.formError} role="alert">{validation.error}</div>}
                      {validation?.result && (
                        <RuleSetValidationResult
                          result={validation.result}
                          language={i18n.resolvedLanguage?.startsWith('zh') ? 'zh' : 'en'}
                        />
                      )}
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

function RuleSetConversionPreviewResult({ result }: { result: RemoteRuleSetConversionPreview }) {
  const { t, i18n } = useTranslation()
  const variant = result.mode === 'direct' ? 'success' : result.mode === 'converted' ? 'info' : 'error'
  return (
    <div className={`${styles.conversionResult} ${styles[`conversionResult_${result.mode}`]}`} role="status">
      <div className={styles.conversionResultHeader}>
        <Badge variant={variant}>{t(`remoteRuleSets.preview_mode_${result.mode}`)}</Badge>
        <span>{t('remoteRuleSets.preview_format_path', {
          source: result.sourceFormat,
          output: result.outputFormat ?? t('remoteRuleSets.preview_no_output'),
        })}</span>
        {result.checkedAt && (
          <span>{t('remoteRuleSets.preview_checked_at', {
            time: new Date(result.checkedAt).toLocaleString(i18n.language),
          })}</span>
        )}
      </div>
      {result.mode === 'direct' && <p>{t('remoteRuleSets.preview_direct_help')}</p>}
      {result.mode === 'unsupported' && <p>{t('remoteRuleSets.preview_unsupported_help')}</p>}
      {result.mode === 'converted' && (
        <>
          <div className={styles.conversionCounts}>
            <span>{t('remoteRuleSets.preview_converted_count', { count: result.convertedRuleCount })}</span>
            <span>{t('remoteRuleSets.preview_skipped_count', { count: result.skippedRuleCount })}</span>
          </div>
          {result.skippedRuleCount > 0 && <p className={styles.conversionWarning}>{t('remoteRuleSets.preview_skipped_help')}</p>}
          {Object.keys(result.skippedRuleTypes).length > 0 && (
            <div className={styles.skippedTypes} aria-label={t('remoteRuleSets.preview_skipped_types')}>
              {Object.entries(result.skippedRuleTypes)
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([type, count]) => <Badge key={type} variant="warning">{type} × {count}</Badge>)}
            </div>
          )}
          {result.convertedExamples.length > 0 && (
            <section className={styles.conversionMappings} aria-label={t('remoteRuleSets.preview_mapping_details')}>
              <h4>{t('remoteRuleSets.preview_mapping_details')}</h4>
              <div className={styles.conversionMappingTableWrap}>
                <table className={styles.conversionMappingTable}>
                  <thead>
                    <tr>
                      <th scope="col">{t('remoteRuleSets.preview_mapping_source')}</th>
                      <th scope="col">{t('remoteRuleSets.preview_mapping_target')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.convertedExamples.map((mapping, index) => (
                      <tr key={`${mapping.source}:${mapping.target}:${index}`}>
                        <td><code>{mapping.source}</code></td>
                        <td><code>{mapping.target}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.convertedExamplesTruncated && (
                <div className={styles.previewTruncated}>{t('remoteRuleSets.preview_mapping_truncated')}</div>
              )}
            </section>
          )}
          {result.issues.length > 0 && (
            <section className={styles.conversionIssues} aria-label={t('remoteRuleSets.preview_issue_details')}>
              <h4>{t('remoteRuleSets.preview_issue_details')}</h4>
              {result.issues.map(issue => (
                <div className={styles.conversionIssue} key={issue.type}>
                  <div className={styles.conversionIssueHeader}>
                    <code>{issue.type}</code>
                    <span>{t(`remoteRuleSets.preview_issue_reason_${issue.reason}`)}</span>
                    <span>{t('remoteRuleSets.preview_issue_count', { count: issue.count })}</span>
                  </div>
                  <div className={styles.conversionIssueResolution}>
                    <strong>{t('remoteRuleSets.preview_issue_resolution_label')}</strong>{' '}
                    {t(`remoteRuleSets.preview_issue_resolution_${issue.resolution}`)}
                  </div>
                  {issue.examples.length > 0 && (
                    <ul className={styles.conversionIssueExamples}>
                      {issue.examples.map((example, index) => <li key={`${issue.type}-${index}`}><code>{example}</code></li>)}
                    </ul>
                  )}
                </div>
              ))}
            </section>
          )}
          {result.preview && <pre className={styles.conversionCode}>{result.preview}</pre>}
          {result.truncated && <div className={styles.previewTruncated}>{t('remoteRuleSets.preview_truncated')}</div>}
        </>
      )}
    </div>
  )
}

function CompatibilityBadge({ mode }: { mode: Exclude<CompatibilityMode, 'all'> }) {
  const { t } = useTranslation()
  const variant = mode === 'direct' ? 'success' : mode === 'converted' ? 'info' : 'error'
  return <Badge variant={variant}>{t(`remoteRuleSets.preview_mode_${mode}`)}</Badge>
}

function RuleSetValidationResult({
  result,
  language,
}: {
  result: RemoteRuleSetValidationResult
  language: 'zh' | 'en'
}) {
  const { t } = useTranslation()
  const badgeVariant = result.status === 'valid' ? 'success' : result.status === 'warning' ? 'warning' : 'error'
  return (
    <div className={`${styles.validation} ${styles[`validation_${result.status}`]}`} role="status">
      <div className={styles.validationHeader}>
        <Badge variant={badgeVariant}>{t(`remoteRuleSets.validation_${result.status}`)}</Badge>
        <span>{t('remoteRuleSets.validation_checked_at', { time: new Date(result.checkedAt).toLocaleString() })}</span>
      </div>
      <div className={styles.validationMeta}>
        <span>{t('remoteRuleSets.validation_size', { size: formatValidationBytes(result.byteLength) })}</span>
        {result.ruleCount !== undefined && <span>{t('remoteRuleSets.validation_rules', { count: result.ruleCount })}</span>}
        {result.invalidRuleCount > 0 && <span>{t('remoteRuleSets.validation_invalid_rules', { count: result.invalidRuleCount })}</span>}
      </div>
      {result.issues.length > 0 && (
        <ul className={styles.validationIssues}>
          {result.issues.map((item, index) => <li key={`${item.code}-${item.line ?? index}`}>{language === 'zh' ? item.message : item.messageEn}</li>)}
        </ul>
      )}
    </div>
  )
}

function RuleSetSourceHealthResult({
  result,
  language,
}: {
  result: RemoteRuleSetSourceHealthResult
  language: 'zh' | 'en'
}) {
  const { t } = useTranslation()
  const stale = 'stale' in result && result.stale === true
  const sources = [
    {
      key: 'default',
      label: t('remoteRuleSets.source_health_default'),
      result: result.defaultSource,
    },
    ...result.sourceOverrides.map(item => ({
      key: item.targetFormat,
      label: t(`export.formats.${item.targetFormat}`),
      result: item.result,
    })),
  ]

  return (
    <div className={`${styles.sourceHealth} ${styles[`validation_${stale ? 'warning' : result.status}`]}`} role="status">
      <div className={styles.sourceHealthHeader}>
        <Badge variant={validationBadgeVariant(result.status)}>{t(`remoteRuleSets.validation_${result.status}`)}</Badge>
        <span>{t('remoteRuleSets.validation_checked_at', { time: new Date(result.checkedAt).toLocaleString() })}</span>
      </div>
      <div className={styles.sourceHealthSummary}>
        {t('remoteRuleSets.source_health_summary', { ...result.summary })}
      </div>
      {stale && <div className={styles.sourceHealthStaleNotice}>{t('remoteRuleSets.source_health_stale_notice')}</div>}
      <div className={styles.sourceHealthList}>
        {sources.map(source => {
          const issue = source.result.issues[0]
          return (
            <div key={source.key} className={styles.sourceHealthRow}>
              <div className={styles.sourceHealthTarget}>
                <span>{source.label}</span>
                <Badge variant={validationBadgeVariant(source.result.status)}>{t(`remoteRuleSets.validation_${source.result.status}`)}</Badge>
              </div>
              <div className={styles.sourceHealthMeta}>
                <span>{source.result.format}</span>
                {source.result.ruleCount !== undefined && <span>{t('remoteRuleSets.validation_rules', { count: source.result.ruleCount })}</span>}
              </div>
              {issue && (
                <div className={styles.sourceHealthIssue}>
                  {language === 'zh' ? issue.message : issue.messageEn}
                  {source.result.issues.length > 1 && ` · ${t('remoteRuleSets.source_health_more_issues', { count: source.result.issues.length - 1 })}`}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function validationBadgeVariant(status: RemoteRuleSetValidationResult['status']): 'success' | 'warning' | 'error' {
  return status === 'valid' ? 'success' : status === 'warning' ? 'warning' : 'error'
}

function formatValidationBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${bytes} B`
}

function conversionPreviewError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError && ['download_failed', 'too_large', 'invalid_content'].includes(error.code ?? '')) {
    return t(`remoteRuleSets.preview_error_${error.code}`)
  }
  return error instanceof Error ? error.message : t('remoteRuleSets.preview_error_unknown')
}

function isSourceOverrideTarget(value: string | null): value is RemoteRuleSetSourceOverrideTarget {
  return value !== null && SOURCE_OVERRIDE_TARGETS.some(target => target === value)
}

function sourceOverrideValidationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError && ['unsafe_url', 'invalid_format', 'invalid_behavior'].includes(error.code ?? '')) {
    return t(`remoteRuleSets.source_override_error_${error.code}`)
  }
  return error instanceof Error && error.message
    ? error.message
    : t('remoteRuleSets.source_override_validation_error')
}

function setFormValue<K extends keyof RemoteSetForm>(
  key: K,
  value: RemoteSetForm[K],
  setForm: React.Dispatch<React.SetStateAction<RemoteSetForm>>
) {
  setForm(current => ({ ...current, [key]: value }))
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
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

function ruleSetNeedsAttention(
  set: RemoteRuleSet,
  targetEnabled: boolean,
  sourceHealth: RemoteRuleSetSourceHealthResult | undefined,
  validation: RemoteRuleSetValidationResult | undefined,
  compatibilityTarget: ExportFormat | '',
): boolean {
  if (!targetEnabled || !set.enabled) return false
  if (set.sourceMissing) return true
  if (validation && validation.status !== 'valid') return true
  if (sourceHealth) {
    if ('stale' in sourceHealth && sourceHealth.stale) return true
    if (sourceHealth.status !== 'valid') return true
  } else if (Object.keys(set.sourceOverrides).length > 0) {
    return true
  }
  return compatibilityTarget !== ''
    && getRemoteRuleSetCompatibilityMode(compatibilityTarget, set) === 'unsupported'
}

function countRuleSets<T extends { targetEnabled: boolean; sets: RemoteRuleSet[] }>(
  sections: T[],
  predicate: (set: RemoteRuleSet, targetEnabled: boolean) => boolean,
): number {
  return sections.reduce(
    (count, section) => count + section.sets.filter(set => predicate(set, section.targetEnabled)).length,
    0,
  )
}

function filterRuleSetSectionsByPredicate<T extends { targetEnabled: boolean; sets: RemoteRuleSet[] }>(
  sections: T[],
  predicate: (set: RemoteRuleSet, targetEnabled: boolean) => boolean,
): T[] {
  return sections.flatMap(section => {
    const matchingSets = section.sets.filter(set => predicate(set, section.targetEnabled))
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
