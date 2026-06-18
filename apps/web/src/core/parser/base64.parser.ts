import type { ProxyNode } from '@uni-conf/types'
import { parseProxyLinks } from './proxy-link.parser'

function decodeBase64(content: string): string {
  const trimmed = content.trim()
  // Handle URL-safe base64
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  return atob(padded)
}

export function parseBase64Subscription(content: string, sourceId: string): ProxyNode[] {
  try {
    const decoded = decodeBase64(content)
    return parseProxyLinks(decoded, sourceId)
  } catch {
    // If decode fails, try raw text directly
    return parseProxyLinks(content, sourceId)
  }
}
