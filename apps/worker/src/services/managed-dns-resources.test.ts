import { describe, expect, it, vi } from 'vitest'
import { MANAGED_REAL_IP_DOMAINS } from '../generators/dns-policy'
import {
  getManagedRealIpDomains,
  refreshManagedDnsResources,
  refreshManagedDnsResourcesIfDue,
} from './managed-dns-resources'

describe('managed DNS resources', () => {
  it('uses the bundled Quixotic snapshot when KV is empty', async () => {
    const kv = { get: vi.fn(async () => null) } as unknown as KVNamespace

    const domains = await getManagedRealIpDomains(kv)

    expect(domains).toEqual(MANAGED_REAL_IP_DOMAINS)
    expect(domains).toContain('*.lan')
    expect(domains).toContain('time.*.apple.com')
  })

  it('refreshes and normalizes the inline list stored in KV', async () => {
    let storedValue = ''
    const put = vi.fn(async (_key: string, value: string) => {
      storedValue = value
    })
    const kv = { put } as unknown as KVNamespace
    const fetcher = vi.fn(
      async () =>
        new Response(`
# comment
*
+.lan
+.lan
time.*.com
invalid domain
`),
    )

    await expect(refreshManagedDnsResources(kv, fetcher as typeof fetch)).resolves.toBe(3)
    expect(fetcher).toHaveBeenCalledOnce()
    const cached = JSON.parse(storedValue) as { domains: string[] }
    expect(cached.domains).toEqual(['*', '*.lan', 'time.*.com'])
  })

  it('does not download the resource again before it expires', async () => {
    const now = Date.now()
    const kv = {
      get: vi.fn(async () => ({
        domains: ['*.lan'],
        updatedAt: new Date(now).toISOString(),
      })),
    } as unknown as KVNamespace
    const fetcher = vi.fn()

    await expect(
      refreshManagedDnsResourcesIfDue(kv, now, fetcher as typeof fetch),
    ).resolves.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
