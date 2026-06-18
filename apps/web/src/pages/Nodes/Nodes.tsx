import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Badge } from '@/components/ui/Badge/Badge'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { useNodesStore } from '@/store/nodes.store'
import { useSourcesStore } from '@/store/sources.store'
import type { ProxyProtocol } from '@uni-conf/types'
import styles from './Nodes.module.css'

const PROTOCOL_COLORS: Record<string, 'purple' | 'info' | 'success' | 'warning' | 'default'> = {
  ss: 'success', vmess: 'info', vless: 'info', trojan: 'warning', hysteria2: 'purple',
  hy2: 'purple', tuic: 'purple', socks5: 'default', http: 'default',
}

export function Nodes() {
  const { t } = useTranslation()
  const { nodes, loading, fetchNodes } = useNodesStore()
  const { sources, fetchSources } = useSourcesStore()
  const [search, setSearch] = useState('')
  const [filterProtocol, setFilterProtocol] = useState('')
  const [filterCountry, setFilterCountry] = useState('')

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

  return (
    <div className={styles.page}>
      <PageHeader title={t('nodes.title')} description={`${t('common.total', { count: filtered.length })}`} />

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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
