import { describe, expect, it, vi } from 'vitest'
import {
  discoverSourceRemoteRuleSets,
  syncSourceLinkedRemoteRuleSets,
} from './source-rule-sets'

describe('subscription source rule sets', () => {
  it('discovers referenced and unreferenced HTTP providers and resolves relative URLs', () => {
    expect(discoverSourceRemoteRuleSets(`
rule-providers:
  streaming:
    type: http
    behavior: classical
    url: ./rules/streaming.yaml
    interval: 7200
  local-only:
    type: file
    path: ./rules/local.yaml
  binary:
    type: http
    format: mrs
    url: https://rules.example.com/binary.mrs
  unreferenced:
    type: http
    format: text
    behavior: domain
    url: https://rules.example.com/unreferenced.list
rules:
  - RULE-SET,streaming,Streaming
`, 'mihomo', 'https://subscription.example.com/config/main.yaml')).toEqual([
      {
        key: 'streaming',
        name: 'streaming',
        url: 'https://subscription.example.com/config/rules/streaming.yaml',
        format: 'mihomo',
        behavior: 'classical',
        updateInterval: 2,
        upstreamTarget: 'Streaming',
        referenced: true,
      },
      {
        key: 'unreferenced',
        name: 'unreferenced',
        url: 'https://rules.example.com/unreferenced.list',
        format: 'text',
        behavior: 'domain',
        updateInterval: 24,
        upstreamTarget: undefined,
        referenced: false,
      },
    ])
  })

  it('discovers MRS providers with an explicit supported behavior', () => {
    expect(discoverSourceRemoteRuleSets(`
rule-providers:
  private:
    type: http
    format: mrs
    behavior: ipcidr
    url: https://rules.example.com/private.mrs
`, 'mihomo')).toEqual([
      expect.objectContaining({
        key: 'private',
        format: 'mrs',
        behavior: 'ipcidr',
        url: 'https://rules.example.com/private.mrs',
      }),
    ])
  })

  it('updates linked metadata and marks removed providers as missing', async () => {
    const boundOperations: Array<{ sql: string; args: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...args: unknown[]) => {
          boundOperations.push({ sql, args })
          return {
            first: async () => sql.includes('FROM sources')
              ? {
                  raw_content: `rule-providers:
  current:
    type: http
    behavior: domain
    url: https://rules.example.com/current.list`,
                  format: 'mihomo',
                  url: 'https://subscription.example.com/config.yaml',
                }
              : null,
            all: async () => ({
              results: [
                {
                  id: 'set-current', source_rule_set_key: 'current',
                  url: 'https://rules.example.com/old.list', format: 'mihomo', behavior: 'classical',
                  update_interval: 12, source_missing: 1,
                },
                {
                  id: 'set-removed', source_rule_set_key: 'removed',
                  url: 'https://rules.example.com/removed.list', format: 'mihomo', behavior: 'domain',
                  update_interval: 24, source_missing: 0,
                },
              ],
            }),
          }
        },
      })),
      batch: vi.fn(async () => []),
    } as unknown as D1Database

    await syncSourceLinkedRemoteRuleSets(db, 'source-1', '2026-07-26T00:00:00.000Z')

    expect(db.batch).toHaveBeenCalledOnce()
    expect((db.batch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(2)
    expect(boundOperations).toContainEqual({
      sql: expect.stringContaining('source_missing = 1'),
      args: ['2026-07-26T00:00:00.000Z', 'set-removed', 'source-1'],
    })
    expect(boundOperations).toContainEqual({
      sql: expect.stringContaining('source_missing = 0'),
      args: [
        'https://rules.example.com/current.list',
        'mihomo',
        'domain',
        24,
        '2026-07-26T00:00:00.000Z',
        'set-current',
        'source-1',
      ],
    })
  })

  it('does not write linked metadata when the source definition is unchanged', async () => {
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: () => ({
          first: async () => sql.includes('FROM sources')
            ? {
                raw_content: `rule-providers:\n  current:\n    type: http\n    behavior: domain\n    url: https://rules.example.com/current.list`,
                format: 'mihomo',
                url: 'https://subscription.example.com/config.yaml',
              }
            : null,
          all: async () => ({
            results: [{
              id: 'set-current', source_rule_set_key: 'current',
              url: 'https://rules.example.com/current.list', format: 'mihomo', behavior: 'domain',
              update_interval: 24, source_missing: 0,
            }],
          }),
        }),
      })),
      batch: vi.fn(async () => []),
    } as unknown as D1Database

    await syncSourceLinkedRemoteRuleSets(db, 'source-1', '2026-07-26T00:00:00.000Z')

    expect(db.batch).not.toHaveBeenCalled()
  })
})
