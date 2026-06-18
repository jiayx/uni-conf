import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { Card } from '@/components/ui/Card/Card'
import { Badge } from '@/components/ui/Badge/Badge'
import { Modal } from '@/components/ui/Modal/Modal'
import { Input } from '@/components/ui/Input/Input'
import { EmptyState } from '@/components/ui/EmptyState/EmptyState'
import { api } from '@/lib/api'
import type { ExportConfig, ExportFormat } from '@uni-conf/types'
import styles from './Export.module.css'

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'mihomo', label: 'Mihomo / Clash YAML' },
  { value: 'singbox', label: 'sing-box JSON' },
  { value: 'loon', label: 'Loon CONF' },
]

const BASE_URL = window.location.origin

export function Export() {
  const { t } = useTranslation()
  const [configs, setConfigs] = useState<ExportConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', format: 'mihomo' as ExportFormat })
  const [copied, setCopied] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try { setConfigs(await api.export.listConfigs()) } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const handleAdd = async () => {
    await api.export.createConfig({ name: form.name, format: form.format, enabled: true, includeCollectionIds: [], includeGroupIds: [], includeRuleIds: [], includeRemoteSetIds: [] })
    setShowModal(false); setForm({ name: '', format: 'mihomo' })
    await load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('删除此导出配置？')) return
    await api.export.deleteConfig(id)
    await load()
  }

  const copyUrl = (url: string, id: string) => {
    void navigator.clipboard.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const extMap: Record<string, string> = { mihomo: 'yaml', singbox: 'json', loon: 'conf' }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('export.title')}
        actions={<Button onClick={() => setShowModal(true)} icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>{t('export.new_config')}</Button>}
      />
      {loading ? (
        <div className={styles.loading}>{t('common.loading')}</div>
      ) : configs.length === 0 ? (
        <EmptyState title="暂无导出配置" description="创建导出配置以生成订阅链接" action={{ label: t('export.new_config'), onClick: () => setShowModal(true) }} />
      ) : (
        <div className={styles.list}>
          {configs.map(cfg => {
            const ext = extMap[cfg.format] ?? 'txt'
            const subUrl = `${BASE_URL}/sub/${cfg.token}/${cfg.format}.${ext}`
            return (
              <Card key={cfg.id} className={styles.configCard}>
                <div className={styles.configHeader}>
                  <div>
                    <div className={styles.configName}>{cfg.name}</div>
                    <Badge variant="purple">{cfg.format.toUpperCase()}</Badge>
                  </div>
                  <div className={styles.configActions}>
                    <Button
                      variant="secondary" size="sm"
                      onClick={() => window.open(`/api/export/download/${cfg.format}`, '_blank')}
                    >{t('common.download')}</Button>
                    <Button variant="danger" size="sm" onClick={() => void handleDelete(cfg.id)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
                <div className={styles.urlRow}>
                  <span className={styles.urlLabel}>{t('export.subscription_url')}</span>
                  <div className={styles.urlBox}>
                    <code className={styles.urlCode}>{subUrl}</code>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => copyUrl(subUrl, cfg.id)}
                    >{copied === cfg.id ? t('common.copied') : t('common.copy')}</Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Modal open={showModal} onOpenChange={setShowModal} title={t('export.new_config')}
        footer={<><Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button><Button onClick={() => void handleAdd()}>{t('common.save')}</Button></>}>
        <Input label={t('common.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Export" />
        <div>
          <label className={styles.selectLabel}>{t('export.format')}</label>
          <select className={styles.select} value={form.format} onChange={e => setForm(f => ({ ...f, format: e.target.value as ExportFormat }))}>
            {FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </Modal>
    </div>
  )
}
