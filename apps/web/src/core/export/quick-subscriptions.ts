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

export function buildUniversalSubscriptionUrl(origin: string, token: string, mode: 'config' | 'nodes' = 'config'): string {
  return `${origin.replace(/\/+$/, '')}/sub/${encodeURIComponent(token)}${mode === 'nodes' ? '?mode=nodes' : ''}`
}
