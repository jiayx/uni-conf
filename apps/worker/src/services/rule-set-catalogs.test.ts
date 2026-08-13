import { describe, expect, it, vi } from 'vitest'
import type { RuleSetCatalogSnapshot } from '@uni-conf/types'
import {
  getRuleSetCatalogSnapshot,
  refreshRuleSetCatalogSnapshot,
  refreshRuleSetCatalogSnapshotIfDue,
} from './rule-set-catalogs'

describe('rule-set catalog snapshots', () => {
  it('uses the bundled managed snapshot when KV is empty', async () => {
    const kv = { get: vi.fn(async () => null) } as unknown as KVNamespace
    const snapshot = await getRuleSetCatalogSnapshot(kv)

    expect(snapshot.catalogs.map((catalog) => catalog.id)).toEqual(['quixotic', 'broker-rules'])
    expect(snapshot.catalogs.flatMap((catalog) => catalog.items)).toHaveLength(48)
    expect(
      snapshot.catalogs.find((catalog) => catalog.id === 'broker-rules')?.items[0],
    ).toMatchObject({
      id: 'broker',
      suggestedTarget: 'Broker',
      provisioning: 'scenario',
    })
    expect(
      snapshot.catalogs
        .find((catalog) => catalog.id === 'quixotic')
        ?.items.find((item) => item.id === 'private')?.sources[0],
    ).toMatchObject({
      sourceId: 'mihomo',
      url: 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/ruleset/meta/private.list',
      default: true,
    })
    expect(
      snapshot.catalogs
        .find((catalog) => catalog.id === 'quixotic')
        ?.items.find((item) => item.id === 'public-direct-cdn'),
    ).toBeUndefined()
    expect(
      snapshot.catalogs
        .find((catalog) => catalog.id === 'quixotic')
        ?.items.find((item) => item.id === 'cdn'),
    ).toBeUndefined()
    expect(
      snapshot.catalogs
        .flatMap((catalog) => catalog.items)
        .every((item) => item.provisioning !== 'optional'),
    ).toBe(true)
  })

  it('prefers the latest valid snapshot from KV', async () => {
    const cached: RuleSetCatalogSnapshot = {
      schemaVersion: 1,
      generatedAt: '2026-07-27T00:00:00.000Z',
      catalogs: [
        {
          id: 'quixotic',
          name: 'Cached Quixotic',
          repositoryUrl: 'https://github.com/QuixoticHeart/rule-set',
          branch: 'ruleset',
          syncedAt: '2026-07-27T00:00:00.000Z',
          items: [],
        },
        {
          id: 'broker-rules',
          name: 'Cached Broker',
          repositoryUrl: 'https://github.com/forecho/broker-rules',
          branch: 'main',
          syncedAt: '2026-07-27T00:00:00.000Z',
          items: [],
        },
      ],
    }
    const kv = { get: vi.fn(async () => cached) } as unknown as KVNamespace

    expect((await getRuleSetCatalogSnapshot(kv)).catalogs[0]?.name).toBe('Cached Quixotic')
  })

  it('scans the compiled definitions and stores the full catalog in KV', async () => {
    const fetcher = createCatalogFetcher()
    const put = vi.fn(async () => undefined)
    const kv = { put } as unknown as KVNamespace

    const snapshot = await refreshRuleSetCatalogSnapshot({ KV: kv }, fetcher)

    expect(
      fetcher.mock.calls
        .map(([input]) => String(input))
        .every((url) => !url.includes('jiayx/uni-conf')),
    ).toBe(true)
    expect(snapshot.catalogs.find((catalog) => catalog.id === 'quixotic')?.items).toContainEqual(
      expect.objectContaining({
        id: 'telegram',
        provisioning: 'optional',
        suggestedTarget: undefined,
      }),
    )
    expect(
      snapshot.catalogs
        .flatMap((catalog) => catalog.items)
        .filter((item) => item.sources.filter((source) => source.default).length !== 1)
        .map((item) => item.id),
    ).toEqual([])
    expect(put).toHaveBeenCalledOnce()
  })

  it('refreshes immediately when KV has no full catalog snapshot', async () => {
    const fetcher = createCatalogFetcher()
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    } as unknown as KVNamespace

    const snapshot = await refreshRuleSetCatalogSnapshotIfDue({ KV: kv }, Date.now(), fetcher)

    expect(snapshot?.catalogs.find((catalog) => catalog.id === 'quixotic')?.items).toContainEqual(
      expect.objectContaining({ id: 'telegram' }),
    )
  })
})

function createCatalogFetcher() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/branches/')) return Response.json({ commit: { sha: 'abc123' } })
    if (url.includes('/contents/custom?')) {
      return Response.json([{ type: 'file', name: 'telegram.list', path: 'custom/telegram.list' }])
    }
    if (url.includes('/forecho/broker-rules/contents/')) {
      const path = decodeURIComponent(new URL(url).pathname.split('/contents/')[1] ?? '')
      return Response.json({ type: 'file', name: path.split('/').at(-1), path })
    }
    const path = decodeURIComponent(
      new URL(url).pathname.split('/contents/')[1]?.split('?')[0] ?? '',
    )
    const extension = path.includes('singbox') ? 'srs' : path.includes('egern') ? 'yaml' : 'list'
    return Response.json([
      { type: 'file', name: `ai.${extension}`, path: `${path}/ai.${extension}` },
    ])
  })
}
