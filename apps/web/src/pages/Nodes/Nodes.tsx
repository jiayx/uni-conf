import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice/ErrorNotice'
import { Modal } from '@/components/ui/Modal/Modal'
import { useConfirmDialog } from '@/components/ui/ConfirmDialog/useConfirmDialog'
import { Input } from '@/components/ui/Input/Input'
import {
  buildManualNodeParsedConfig,
  compactManualNodeExtra,
  completeManualNodeExtra,
  getMissingRequiredManualNodeFields,
  type ManualNodeExtraValue,
} from '@/core/nodes/manual-node-config'
import { MANUAL_NODE_URI_PLACEHOLDER } from '@/core/nodes/manual-node-uri-help'
import { useNodesStore } from '@/store/nodes.store'
import { useSourcesStore } from '@/store/sources.store'
import { api } from '@/lib/api'
import { useRequestedEdit } from '@/core/navigation/use-requested-edit'
import { formValuesEqual, useUnsavedChangesGuard } from '@/core/forms/use-unsaved-changes'
import {
  MAINSTREAM_PROXY_PROTOCOLS,
  PROTOCOL_FORM_FIELDS,
  PROXY_PROTOCOL_REGISTRY,
} from '@uni-conf/types'
import {
  COUNTRY_FLAG_MAP,
  detectCountry,
  MAX_NODE_BATCH_SELECTION,
  MAX_NODE_SEARCH_LENGTH,
} from '@uni-conf/shared'
import type { ProtocolFieldDefinition, ProxyNode, ProxyProtocol } from '@uni-conf/types'
import styles from './Nodes.module.css'

const PROTOCOL_COLORS: Record<string, 'purple' | 'info' | 'success' | 'warning' | 'default'> = {
  ss: 'success', vmess: 'info', vless: 'info', trojan: 'warning', hysteria2: 'purple',
  hy2: 'purple', tuic: 'purple', socks5: 'default', http: 'default',
}

const PROTOCOL_OPTIONS: ProxyProtocol[] = [...MAINSTREAM_PROXY_PROTOCOLS]
const COMMON_PROTOCOLS = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic'] satisfies ProxyProtocol[]
const COMMON_PROTOCOL_SET = new Set<ProxyProtocol>(COMMON_PROTOCOLS)
const OTHER_PROTOCOLS = PROTOCOL_OPTIONS.filter(protocol => !COMMON_PROTOCOL_SET.has(protocol))
const EMPTY_FORM = {
  name: '',
  protocol: 'ss' as ProxyProtocol,
  server: '',
  port: 443,
  countryCode: '',
  enabled: true,
  notes: '',
  extra: {} as Record<string, ManualNodeExtraValue>,
}

export function Nodes() {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const confirmAction = useConfirmDialog()
  const { nodes, loading, error: loadError, fetchNodes, addNode, updateNode, setNodesEnabled, deleteNode } = useNodesStore()
  const { sources, fetchSources } = useSourcesStore()
  const [search, setSearch] = useState('')
  const [filterProtocol, setFilterProtocol] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [bulkError, setBulkError] = useState<unknown | null>(null)
  const [showModal, setShowModal] = useState(() => searchParams.get('create') === '1')
  const [editingNode, setEditingNode] = useState<ProxyNode | null>(null)
  const [editingRequested, setEditingRequested] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [uriInput, setUriInput] = useState('')
  const [initialEditor, setInitialEditor] = useState({ form: EMPTY_FORM, uriInput: '' })
  const [formError, setFormError] = useState<unknown>(null)
  const [formSaving, setFormSaving] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  const [rowAction, setRowAction] = useState<{ id: string; type: 'toggle' | 'delete' } | null>(null)
  const formDirty = showModal && !formValuesEqual({ form, uriInput }, initialEditor)
  const confirmDiscardForm = useUnsavedChangesGuard(formDirty)

  useEffect(() => { void fetchNodes(); void fetchSources() }, [fetchNodes, fetchSources])
  useEffect(() => {
    if (searchParams.get('create') !== '1') return
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('create')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const sourceNames = new Map(sources.map(source => [source.id, source.name]))
  const getSourceName = (id: string) => sourceNames.get(id) ?? (id === 'manual' ? t('nodes.manual') : id)
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filtered = nodes.filter(n => {
    if (normalizedSearch && ![
      n.name,
      n.server,
      n.country ?? '',
      n.countryCode ?? '',
      n.sourceId ? getSourceName(n.sourceId) : t('nodes.manual'),
    ].some(value => value.toLocaleLowerCase().includes(normalizedSearch))) return false
    if (filterProtocol && n.protocol !== filterProtocol) return false
    if (filterCountry && n.countryCode !== filterCountry) return false
    if (filterSource && (n.sourceId || 'manual') !== filterSource) return false
    if (filterStatus === 'enabled' && !n.enabled) return false
    if (filterStatus === 'disabled' && n.enabled) return false
    return true
  })

  const protocols = [...new Set(nodes.map(n => n.protocol))]
  const countries = [...new Set(nodes.map(n => n.countryCode).filter(Boolean))] as string[]
  const nodeSourceIds = [...new Set(nodes.map(node => node.sourceId || 'manual'))]
  const filtersActive = Boolean(normalizedSearch || filterProtocol || filterCountry || filterSource || filterStatus)
  const visibleIds = filtered.map(node => node.id)
  const selectableVisibleIds = visibleIds.slice(0, MAX_NODE_BATCH_SELECTION)
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectableVisibleIds.every(id => selectedIds.has(id))
  const protocolFields = PROTOCOL_FORM_FIELDS[form.protocol] as readonly ProtocolFieldDefinition[]
  const detectedCountry = detectCountry(form.name)
  const regionNames = new Intl.DisplayNames([i18n.resolvedLanguage ?? i18n.language], { type: 'region' })
  const countryOptions = COUNTRY_FLAG_MAP
    .map(([flag, country, code]) => ({
      code,
      country,
      label: `${flag} ${regionNames.of(code) ?? country} (${code})`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, i18n.resolvedLanguage ?? i18n.language))

  const resetFilters = () => {
    setSearch('')
    setFilterProtocol('')
    setFilterCountry('')
    setFilterSource('')
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
      await setNodesEnabled(ids, enabled)
      setSelectedIds(new Set())
    } catch (error) {
      setBulkError(error)
    } finally {
      setBulkUpdating(false)
    }
  }

  const openCreate = () => {
    setEditingNode(null)
    setEditingRequested(false)
    setDetailLoading(false)
    setForm(EMPTY_FORM)
    setUriInput('')
    setInitialEditor({ form: EMPTY_FORM, uriInput: '' })
    setFormError(null)
    setShowModal(true)
  }

  const openEdit = async (summary: ProxyNode) => {
    setEditingNode(null)
    setEditingRequested(true)
    setDetailLoading(true)
    setForm(EMPTY_FORM)
    setInitialEditor({ form: EMPTY_FORM, uriInput: '' })
    setFormError(null)
    setShowModal(true)
    let node: ProxyNode
    try {
      node = await api.nodes.get(summary.id)
    } catch (error) {
      setFormError(error)
      return
    } finally {
      setDetailLoading(false)
    }
    const nextForm = {
      name: node.name,
      protocol: node.protocol,
      server: node.server,
      port: node.port,
      countryCode: detectedCountryMatchesNode(node) ? '' : node.countryCode ?? '',
      enabled: node.enabled,
      notes: node.notes ?? '',
      extra: {
        ...node.rawConfig,
        ...node.parsedConfig.extra,
        ...(node.parsedConfig.password ? { password: node.parsedConfig.password } : {}),
        ...(node.parsedConfig.uuid ? { uuid: node.parsedConfig.uuid } : {}),
        ...(node.parsedConfig.tls !== undefined ? { tls: node.parsedConfig.tls } : {}),
        ...(node.parsedConfig.sni ? { sni: node.parsedConfig.sni } : {}),
        ...(node.parsedConfig.skipCertVerify !== undefined ? { skipCertVerify: node.parsedConfig.skipCertVerify } : {}),
        ...(node.parsedConfig.network ? { network: node.parsedConfig.network } : {}),
        ...(node.parsedConfig.wsPath ? { wsPath: node.parsedConfig.wsPath } : {}),
      } as Record<string, ManualNodeExtraValue>,
    }
    setEditingNode(node)
    setForm(nextForm)
    setUriInput('')
    setInitialEditor({ form: nextForm, uriInput: '' })
    setFormError(null)
    setShowModal(true)
  }

  useRequestedEdit(nodes.filter(node => node.isManual), openEdit)

  const closeFormModal = async () => {
    if (!(await confirmDiscardForm())) return
    setShowModal(false)
    setEditingNode(null)
    setEditingRequested(false)
    setDetailLoading(false)
    setForm(EMPTY_FORM)
    setUriInput('')
    setInitialEditor({ form: EMPTY_FORM, uriInput: '' })
    setFormError(null)
  }

  const handleSave = async () => {
    if (detailLoading || (editingRequested && !editingNode)) return
    const uri = uriInput.trim()
    if (!editingRequested && !uri && (!form.name || !form.server || !form.port)) {
      setFormError(t('nodes.required_fields'))
      return
    }

    const extra = completeManualNodeExtra(form.protocol, compactManualNodeExtra(form.extra))
    if (!uri) {
      const missingFields = getMissingRequiredManualNodeFields(form.protocol, extra)
      if (missingFields.length > 0) {
        setFormError(t('nodes.missing_protocol_fields', { fields: missingFields.join(', ') }))
        return
      }
    }

    setFormSaving(true)
    setFormError(null)
    try {
      if (!editingRequested && uri) {
        await addNode({ uri, sourceId: 'manual' })
      } else {
        const selectedCountry = countryOptions.find(option => option.code === form.countryCode)
        const country = selectedCountry
          ? { country: selectedCountry.country, countryCode: selectedCountry.code }
          : detectedCountry
        const payload = {
          sourceId: editingNode?.sourceId ?? 'manual',
          name: form.name,
          protocol: form.protocol,
          server: form.server,
          port: form.port,
          country: country?.country ?? '',
          countryCode: country?.countryCode ?? '',
          enabled: form.enabled,
          tags: editingNode?.tags ?? [],
          notes: form.notes.trim(),
          rawConfig: {
            ...(editingNode?.rawConfig ?? {}),
            ...extra,
          },
          parsedConfig: buildManualNodeParsedConfig(form.protocol, form.server, form.port, extra, editingNode?.parsedConfig),
          isManual: true,
        }
        if (editingNode) await updateNode(editingNode.id, payload)
        else await addNode(payload)
      }
      setShowModal(false)
      setEditingNode(null)
      setEditingRequested(false)
      setForm(EMPTY_FORM)
      setUriInput('')
    } catch (error) {
      setFormError(error)
    } finally {
      setFormSaving(false)
    }
  }

  const handleDelete = async (node: ProxyNode) => {
    if (!node.isManual) return
    if (!(await confirmAction({
      description: t('nodes.delete_confirm', { name: node.name }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return
    setRowAction({ id: node.id, type: 'delete' })
    setActionError(null)
    try {
      await deleteNode(node.id)
      setSelectedIds(current => {
        const next = new Set(current)
        next.delete(node.id)
        return next
      })
    } catch (error) {
      setActionError(error)
    } finally {
      setRowAction(null)
    }
  }

  const handleToggleEnabled = async (node: ProxyNode) => {
    setRowAction({ id: node.id, type: 'toggle' })
    setActionError(null)
    try {
      await updateNode(node.id, { enabled: !node.enabled })
    } catch (error) {
      setActionError(error)
    } finally {
      setRowAction(null)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('nodes.title')}
        description={t('nodes.count_summary', { shown: filtered.length, total: nodes.length })}
        actions={<Button onClick={openCreate}>{t('nodes.add_manual')}</Button>}
      />
      {loadError != null && <ErrorNotice error={loadError} className={styles.bulkError} />}
      {actionError != null && <ErrorNotice error={actionError} className={styles.bulkError} />}

      {/* Filters */}
      <div className={styles.filters}>
        <input
          className={styles.searchInput}
          aria-label={t('common.search')}
          placeholder={t('nodes.search_placeholder')}
          value={search}
          onChange={e => {
            setSearch(e.target.value.slice(0, MAX_NODE_SEARCH_LENGTH))
            setSelectedIds(new Set())
          }}
        />
        <select aria-label={t('nodes.protocol')} className={styles.filterSelect} value={filterProtocol} onChange={e => { setFilterProtocol(e.target.value); setSelectedIds(new Set()) }}>
          <option value="">{t('nodes.all_protocols')}</option>
          {protocols.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
        </select>
        <select aria-label={t('nodes.country')} className={styles.filterSelect} value={filterCountry} onChange={e => { setFilterCountry(e.target.value); setSelectedIds(new Set()) }}>
          <option value="">{t('nodes.all_countries')}</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label={t('nodes.source')} className={styles.filterSelect} value={filterSource} onChange={e => { setFilterSource(e.target.value); setSelectedIds(new Set()) }}>
          <option value="">{t('nodes.all_sources')}</option>
          {nodeSourceIds.map(id => <option key={id} value={id}>{getSourceName(id)}</option>)}
        </select>
        <select aria-label={t('common.status')} className={styles.filterSelect} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setSelectedIds(new Set()) }}>
          <option value="">{t('nodes.all_statuses')}</option>
          <option value="enabled">{t('common.enabled')}</option>
          <option value="disabled">{t('common.disabled')}</option>
        </select>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>{t('nodes.clear_filters')}</Button>
        )}
      </div>
      {bulkError != null && <ErrorNotice error={bulkError} className={styles.bulkError} />}
      {selectedIds.size > 0 && (
        <div className={styles.bulkToolbar} role="status" aria-live="polite">
          <strong>{t('nodes.selected_count', { count: selectedIds.size })}</strong>
          <div className={styles.bulkActions}>
            <Button size="sm" loading={bulkUpdating} onClick={() => void handleBulkEnabled(true)}>{t('nodes.enable_selected')}</Button>
            <Button variant="secondary" size="sm" disabled={bulkUpdating} onClick={() => void handleBulkEnabled(false)}>{t('nodes.disable_selected')}</Button>
            <Button variant="ghost" size="sm" disabled={bulkUpdating} onClick={() => setSelectedIds(new Set())}>{t('nodes.clear_selection')}</Button>
          </div>
          {filtered.length > MAX_NODE_BATCH_SELECTION && (
            <div className={styles.bulkLimitNotice}>
              {t('nodes.selection_limit_notice', { count: MAX_NODE_BATCH_SELECTION })}
            </div>
          )}
        </div>
      )}

      {loading && nodes.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : nodes.length === 0 ? (
        <EmptyState title={t('nodes.empty_title')} description={t('nodes.empty_description')} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('nodes.no_results')}
          description={t('nodes.no_results_help')}
          action={{ label: t('nodes.clear_filters'), onClick: resetFilters }}
        />
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.selectionColumn}>
                  <input
                    type="checkbox"
                    aria-label={t(filtered.length > MAX_NODE_BATCH_SELECTION
                      ? 'nodes.select_visible_limit'
                      : 'nodes.select_all_visible', { count: MAX_NODE_BATCH_SELECTION })}
                    checked={allVisibleSelected}
                    onChange={toggleVisibleSelection}
                  />
                </th>
                <th>{t('common.name')}</th>
                <th>{t('nodes.protocol')}</th>
                <th>{t('nodes.server')}</th>
                <th>{t('nodes.country')}</th>
                <th>{t('nodes.source')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(node => (
                <tr key={node.id} className={styles.row}>
                  <td className={styles.selectionColumn} data-label={t('nodes.selection')}>
                    <input
                      type="checkbox"
                      aria-label={t('nodes.select_node', { name: node.name })}
                      checked={selectedIds.has(node.id)}
                      disabled={!selectedIds.has(node.id) && selectedIds.size >= MAX_NODE_BATCH_SELECTION}
                      onChange={() => setSelectedIds(current => {
                        const next = new Set(current)
                        if (next.has(node.id)) next.delete(node.id)
                        else next.add(node.id)
                        return next
                      })}
                    />
                  </td>
                  <td className={styles.nodeName} data-label={t('common.name')}>{node.name}</td>
                  <td data-label={t('nodes.protocol')}>
                    <Badge variant={PROTOCOL_COLORS[node.protocol] ?? 'default'}>
                      {node.protocol.toUpperCase()}
                    </Badge>
                  </td>
                  <td className={styles.server} data-label={t('nodes.server')}>{node.server}:{node.port}</td>
                  <td data-label={t('nodes.country')}>{node.countryCode ?? '—'}</td>
                  <td data-label={t('nodes.source')}>{node.sourceId ? getSourceName(node.sourceId) : t('nodes.manual')}</td>
                  <td data-label={t('common.status')}>
                    <Badge variant={node.enabled ? 'success' : 'default'}>
                      {node.enabled ? t('common.enabled') : t('common.disabled')}
                    </Badge>
                  </td>
                  <td data-label={t('common.actions')}>
                    <div className={styles.rowActions}>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={rowAction?.id === node.id && rowAction.type === 'toggle'}
                        disabled={rowAction?.id === node.id}
                        onClick={() => void handleToggleEnabled(node)}
                      >
                        {node.enabled ? t('common.disable') : t('common.enable')}
                      </Button>
                      {node.isManual && (
                        <>
                          <Button variant="ghost" size="sm" disabled={rowAction?.id === node.id || detailLoading} onClick={() => void openEdit(node)}>
                            {t('common.edit')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={rowAction?.id === node.id && rowAction.type === 'delete'}
                            disabled={rowAction?.id === node.id}
                            aria-label={t('nodes.delete_node', { name: node.name })}
                            onClick={() => void handleDelete(node)}
                          >
                            {t('common.delete')}
                          </Button>
                        </>
                      )}
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
        onOpenChange={open => {
          if (!open) void closeFormModal()
        }}
        title={editingRequested ? t('nodes.edit_manual') : t('nodes.add_manual')}
        closeDisabled={formSaving || detailLoading}
        footer={<>
          <Button variant="secondary" disabled={formSaving || detailLoading} onClick={() => void closeFormModal()}>{t('common.cancel')}</Button>
          <Button
            loading={formSaving}
            disabled={detailLoading || (editingRequested && !editingNode)}
            onClick={() => void handleSave()}
          >
            {t('common.save')}
          </Button>
        </>}
      >
        {formError != null && <ErrorNotice error={formError} className={styles.formError} />}
        {detailLoading && <div className={styles.loading}>{t('common.loading')}</div>}
        {!detailLoading && (!editingRequested || editingNode) && (<>
        {!editingRequested && (
          <div className={styles.uriSection}>
            <label className={styles.selectLabel} htmlFor="manual-node-uri">{t('nodes.uri')}</label>
            <textarea
              id="manual-node-uri"
              className={styles.textarea}
              value={uriInput}
              onChange={e => setUriInput(e.target.value)}
              placeholder={MANUAL_NODE_URI_PLACEHOLDER}
              rows={4}
            />
            <div className={styles.helperText}>
              {t('nodes.uri_hint')}
            </div>
            <div className={styles.divider}><span>{t('nodes.manual_fields')}</span></div>
          </div>
        )}
        <Input label={t('common.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <div className={styles.protocolPicker}>
          <label className={styles.selectLabel} htmlFor="manual-node-protocol">{t('nodes.protocol')}</label>
          <select id="manual-node-protocol" className={styles.filterSelect} value={form.protocol} onChange={e => setForm(f => ({ ...f, protocol: e.target.value as ProxyProtocol, extra: {} }))}>
            <optgroup label={t('nodes.common_protocols')}>
              {COMMON_PROTOCOLS.map(protocol => (
                <option key={protocol} value={protocol}>{PROXY_PROTOCOL_REGISTRY[protocol].label}</option>
              ))}
            </optgroup>
            <optgroup label={t('nodes.other_protocols')}>
              {OTHER_PROTOCOLS.map(protocol => (
                <option key={protocol} value={protocol}>{PROXY_PROTOCOL_REGISTRY[protocol].label}</option>
              ))}
            </optgroup>
          </select>
          <div className={styles.helperText}>{t('nodes.protocol_picker_hint')}</div>
        </div>
        <Input label={t('nodes.server')} value={form.server} onChange={e => setForm(f => ({ ...f, server: e.target.value }))} />
        <Input label={t('nodes.port')} type="number" min="1" max="65535" value={form.port} onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} />
        {protocolFields.length > 0 && (
          <div className={styles.protocolFields}>
            {protocolFields.map(field => (
              <ProtocolFieldInput
                key={field.key}
                field={field}
                value={form.extra[field.key] ?? field.defaultValue ?? (field.type === 'boolean' ? false : '')}
                onChange={value => setForm(f => ({ ...f, extra: { ...f.extra, [field.key]: value } }))}
              />
            ))}
          </div>
        )}
        <div className={styles.protocolPicker}>
          <label className={styles.selectLabel} htmlFor="manual-node-country">{t('nodes.country')}</label>
          <select
            id="manual-node-country"
            className={styles.filterSelect}
            value={form.countryCode}
            onChange={e => setForm(f => ({ ...f, countryCode: e.target.value }))}
          >
            <option value="">
              {detectedCountry
                ? t('nodes.country_auto_detected', {
                    country: `${regionNames.of(detectedCountry.countryCode) ?? detectedCountry.country} (${detectedCountry.countryCode})`,
                  })
                : t('nodes.country_auto')}
            </option>
            {countryOptions.map(option => (
              <option key={option.code} value={option.code}>{option.label}</option>
            ))}
          </select>
          <div className={styles.helperText}>{t('nodes.country_hint')}</div>
        </div>
        <Input label={t('common.notes')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          <span>{t('common.enabled')}</span>
        </label>
        </>)}
      </Modal>
    </div>
  )
}

function detectedCountryMatchesNode(node: ProxyNode): boolean {
  const detected = detectCountry(node.name)
  return detected?.countryCode === node.countryCode
}

function ProtocolFieldInput({
  field,
  value,
  onChange,
}: {
  field: ProtocolFieldDefinition
  value: ManualNodeExtraValue
  onChange: (value: ManualNodeExtraValue) => void
}) {
  const { t } = useTranslation()

  if (field.type === 'boolean') {
    return (
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.type === 'select') {
    const selectId = `manual-node-field-${field.key}`
    return (
      <div>
        <label className={styles.selectLabel} htmlFor={selectId}>{field.label}{field.required ? ' *' : ''}</label>
        <select id={selectId} className={styles.filterSelect} value={String(value ?? '')} onChange={e => onChange(e.target.value)}>
          {!field.required && <option value="">{t('nodes.field_default')}</option>}
          {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    )
  }

  const inputType = field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'
  const displayValue = Array.isArray(value) ? value.join(',') : String(value ?? '')

  return (
    <Input
      label={`${field.label}${field.required ? ' *' : ''}`}
      type={inputType}
      value={displayValue}
      placeholder={field.placeholder}
      onChange={e => {
        if (field.type === 'number') onChange(Number(e.target.value))
        else if (field.type === 'string-array') onChange(e.target.value.split(',').map(item => item.trim()).filter(Boolean))
        else onChange(e.target.value)
      }}
    />
  )
}
