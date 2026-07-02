import type { ProxyNode } from '@uni-conf/types'
import yaml from 'js-yaml'
import { parseBase64Subscription } from './base64.parser'
import { parseClashConfig } from './clash.parser'
import { parseSingboxConfig } from './singbox.parser'
import { parseProxyLinks } from './proxy-link.parser'

export type DetectedFormat = 'clash' | 'singbox' | 'base64' | 'surge' | 'loon' | 'unknown'

const PROXY_SCHEME_RE = /^(ss|vmess|vless|trojan|hysteria2?|hy2|tuic|anytls|socks5):\/\//m

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
  if (PROXY_SCHEME_RE.test(trimmed)) {
    return 'base64' // raw lines, treated same as base64 path
  }

  // 5. Check if valid base64 -> try decode -> check for proxy links
  if (isValidBase64(trimmed)) {
    try {
      const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
      const decoded = atob(padded)
      if (PROXY_SCHEME_RE.test(decoded)) {
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
      // Could be raw lines or actual base64
      if (PROXY_SCHEME_RE.test(content.trim())) {
        return parseProxyLinks(content, sourceId)
      }
      return parseBase64Subscription(content, sourceId)
    case 'surge':
    case 'loon':
      // For surge/loon we do a best-effort: extract proxy lines
      return parseProxyLinks(content, sourceId)
    case 'unknown':
    default:
      // Try base64 as last resort
      return parseBase64Subscription(content, sourceId)
  }
}
