import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Button } from '@/components/ui/Button/Button'
import { api } from '@/lib/api'
import styles from './Preview.module.css'

const FORMATS = [
  { value: 'mihomo', label: 'Mihomo YAML' },
  { value: 'singbox', label: 'sing-box JSON' },
  { value: 'loon', label: 'Loon CONF' },
]

export function Preview() {
  const { t } = useTranslation()
  const [format, setFormat] = useState('mihomo')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handlePreview = async () => {
    setLoading(true)
    try {
      const result = await api.export.previewFormat(format)
      setContent(result.content)
    } catch (e) {
      setContent(`# Error: ${(e as Error).message}`)
    } finally { setLoading(false) }
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={styles.page}>
      <PageHeader title={t('preview.title')} />
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {FORMATS.map(f => (
            <button key={f.value} className={`${styles.tab} ${format === f.value ? styles.active : ''}`} onClick={() => setFormat(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void handlePreview()}>
            {t('common.preview')}
          </Button>
          {content && (
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          )}
        </div>
      </div>
      {content ? (
        <pre className={styles.code}>{content}</pre>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyText}>点击「预览」生成配置 / Click Preview to generate config</div>
        </div>
      )}
    </div>
  )
}
