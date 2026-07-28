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

    const ids = inserted.map(args => args[6])
    expect(ids).toContain('private')
    expect(ids).toContain('socialmedia')
  })
})

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
    catalogs: [{
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
    }],
  }
}

function createMockDb(inserted: unknown[][]): D1Database {
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
      all: async () => ({ results: sql.includes('FROM groups') ? groups : [] }),
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
    batch: vi.fn(async (statements: Array<D1PreparedStatement & { __sql?: string; __args?: unknown[] }>) => {
      for (const statement of statements) {
        if (statement.__sql?.includes('INSERT INTO remote_rule_sets')) inserted.push(statement.__args ?? [])
      }
      return []
    }),
  } as unknown as D1Database
}
