import type { ExportFormat } from '@uni-conf/types'
import { normalizeDnsRealIpDomainList } from '@uni-conf/shared'
import {
  MANAGED_REAL_IP_DOMAINS,
  QUIXOTIC_FAKE_IP_FILTER_TEXT_URL,
  parseManagedRealIpDomainList,
} from '../generators/dns-policy'
import { safeRemoteFetch } from './safe-remote-fetch'

const CACHE_KEY = 'dns-resources:quixotic-fake-ip-filter:v2'
const MAX_RESPONSE_BYTES = 256 * 1024
export const MANAGED_DNS_RESOURCE_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

interface CachedFakeIpFilter {
  domains: string[]
  updatedAt: string
}

export async function getManagedRealIpDomains(kv?: KVNamespace): Promise<string[]> {
  if (!kv) return [...MANAGED_REAL_IP_DOMAINS]
  try {
    const cached = await kv.get<CachedFakeIpFilter>(CACHE_KEY, 'json')
    return isCachedFakeIpFilter(cached) ? cached.domains : [...MANAGED_REAL_IP_DOMAINS]
  } catch {
    return [...MANAGED_REAL_IP_DOMAINS]
  }
}

export function exportNeedsInlineManagedRealIpDomains(format: ExportFormat): boolean {
  return (
    format === 'stash' ||
    format === 'loon' ||
    format === 'surge' ||
    format === 'shadowrocket' ||
    format === 'quantumultx' ||
    format === 'egern'
  )
}

export async function refreshManagedDnsResources(
  kv: KVNamespace,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const response = await safeRemoteFetch(
    fetcher,
    QUIXOTIC_FAKE_IP_FILTER_TEXT_URL,
    { headers: { accept: 'text/plain' } },
    { timeoutMs: 10_000 },
  )
  if (!response.ok) {
    throw new Error(`Quixotic fake-ip-filter returned HTTP ${response.status}`)
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('Quixotic fake-ip-filter exceeds the size limit')
  }
  const content = await response.text()
  if (new TextEncoder().encode(content).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('Quixotic fake-ip-filter exceeds the size limit')
  }
  const domains = parseManagedRealIpDomainList(content)
  if (domains.length === 0) {
    throw new Error('Quixotic fake-ip-filter is empty')
  }
  const cached: CachedFakeIpFilter = {
    domains,
    updatedAt: new Date().toISOString(),
  }
  await kv.put(CACHE_KEY, JSON.stringify(cached))
  return domains.length
}

export async function refreshManagedDnsResourcesIfDue(
  kv: KVNamespace,
  nowMs = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const cached = await kv.get<CachedFakeIpFilter>(CACHE_KEY, 'json')
    if (
      isCachedFakeIpFilter(cached) &&
      nowMs - Date.parse(cached.updatedAt) < MANAGED_DNS_RESOURCE_REFRESH_INTERVAL_MS
    ) {
      return null
    }
  } catch {
    // A failed cache read should not prevent rebuilding the managed resource.
  }
  return refreshManagedDnsResources(kv, fetcher)
}

function isCachedFakeIpFilter(value: unknown): value is CachedFakeIpFilter {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CachedFakeIpFilter>
  return (
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.domains) &&
    candidate.domains.length > 0 &&
    normalizeDnsRealIpDomainList(candidate.domains) !== undefined
  )
}
