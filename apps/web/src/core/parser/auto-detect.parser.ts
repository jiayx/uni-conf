import type { ProxyNode } from '@uni-conf/types'
import { hasProxyLinkUri } from '@uni-conf/shared'
import * as yaml from 'js-yaml'
import { parseBase64Subscription } from './base64.parser'
import { parseClashConfig } from './clash.parser'
import { parseSingboxConfig } from './singbox.parser'
import { parseProxyLinks } from './proxy-link.parser'

export type DetectedFormat = 'clash' | 'singbox' | 'base64' | 'surge' | 'loon' | 'unknown'

function isValidBase64(s: string): boolean {
  const trimmed = s.trim().replace(/\s/g, '')
  // URL-safe or standard base64
  return /^[A-Za-z0-9+/\-_]+=*$/.test(trimmed)
}

export function detectFormat(content: string): DetectedFormat {
  const trimmed = content.trim()

  // 1. Try JSON -> check for outbounds array -> singbox
  if (trimmed.startsWith('{')) {
    try {
      const doc = JSON.parse(trimmed) as Record<string, unknown>
      if (doc && Array.isArray(doc['outbounds'])) {
        return 'singbox'
      }
    } catch {
      // not JSON
    }
  }

  // 2. Try YAML -> check for proxies array -> clash
  if (trimmed.includes('proxies:') || trimmed.includes('proxy-groups:')) {
    try {
      const doc = yaml.load(trimmed) as Record<string, unknown>
      if (doc && typeof doc === 'object' && Array.isArray(doc['proxies'])) {
        return 'clash'
      }
    } catch {
      // not valid YAML
    }
  }

  // 3. Check for [General] header -> surge or loon
  if (trimmed.includes('[General]')) {
    if (trimmed.includes('[Proxy Group]') || trimmed.includes('[Remote Proxy]')) {
      return 'loon'
    }
    return 'surge'
  }

  // 4. Check for direct proxy:// links
  if (hasProxyLinkUri(trimmed)) {
    return 'base64' // raw lines, treated same as base64 path
  }

  // 5. Check if valid base64 -> try decode -> check for proxy links
  if (isValidBase64(trimmed)) {
    try {
      const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
      const decoded = atob(padded)
      if (hasProxyLinkUri(decoded)) {
        return 'base64'
      }
    } catch {
      // not base64
    }
  }

  return 'unknown'
}

export function parseSubscriptionContent(
  content: string,
  sourceId: string,
  hint?: DetectedFormat,
): ProxyNode[] {
  const format = hint ?? detectFormat(content)

  switch (format) {
    case 'clash':
      return parseClashConfig(content, sourceId)
    case 'singbox':
      return parseSingboxConfig(content, sourceId)
    case 'base64':
      // Raw URI lines and encoded subscriptions share the same downstream parser.
      if (hasProxyLinkUri(content.trim())) {
        return parseProxyLinks(content, sourceId)
      }
      return parseBase64Subscription(content, sourceId)
    case 'surge':
    case 'loon':
      // Frontend parsing only supports URI-like lines inside client text configs.
      return parseProxyLinks(content, sourceId)
    case 'unknown':
    default:
      // Try base64 as last resort
      return parseBase64Subscription(content, sourceId)
  }
}
