import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { useNodesStore } from '@/store/nodes.store'
import { useSourcesStore } from '@/store/sources.store'
import { parseProxyLink } from '@/core/parser/proxy-link.parser'
import { MAINSTREAM_PROXY_PROTOCOLS, PROTOCOL_FORM_FIELDS } from '@uni-conf/types'
import type { ProtocolFieldDefinition, ProxyNode, ProxyProtocol } from '@uni-conf/types'
import styles from './Nodes.module.css'

const PROTOCOL_COLORS: Record<string, 'purple' | 'info' | 'success' | 'warning' | 'default'> = {
  ss: 'success', vmess: 'info', vless: 'info', trojan: 'warning', hysteria2: 'purple',
  hy2: 'purple', tuic: 'purple', socks5: 'default', http: 'default',
}

const PROTOCOL_OPTIONS: ProxyProtocol[] = [...MAINSTREAM_PROXY_PROTOCOLS]
const EMPTY_FORM = {
  name: '',
  protocol: 'ss' as ProxyProtocol,
  server: '',
  port: 443,
  country: '',
  countryCode: '',
  enabled: true,
  notes: '',
  extra: {} as Record<string, string | number | boolean | string[]>,
}

type FormExtraValue = string | number | boolean | string[]

export function Nodes() {
  const { t } = useTranslation()
  const { nodes, loading, fetchNodes, addNode, updateNode, deleteNode } = useNodesStore()
  const { sources, fetchSources } = useSourcesStore()
  const [search, setSearch] = useState('')
  const [filterProtocol, setFilterProtocol] = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingNode, setEditingNode] = useState<ProxyNode | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [uriInput, setUriInput] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => { void fetchNodes(); void fetchSources() }, [fetchNodes, fetchSources])

  const filtered = nodes.filter(n => {
    if (search && !n.name.toLowerCase().includes(search.toLowerCase())) return false
    if (filterProtocol && n.protocol !== filterProtocol) return false
    if (filterCountry && n.countryCode !== filterCountry) return false
    return true
  })

  const protocols = [...new Set(nodes.map(n => n.protocol))]
  const countries = [...new Set(nodes.map(n => n.countryCode).filter(Boolean))] as string[]

  const getSourceName = (id: string) => sources.find(s => s.id === id)?.name ?? id
  const protocolFields = PROTOCOL_FORM_FIELDS[form.protocol] as readonly ProtocolFieldDefinition[]

  const openCreate = () => {
    setEditingNode(null)
    setForm(EMPTY_FORM)
    setUriInput('')
    setFormError('')
    setShowModal(true)
  }

  const openEdit = (node: ProxyNode) => {
    setEditingNode(node)
    setForm({
      name: node.name,
      protocol: node.protocol,
      server: node.server,
      port: node.port,
      country: node.country ?? '',
      countryCode: node.countryCode ?? '',
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
      } as Record<string, FormExtraValue>,
    })
    setUriInput('')
    setFormError('')
    setShowModal(true)
  }

  const handleSave = async () => {
    const uri = uriInput.trim()
    if (!editingNode && uri) {
      const parsed = parseProxyLink(uri, 'manual')
      if (!parsed) {
        setFormError('Unsupported or invalid node URI')
        return
      }

      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = parsed
      await addNode({
        ...payload,
        sourceId: 'manual',
        isManual: true,
      })
      setShowModal(false)
      setEditingNode(null)
      setForm(EMPTY_FORM)
      setUriInput('')
      return
    }

    if (!form.name || !form.server || !form.port) {
      setFormError('name, server, and port are required')
      return
    }

    const extra = compactExtra(form.extra)
    const payload = {
      sourceId: editingNode?.sourceId ?? 'manual',
      name: form.name,
      protocol: form.protocol,
      server: form.server,
      port: form.port,
      country: form.country || undefined,
      countryCode: form.countryCode || undefined,
      enabled: form.enabled,
      tags: editingNode?.tags ?? [],
      notes: form.notes || undefined,
      rawConfig: {
        ...(editingNode?.rawConfig ?? {}),
        ...extra,
      },
      parsedConfig: {
        ...(editingNode?.parsedConfig ?? { extra: {} }),
        protocol: form.protocol,
        server: form.server,
        port: form.port,
        password: asString(extra['password']),
        uuid: asString(extra['uuid']),
        tls: asBoolean(extra['tls']) || extra['security'] === 'tls' || extra['security'] === 'reality',
        sni: asString(extra['sni']),
        skipCertVerify: asBoolean(extra['skipCertVerify']),
        network: asNetwork(extra['network']),
        wsPath: asString(extra['wsPath']),
        extra,
      },
      isManual: true,
    }

    if (editingNode) {
      await updateNode(editingNode.id, payload)
    } else {
      await addNode(payload)
    }
    setShowModal(false)
    setEditingNode(null)
    setForm(EMPTY_FORM)
    setUriInput('')
  }

  const handleDelete = async (node: ProxyNode) => {
    if (!node.isManual) return
    if (!confirm(`${t('common.delete')} ${node.name}?`)) return
    await deleteNode(node.id)
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('nodes.title')}
        description={`${t('common.total', { count: filtered.length })}`}
        actions={<Button onClick={openCreate}>{t('nodes.add_manual')}</Button>}
      />

      {/* Filters */}
      <div className={styles.filters}>
        <input
          className={styles.searchInput}
          placeholder={`${t('common.search')}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className={styles.filterSelect} value={filterProtocol} onChange={e => setFilterProtocol(e.target.value)}>
          <option value="">{t('nodes.protocol')}: ALL</option>
          {protocols.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
        </select>
        <select className={styles.filterSelect} value={filterCountry} onChange={e => setFilterCountry(e.target.value)}>
          <option value="">{t('nodes.country')}: ALL</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading && nodes.length === 0 ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={t('common.empty')} description="暂无节点，请先刷新订阅源" />
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
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
                  <td className={styles.nodeName}>{node.name}</td>
                  <td>
                    <Badge variant={PROTOCOL_COLORS[node.protocol] ?? 'default'}>
                      {node.protocol.toUpperCase()}
                    </Badge>
                  </td>
                  <td className={styles.server}>{node.server}:{node.port}</td>
                  <td>{node.countryCode ?? '—'}</td>
                  <td>{node.sourceId ? getSourceName(node.sourceId) : t('nodes.manual')}</td>
                  <td>
                    <Badge variant={node.enabled ? 'success' : 'default'}>
                      {node.enabled ? t('common.enabled') : t('common.disabled')}
                    </Badge>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <Button variant="ghost" size="sm" onClick={() => void updateNode(node.id, { enabled: !node.enabled })}>
                        {node.enabled ? t('common.disable') : t('common.enable')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(node)}>
                        {t('common.edit')}
                      </Button>
                      {node.isManual && (
                        <Button variant="ghost" size="sm" onClick={() => void handleDelete(node)}>
                          {t('common.delete')}
                        </Button>
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
        onOpenChange={setShowModal}
        title={editingNode ? t('common.edit') : t('nodes.add_manual')}
        footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button><Button onClick={() => void handleSave()}>{t('common.save')}</Button></>}
      >
        {formError && <div className={styles.formError}>{formError}</div>}
        {!editingNode && (
          <div className={styles.uriSection}>
            <label className={styles.selectLabel}>Node URI</label>
            <textarea
              className={styles.textarea}
              value={uriInput}
              onChange={e => setUriInput(e.target.value)}
              placeholder="ss://... / vmess://... / vless://... / trojan://... / hysteria2://... / tuic://..."
              rows={4}
            />
            <div className={styles.helperText}>
              Supports SS, VMess, VLESS, Trojan, Hysteria2, TUIC, SOCKS5, HTTP, and HTTPS share links.
            </div>
            <div className={styles.divider}><span>or</span></div>
          </div>
        )}
        <Input label={t('common.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <div>
          <label className={styles.selectLabel}>{t('nodes.protocol')}</label>
          <select className={styles.filterSelect} value={form.protocol} onChange={e => setForm(f => ({ ...f, protocol: e.target.value as ProxyProtocol, extra: {} }))}>
            {PROTOCOL_OPTIONS.map(protocol => <option key={protocol} value={protocol}>{protocol.toUpperCase()}</option>)}
          </select>
        </div>
        <Input label={t('nodes.server')} value={form.server} onChange={e => setForm(f => ({ ...f, server: e.target.value }))} />
        <Input label="Port" type="number" min="1" max="65535" value={form.port} onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} />
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
        <Input label={t('nodes.country')} value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
        <Input label="Country Code" value={form.countryCode} onChange={e => setForm(f => ({ ...f, countryCode: e.target.value.toUpperCase() }))} />
        <Input label={t('common.notes')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          <span>{t('common.enabled')}</span>
        </label>
      </Modal>
    </div>
  )
}

function ProtocolFieldInput({
  field,
  value,
  onChange,
}: {
  field: ProtocolFieldDefinition
  value: FormExtraValue
  onChange: (value: FormExtraValue) => void
}) {
  if (field.type === 'boolean') {
    return (
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.type === 'select') {
    return (
      <div>
        <label className={styles.selectLabel}>{field.label}{field.required ? ' *' : ''}</label>
        <select className={styles.filterSelect} value={String(value ?? '')} onChange={e => onChange(e.target.value)}>
          {!field.required && <option value="">Default</option>}
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

function compactExtra(extra: Record<string, FormExtraValue>): Record<string, FormExtraValue> {
  return Object.fromEntries(
    Object.entries(extra).filter(([, value]) => {
      if (value === '' || value === undefined || value === null) return false
      if (Array.isArray(value) && value.length === 0) return false
      return true
    }),
  )
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asNetwork(value: unknown): 'tcp' | 'ws' | 'http' | 'h2' | 'grpc' | 'quic' | undefined {
  if (value === 'tcp' || value === 'ws' || value === 'http' || value === 'h2' || value === 'grpc' || value === 'quic') return value
  return undefined
}
