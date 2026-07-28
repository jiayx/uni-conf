import { describe, expect, it, vi } from 'vitest'
import { convertRuleSetContent } from '@uni-conf/rule-set'
import type { ExportData } from '../export-data'
import type { RemoteRuleSet } from '@uni-conf/types'
import {
  getConvertedRemoteRuleSet,
  preflightRuleSetConversions,
  resolveConvertibleRuleSetTarget,
  RuleSetConversionError,
} from './rule-set-conversion'

describe('rule set conversion orchestration', () => {
  it('only advertises conversion paths whose semantics can be preserved', () => {
    expect(resolveConvertibleRuleSetTarget('clash', 'singbox')).toBe('singbox')
    expect(resolveConvertibleRuleSetTarget('singbox', 'mihomo')).toBe('mihomo')
    expect(resolveConvertibleRuleSetTarget('surge', 'singbox')).toBe('singbox')
    expect(resolveConvertibleRuleSetTarget('singbox', 'quantumultx')).toBe('quantumultx')
    expect(resolveConvertibleRuleSetTarget('clash', 'loon')).toBe('loon')
    expect(resolveConvertibleRuleSetTarget('egern', 'singbox')).toBe('singbox')
    expect(resolveConvertibleRuleSetTarget('singbox', 'egern')).toBe('egern')
  })

  it('caches converted content and reuses it without another upstream request', async () => {
    const values = new Map<string, string>()
    const kv = {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => { values.set(key, value) },
    } as unknown as KVNamespace
    let fetchCount = 0
    const fetcher = async () => {
      fetchCount += 1
      return new Response('payload:\n  - DOMAIN-SUFFIX,example.com\n')
    }
    const source = makeRuleSet()

    const first = await getConvertedRemoteRuleSet(source, 'singbox', { kv, fetcher })
    const second = await getConvertedRemoteRuleSet(source, 'singbox', { kv, fetcher })

    expect(first).toEqual(second)
    expect(fetchCount).toBe(1)
    expect(values.size).toBe(1)
    expect([...values.keys()][0]).toMatch(/^converted-rule-set:v11:[a-f0-9]{64}$/)
  })

  it('ignores structurally corrupt cached JSON and rebuilds it from upstream', async () => {
    const values = new Map<string, string>()
    const kv = {
      get: async () => JSON.stringify({
        content: 42,
        contentType: 'application/json',
        convertedRuleCount: 'many',
        skippedRuleCount: -1,
      }),
      put: async (key: string, value: string) => { values.set(key, value) },
    } as unknown as KVNamespace
    let fetchCount = 0
    const result = await getConvertedRemoteRuleSet(makeRuleSet(), 'singbox', {
      kv,
      fetcher: async () => {
        fetchCount += 1
        return new Response('payload:\n  - DOMAIN-SUFFIX,current.example\n')
      },
    })

    expect(fetchCount).toBe(1)
    expect(result.content).toContain('current.example')
    expect(values.size).toBe(1)
  })

  it('bypasses stale content for an explicit preview and refreshes the shared cache', async () => {
    const values = new Map<string, string>()
    const kv = {
      get: async (key: string) => values.get(key) ?? null,
      put: async (key: string, value: string) => { values.set(key, value) },
    } as unknown as KVNamespace
    let upstreamDomain = 'old.example'
    let fetchCount = 0
    const fetcher = async () => {
      fetchCount += 1
      return new Response(`payload:\n  - DOMAIN-SUFFIX,${upstreamDomain}\n`)
    }
    const source = makeRuleSet()

    const initial = await getConvertedRemoteRuleSet(source, 'singbox', { kv, fetcher })
    upstreamDomain = 'current.example'
    const refreshed = await getConvertedRemoteRuleSet(source, 'singbox', {
      kv,
      fetcher,
      bypassCache: true,
    })
    const reused = await getConvertedRemoteRuleSet(source, 'singbox', { kv, fetcher })

    expect(initial.content).toContain('old.example')
    expect(refreshed.content).toContain('current.example')
    expect(reused.content).toBe(refreshed.content)
    expect(fetchCount).toBe(2)
  })

  it('rejects oversized conversion sources before reading their bodies', async () => {
    await expect(getConvertedRemoteRuleSet(makeRuleSet(), 'singbox', {
      fetcher: async () => new Response('small', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }),
    })).rejects.toMatchObject({ code: 'too_large' } satisfies Partial<RuleSetConversionError>)
  })

  it('defers compatible conversions until the client requests the converted rule set', async () => {
    const fetcher = vi.fn(async () => new Response('payload:\n  - DOMAIN-SUFFIX,example.com\n'))
    const result = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      policy: 'compatible',
      fetcher,
    })

    expect(result).toEqual({ warnings: [], blockingWarnings: [], blockingWarning: null })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('counts non-string YAML payload entries instead of silently dropping them', async () => {
    const converted = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'singbox',
      'payload:\n  - DOMAIN-SUFFIX,example.com\n  - 443\n  - { type: DOMAIN, value: hidden.example }\n'
    )
    expect(converted.convertedRuleCount).toBe(1)
    expect(converted.skippedRuleCount).toBe(2)
    expect(converted.skippedRuleTypes).toEqual({ INVALID: 2 })
    expect(converted.skippedRuleExamples.INVALID).toEqual([
      '443',
      '{"type":"DOMAIN","value":"hidden.example"}',
    ])

    const strict = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      policy: 'strict',
      fetcher: async () => new Response(
        'payload:\n  - DOMAIN-SUFFIX,example.com\n  - 443\n  - { type: DOMAIN, value: hidden.example }\n'
      ),
    })
    expect(strict.blockingWarning).toMatchObject({
      code: 'remote-rule-set-conversion-partial',
      level: 'unsupported',
      transformation: expect.objectContaining({
        action: 'block',
        convertedCount: 1,
        skippedCount: 2,
      }),
    })
  })

  it('distinguishes unavailable, oversized, and invalid conversion sources', async () => {
    const unavailable = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      policy: 'strict',
      fetcher: async () => { throw new Error('offline') },
    })
    expect(unavailable.blockingWarning).toMatchObject({
      code: 'remote-rule-set-conversion-failed',
      message: expect.stringContaining('下载失败'),
      messageEn: expect.stringContaining('could not be downloaded'),
      transformation: expect.objectContaining({ reason: 'source-download-failed' }),
    })

    const oversized = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      policy: 'strict',
      fetcher: async () => new Response('small', {
        headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
      }),
    })
    expect(oversized.blockingWarning).toMatchObject({
      message: expect.stringContaining('超过 4 MiB'),
      messageEn: expect.stringContaining('exceeds the 4 MiB'),
      transformation: expect.objectContaining({ reason: 'source-too-large' }),
    })
  })

  it('blocks partial conversions in strict completeness mode', async () => {
    const result = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      policy: 'strict',
      fetcher: async () => new Response('payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy\n'),
    })

    expect(result.blockingWarning).toMatchObject({
      code: 'remote-rule-set-conversion-partial',
      level: 'unsupported',
      remediation: { target: 'remote-rule-sets', id: 'rules-1' },
      transformation: expect.objectContaining({
        action: 'block',
        convertedCount: 1,
        skippedCount: 1,
      }),
    })
    expect(result.blockingWarning?.message).toMatch(/严格完整模式已阻止导出/)
    expect(result.blockingWarnings).toEqual([result.blockingWarning])
    expect(result.warnings).toEqual([result.blockingWarning])
  })

  it('reports every conversion problem in one strict preflight instead of stopping at the first', async () => {
    const ruleSets = [
      { ...makeRuleSet(), id: 'partial', name: 'Partial', url: 'https://rules.example.com/partial.yaml' },
      { ...makeRuleSet(), id: 'invalid', name: 'Invalid', url: 'https://rules.example.com/invalid.yaml' },
      { ...makeRuleSet(), id: 'complete', name: 'Complete', url: 'https://rules.example.com/complete.yaml' },
    ]
    const result = await preflightRuleSetConversions(makeExportData(ruleSets), 'singbox', {
      policy: 'strict',
      fetcher: async (input) => {
        const url = String(input)
        if (url.includes('/partial.')) {
          return new Response('payload:\n  - DOMAIN-SUFFIX,partial.example\n  - SCRIPT,legacy\n')
        }
        if (url.includes('/invalid.')) {
          return new Response('payload:\n  - SCRIPT,legacy\n')
        }
        return new Response('payload:\n  - DOMAIN-SUFFIX,complete.example\n')
      },
    })

    expect(result.warnings.map(warning => (
      warning.remediation?.target === 'remote-rule-sets' ? warning.remediation.id : null
    ))).toEqual([
      'partial',
      'invalid',
    ])
    expect(result.blockingWarnings.map(warning => (
      warning.remediation?.target === 'remote-rule-sets' ? warning.remediation.id : null
    ))).toEqual([
      'partial',
      'invalid',
    ])
    expect(result.blockingWarning).toBe(result.blockingWarnings[0])
    expect(result.warnings.map(warning => warning.code)).toEqual([
      'remote-rule-set-conversion-partial',
      'remote-rule-set-conversion-failed',
    ])
  })

  it('does not call a no-resolve rule fully converted when the target has no equivalent option', async () => {
    const compatible = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      fetcher: async () => new Response(
        'payload:\n  - DOMAIN-SUFFIX,example.com\n  - IP-CIDR,10.0.0.0/8,no-resolve\n'
      ),
    })
    expect(compatible).toEqual({ warnings: [], blockingWarnings: [], blockingWarning: null })

    const strict = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      policy: 'strict',
      fetcher: async () => new Response(
        'payload:\n  - DOMAIN-SUFFIX,example.com\n  - IP-CIDR,10.0.0.0/8,no-resolve\n'
      ),
    })
    expect(strict.blockingWarning).toEqual(expect.objectContaining({
      level: 'unsupported',
      message: expect.stringContaining('IP-CIDR-NO-RESOLVE × 1'),
    }))
  })

  it('preflights conversions with bounded concurrency while keeping warning order stable', async () => {
    const ruleSets = Array.from({ length: 5 }, (_, index) => ({
      ...makeRuleSet(),
      id: `rules-${index}`,
      name: `Rules ${index}`,
      url: `https://rules.example.com/list-${index}.yaml`,
      sortOrder: index,
    }))
    let active = 0
    let maxActive = 0
    const fetcher = async (input: RequestInfo | URL) => {
      const index = Number(String(input).match(/list-(\d+)/)?.[1] ?? 0)
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, (5 - index) * 3))
      active -= 1
      return new Response('payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy\n')
    }

    const result = await preflightRuleSetConversions(makeExportData(ruleSets), 'singbox', {
      policy: 'strict',
      fetcher,
      concurrency: 2,
    })

    expect(maxActive).toBe(2)
    expect(result.warnings.map(warning => warning.message.match(/"([^"]+)"/)?.[1])).toEqual([
      'Rules 0', 'Rules 1', 'Rules 2', 'Rules 3', 'Rules 4',
    ])
  })

  it('coalesces duplicate conversion sources within one preflight', async () => {
    let fetchCount = 0
    const ruleSets = [
      { ...makeRuleSet(), id: 'rules-1', name: 'First' },
      { ...makeRuleSet(), id: 'rules-2', name: 'Second' },
    ]
    const result = await preflightRuleSetConversions(makeExportData(ruleSets), 'singbox', {
      policy: 'strict',
      fetcher: async () => {
        fetchCount += 1
        await new Promise(resolve => setTimeout(resolve, 5))
        return new Response('payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy\n')
      },
    })

    expect(fetchCount).toBe(1)
    expect(result.warnings).toHaveLength(2)
  })
})

function makeRuleSet(): RemoteRuleSet {
  return {
    id: 'rules-1', name: 'Rules', url: 'https://rules.example.com/list.yaml', format: 'clash',
    behavior: 'classical', sourceOverrides: {}, targetGroupId: 'group-1', updateInterval: 12, enabled: true, sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeExportData(ruleSet: RemoteRuleSet | RemoteRuleSet[]): ExportData {
  return {
    nodeRows: [], groupRows: [], ruleRows: [], remoteSetRows: [], sourceRows: [], sources: [], nodes: [],
    groups: [], rules: [], remoteSets: Array.isArray(ruleSet) ? ruleSet : [ruleSet], collectionNodeNames: {},
  }
}
