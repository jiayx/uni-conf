import { getExportSubscriptionFilename } from '@uni-conf/shared'
import { EXPORT_FORMAT_NAMES, QUICK_EXPORT_OPTIONS } from './formats'

export function buildPublicSubscriptionUrl(
  origin: string,
  token: string,
  filename: string,
  name?: string | null,
): string {
  const cleanOrigin = origin.replace(/\/+$/, '')
  const baseUrl = `${cleanOrigin}/sub/${token}/${filename}`
  const normalizedName = name?.trim()
  return normalizedName ? `${baseUrl}?name=${encodeURIComponent(normalizedName)}` : baseUrl
}

export function buildSubscriptionDisplayName(profileName: string, formatName: string): string {
  return `${profileName.trim() || 'UniConf'} · ${formatName}`
}

export function buildQuickSubscriptionLinks(
  origin: string,
  token?: string | null,
  enabled = true,
  name?: string | null,
) {
  if (!token || !enabled) return []

  return QUICK_EXPORT_OPTIONS.map(option => ({
    ...option,
    url: buildPublicSubscriptionUrl(
      origin,
      token,
      getExportSubscriptionFilename(option.value),
      name ? buildSubscriptionDisplayName(name, EXPORT_FORMAT_NAMES[option.value]) : undefined,
    ),
  }))
}
