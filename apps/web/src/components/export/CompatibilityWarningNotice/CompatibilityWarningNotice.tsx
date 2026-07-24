import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { compatibilityRemediationAction } from '@/core/export/compatibility-remediation'
import { compatibilityWarningMessage } from '@/core/export/compatibility-warning'
import type { CompatibilityWarning } from '@uni-conf/types'
import styles from './CompatibilityWarningNotice.module.css'

export function CompatibilityWarningNotice({
  warning,
  className = '',
}: {
  warning: CompatibilityWarning
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const action = compatibilityRemediationAction(warning)

  return (
    <div className={`${styles.notice} ${className}`}>
      <span>{compatibilityWarningMessage(warning, i18n.resolvedLanguage)}</span>
      {action && <Link to={action.to}>{t(action.labelKey)}</Link>}
    </div>
  )
}
