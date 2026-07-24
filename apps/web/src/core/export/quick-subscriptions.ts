import { getExportSubscriptionFilename } from '@uni-conf/shared'
import { QUICK_EXPORT_OPTIONS } from './formats'

export function buildQuickSubscriptionLinks(origin: string, token?: string | null, enabled = true) {
  if (!token || !enabled) return []

  const cleanOrigin = origin.replace(/\/+$/, '')
  return QUICK_EXPORT_OPTIONS.map(option => ({
    ...option,
    url: `${cleanOrigin}/sub/${token}/${getExportSubscriptionFilename(option.value)}`,
  }))
}
