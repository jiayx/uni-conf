import { describe, expect, it, vi } from 'vitest'
import type { RuleSetCatalogSnapshot } from '@uni-conf/types'
import { ensureDefaultRemoteRuleSets } from './default-rule-sets'

const timestamp = '2026-07-27T00:00:00.000Z'

describe('default remote rule sets', () => {
  it('materializes managed catalog items and skips optional items', async () => {
    const inserted: unknown[][] = []
    const db = createMockDb(inserted)

    await ensureDefaultRemoteRuleSets(db, timestamp, 'proxy', snapshot())

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      1: 'China',
      3: 'mihomo',
      4: 'classical',
      5: 'example',
      6: 'cn',
      8: 'builtin-direct',
      9: 1,
      10: 30,
    })
  })

  it('uses catalog policy metadata to disable a managed rule in the other unmatched mode', async () => {
    const inserted: unknown[][] = []
    const db = createMockDb(inserted)

    await ensureDefaultRemoteRuleSets(db, timestamp, 'direct', snapshot())

    expect(inserted[0]?.[9]).toBe(0)
    expect(inserted[0]?.[11]).toContain('[uni-conf:auto-disabled:missing-target]')
  })

  it('uses the generated deployment snapshot when no runtime snapshot is supplied', async () => {
    const inserted: unknown[][] = []
    const db = createMockDb(inserted)

    await ensureDefaultRemoteRuleSets(db, timestamp)

    const ids = inserted.map((args) => args[6])
    expect(ids).toContain('private')
    expect(ids).toContain('socialmedia')
  })

  it('orders broad fallback sets after scenarios in both unmatched traffic modes', async () => {
    const proxyInserted: unknown[][] = []
    const directInserted: unknown[][] = []

    await ensureDefaultRemoteRuleSets(createMockDb(proxyInserted), timestamp, 'proxy')
    await ensureDefaultRemoteRuleSets(createMockDb(directInserted), timestamp, 'direct')

    const proxy = managedPresetStates(proxyInserted)
    const direct = managedPresetStates(directInserted)

    expect(proxy.get('cdn')).toBeUndefined()
    expect(proxy.get('public-direct-cdn')).toEqual({ enabled: 1, sortOrder: 30 })
    expect(proxy.get('apple-cn')).toEqual({ enabled: 1, sortOrder: 30 })
    expect(proxy.get('speedtest')).toEqual({ enabled: 1, sortOrder: 150 })
    expect(proxy.get('cn')).toEqual({ enabled: 1, sortOrder: 800 })
    expect(proxy.get('cncidr')).toEqual({ enabled: 1, sortOrder: 810 })
    expect(proxy.get('gfw')).toEqual({ enabled: 0, sortOrder: 800 })

    expect(direct.get('public-direct-cdn')).toEqual({ enabled: 1, sortOrder: 30 })
    expect(direct.get('apple-cn')).toEqual({ enabled: 1, sortOrder: 30 })
    expect(direct.get('speedtest')).toEqual({ enabled: 1, sortOrder: 150 })
    expect(direct.get('cn')).toEqual({ enabled: 0, sortOrder: 800 })
    expect(direct.get('cncidr')).toEqual({ enabled: 0, sortOrder: 810 })
    expect(direct.get('gfw')).toEqual({ enabled: 1, sortOrder: 800 })
  })

  it('removes the previously managed global CDN rule set', async () => {
    const deleted: string[] = []
    const db = createMockDb(
      [],
      [{ id: 'legacy-cdn', preset_source: 'quixotic', preset_id: 'cdn' }],
      deleted,
    )

    await ensureDefaultRemoteRuleSets(db, timestamp, 'proxy')

    expect(deleted).toContain('legacy-cdn')
  })
})

function managedPresetStates(
  inserted: unknown[][],
): Map<string, { enabled: unknown; sortOrder: unknown }> {
  return new Map(
    inserted.map((args) => [String(args[6]), { enabled: args[9], sortOrder: args[10] }]),
  )
}

function snapshot(): RuleSetCatalogSnapshot {
  const source = {
    sourceId: 'mihomo',
    url: 'https://raw.githubusercontent.com/example/rules/main/cn.list',
    format: 'mihomo' as const,
    behavior: 'classical' as const,
    default: true,
    nativeFor: ['mihomo' as const],
  }
  return {
    schemaVersion: 1,
    generatedAt: timestamp,
    catalogs: [
      {
        id: 'example',
        name: 'Example',
        repositoryUrl: 'https://github.com/example/rules',
        branch: 'main',
        syncedAt: timestamp,
        items: [
          {
            id: 'cn',
            name: 'China',
            suggestedTarget: 'DIRECT',
            provisioning: 'foundation',
            sortOrder: 30,
            activeForUnmatchedPolicies: ['proxy'],
            sources: [source],
          },
          {
            id: 'optional',
            name: 'Optional',
            suggestedTarget: 'PROXY',
            provisioning: 'optional',
            sortOrder: 900,
            activeForUnmatchedPolicies: ['proxy', 'direct'],
            sources: [source],
          },
        ],
      },
    ],
  }
}

function createMockDb(
  inserted: unknown[][],
  existingPresets: Record<string, unknown>[] = [],
  deleted: string[] = [],
): D1Database {
  const groups = [
    { id: 'builtin-proxy', name: 'PROXY', enabled: 1 },
    { id: 'builtin-direct', name: 'DIRECT', enabled: 1 },
    { id: 'builtin-reject', name: 'REJECT', enabled: 1 },
    { id: 'builtin-ai', name: 'AI', enabled: 1 },
    { id: 'builtin-streaming', name: 'Streaming', enabled: 1 },
    { id: 'builtin-social', name: 'Social', enabled: 1 },
    { id: 'builtin-github', name: 'GitHub', enabled: 1 },
    { id: 'builtin-google', name: 'Google', enabled: 1 },
    { id: 'builtin-apple', name: 'Apple', enabled: 1 },
    { id: 'builtin-microsoft', name: 'Microsoft', enabled: 1 },
    { id: 'builtin-speedtest', name: 'Speedtest', enabled: 1 },
    { id: 'builtin-crypto', name: 'Crypto', enabled: 1 },
    { id: 'builtin-gaming', name: 'Gaming', enabled: 1 },
  ]
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      all: async () => ({
        results: sql.includes('FROM groups')
          ? groups
          : sql.includes('FROM remote_rule_sets')
            ? existingPresets
            : [],
      }),
      run: async () => ({ success: true }),
      first: async () => null,
      raw: async () => [],
      __sql: sql,
      __args: args,
    }),
    all: async () => ({ results: sql.includes('FROM groups') ? groups : [] }),
    run: async () => ({ success: true }),
    first: async () => null,
    raw: async () => [],
  })) as unknown as D1Database['prepare']
  return {
    prepare,
    batch: vi.fn(
      async (statements: Array<D1PreparedStatement & { __sql?: string; __args?: unknown[] }>) => {
        for (const statement of statements) {
          if (statement.__sql?.includes('INSERT INTO remote_rule_sets'))
            inserted.push(statement.__args ?? [])
          if (statement.__sql?.includes('DELETE FROM remote_rule_sets WHERE id = ?')) {
            deleted.push(String(statement.__args?.[0] ?? ''))
          }
        }
        return []
      },
    ),
  } as unknown as D1Database
}
