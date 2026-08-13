import type { ExportFormat } from '@uni-conf/types'

export interface ClientImportLink {
  appName: string
  url: string
}

/**
 * Builds deep links only for clients that expose a full remote-profile import.
 * Node-only subscriptions and formats without a universal client scheme return null.
 */
export function buildClientImportLink(
  format: ExportFormat,
  subscriptionUrl: string,
  profileName: string,
): ClientImportLink | null {
  const encodedUrl = encodeURIComponent(subscriptionUrl)
  const encodedName = encodeURIComponent(profileName)

  switch (format) {
    case 'singbox':
      return {
        appName: 'sing-box',
        url: `sing-box://import-remote-profile?url=${encodedUrl}#${encodedName}`,
      }
    case 'loon':
      return { appName: 'Loon', url: `loon://import?sub=${encodedUrl}` }
    case 'surge':
      return { appName: 'Surge', url: `surge:///install-config?url=${encodedUrl}` }
    case 'shadowrocket':
      return {
        appName: 'Shadowrocket',
        url: `shadowrocket://config/add/${encodedUrl}`,
      }
    case 'stash':
      return { appName: 'Stash', url: `stash://install-config?url=${encodedUrl}` }
    case 'egern':
      return {
        appName: 'Egern',
        url: `egern:/profiles/new?name=${encodedName}&url=${encodedUrl}`,
      }
    case 'mihomo':
    case 'clash':
    case 'quantumultx':
    case 'nodes_base64':
    case 'nodes_raw':
      return null
  }
}
