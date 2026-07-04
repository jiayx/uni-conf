import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/Card/Card'
import { Button } from '@/components/ui/Button/Button'
import { Input } from '@/components/ui/Input/Input'
import { api, UnauthorizedError } from '@/lib/api'
import { setStoredApiKey } from '@/lib/auth'
import styles from './AuthGate.module.css'

type GateStatus = 'checking' | 'unlocked' | 'locked'

export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<GateStatus>('checking')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.auth
      .check()
      .then(() => {
        if (!cancelled) setStatus('unlocked')
      })
      .catch((e) => {
        if (cancelled) return
        // Only gate on an explicit 401; other errors (e.g. worker unreachable)
        // shouldn't lock the user out of an otherwise-loaded app.
        setStatus(e instanceof UnauthorizedError ? 'locked' : 'unlocked')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return
    setSubmitting(true)
    setError(null)
    setStoredApiKey(key.trim())
    api.auth
      .check()
      .then(() => setStatus('unlocked'))
      .catch(() => setError(t('auth.invalid_key')))
      .finally(() => setSubmitting(false))
  }

  if (status === 'checking') return null

  if (status === 'locked') {
    return (
      <div className={styles.page}>
        <Card className={styles.card}>
          <h1 className={styles.title}>{t('auth.title')}</h1>
          <p className={styles.description}>{t('auth.description')}</p>
          <form onSubmit={handleSubmit} className={styles.form}>
            <Input
              type="password"
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t('auth.placeholder')}
              error={error ?? undefined}
            />
            <Button type="submit" loading={submitting} disabled={!key.trim()}>
              {t('auth.unlock')}
            </Button>
          </form>
        </Card>
      </div>
    )
  }

  return <>{children}</>
}
