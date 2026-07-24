import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import type { ExportData } from '../export-data'
import type { RemoteRuleSet } from '@uni-conf/types'
import { convertRuleSetContent, getConvertedRemoteRuleSet, preflightRuleSetConversions, resolveConvertibleRuleSetTarget, resolveRuleSetConversionIssues, RuleSetConversionError } from './rule-set-conversion'

describe('rule set conversion', () => {
  it('converts a Clash classical provider to sing-box source JSON and reports skipped directives', () => {
    const result = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'singbox',
      `payload:\n  - DOMAIN-SUFFIX,example.com\n  - IP-CIDR,10.0.0.0/8,no-resolve\n  - SCRIPT,legacy-script`
    )
    expect(JSON.parse(result.content)).toEqual({
      version: 3,
      rules: [
        { domain_suffix: ['example.com'] },
      ],
    })
    expect(result.convertedRuleCount).toBe(1)
    expect(result.skippedRuleCount).toBe(2)
    expect(result.skippedRuleTypes).toEqual({ 'IP-CIDR-NO-RESOLVE': 1, SCRIPT: 1 })
    expect(result.skippedRuleExamples).toEqual({
      'IP-CIDR-NO-RESOLVE': ['IP-CIDR,10.0.0.0/8,no-resolve'],
      SCRIPT: ['SCRIPT,legacy-script'],
    })
    expect(result.convertedRuleExamples).toEqual([{
      source: 'DOMAIN-SUFFIX,example.com',
      target: '{"domain_suffix":["example.com"]}',
    }])
    expect(resolveRuleSetConversionIssues(result)).toEqual([
      {
        type: 'IP-CIDR-NO-RESOLVE', count: 1, reason: 'unsupported-option',
        resolution: 'remove-unsupported-option', examples: ['IP-CIDR,10.0.0.0/8,no-resolve'],
      },
      {
        type: 'SCRIPT', count: 1, reason: 'unsupported-directive',
        resolution: 'use-native-source', examples: ['SCRIPT,legacy-script'],
      },
    ])
  })

  it('does not broaden sing-box rules that contain multiple AND condition families', () => {
    const result = convertRuleSetContent(
      { format: 'singbox', behavior: 'domain' },
      'mihomo',
      JSON.stringify({ version: 3, rules: [
        { domain_suffix: ['safe.example'] },
        { domain_suffix: ['combined.example'], network: ['tcp'] },
      ] })
    )
    expect(result.content).toContain('+.safe.example')
    expect(result.content).not.toContain('combined.example')
    expect(result.skippedRuleCount).toBe(1)
    expect(result.skippedRuleTypes).toEqual({ COMPOUND: 1 })
    expect(result.skippedRuleExamples.COMPOUND?.[0]).toContain('combined.example')
    expect(resolveRuleSetConversionIssues(result)[0]).toMatchObject({
      reason: 'compound-condition', resolution: 'use-native-source',
    })
  })

  it('recommends removing a lossy option only when the option itself is unsupported', () => {
    expect(resolveRuleSetConversionIssues({
      skippedRuleTypes: { 'IP-CIDR-NO-RESOLVE': 1 },
      skippedRuleExamples: { 'IP-CIDR-NO-RESOLVE': ['IP-CIDR,10.0.0.0/8,no-resolve'] },
    })).toEqual([{
      type: 'IP-CIDR-NO-RESOLVE', count: 1, reason: 'unsupported-option',
      resolution: 'remove-unsupported-option', examples: ['IP-CIDR,10.0.0.0/8,no-resolve'],
    }])
  })

  it('only advertises conversion paths whose semantics can be preserved', () => {
    expect(resolveConvertibleRuleSetTarget('clash', 'singbox')).toBe('singbox')
    expect(resolveConvertibleRuleSetTarget('singbox', 'mihomo')).toBe('mihomo')
    expect(resolveConvertibleRuleSetTarget('surge', 'singbox')).toBe('singbox')
    expect(resolveConvertibleRuleSetTarget('singbox', 'quantumultx')).toBe('quantumultx')
    expect(resolveConvertibleRuleSetTarget('clash', 'loon')).toBe('loon')
    expect(resolveConvertibleRuleSetTarget('egern', 'singbox')).toBe('singbox')
    expect(resolveConvertibleRuleSetTarget('singbox', 'egern')).toBe('egern')
  })

  it('converts sing-box rules to native Egern YAML and reports non-equivalent conditions', () => {
    const result = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'egern',
      JSON.stringify({ version: 3, rules: [
        { domain: ['Exact.Example'] },
        { domain_suffix: ['suffix.example'] },
        { ip_cidr: ['10.0.0.0/8', '2001:db8::/32'] },
        { port: [443] },
        { protocol: ['quic'] },
        { source_port: [8080] },
      ] })
    )
    expect(yaml.load(result.content)).toEqual({
      domain_set: ['Exact.Example'],
      domain_suffix_set: ['suffix.example'],
      ip_cidr_set: ['10.0.0.0/8'],
      ip_cidr6_set: ['2001:db8::/32'],
      dest_port_set: [443],
      protocol_set: ['quic'],
    })
    expect(result.convertedRuleCount).toBe(6)
    expect(result.skippedRuleTypes).toEqual({ 'SRC-PORT': 1 })
  })

  it('parses native Egern YAML without silently flattening unsupported sets', () => {
    const result = convertRuleSetContent(
      { format: 'egern', behavior: 'classical' },
      'singbox',
      `domain_set:\n  - exact.example\ndomain_suffix_set:\n  - suffix.example\nip_cidr_set:\n  - 10.0.0.0/8\nuser_agent_set:\n  - ExampleApp*\n`
    )
    expect(JSON.parse(result.content).rules).toEqual([
      { domain: ['exact.example'] },
      { domain_suffix: ['suffix.example'] },
      { ip_cidr: ['10.0.0.0/8'] },
    ])
    expect(result.skippedRuleTypes).toEqual({ 'USER-AGENT': 1 })
  })

  it('normalizes Quantumult X aliases when converting to sing-box', () => {
    const result = convertRuleSetContent(
      { format: 'quantumultx', behavior: 'classical' },
      'singbox',
      'HOST-SUFFIX,example.com\nIP6-CIDR,2001:db8::/32,no-resolve\nUSER-AGENT,Legacy*\n'
    )
    expect(JSON.parse(result.content)).toEqual({
      version: 3,
      rules: [
        { domain_suffix: ['example.com'] },
      ],
    })
    expect(result.skippedRuleCount).toBe(2)
    expect(result.skippedRuleTypes).toEqual({
      'IP-CIDR6-NO-RESOLVE': 1,
      'USER-AGENT': 1,
    })
  })

  it('preserves source-IP semantics and rejects unknown text-rule options', () => {
    const result = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'singbox',
      [
        'IP-CIDR,192.168.0.0/16,src',
        'IP-CIDR,10.0.0.0/8,src,no-resolve',
        'IP-CIDR,172.16.0.0/12,unknown-option',
        'DOMAIN-SUFFIX,example.com,no-resolve',
      ].join('\n')
    )

    expect(JSON.parse(result.content)).toEqual({
      version: 3,
      rules: [{ source_ip_cidr: ['192.168.0.0/16'] }],
    })
    expect(result.skippedRuleTypes).toEqual({
      'SRC-IP-CIDR-NO-RESOLVE': 1,
      'IP-CIDR-OPTION-UNKNOWN-OPTION': 1,
      'DOMAIN-SUFFIX-OPTION-NO-RESOLVE': 1,
    })
    expect(resolveRuleSetConversionIssues(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'IP-CIDR-OPTION-UNKNOWN-OPTION',
        reason: 'unsupported-option',
        resolution: 'remove-unsupported-option',
      }),
      expect.objectContaining({
        type: 'SRC-IP-CIDR-NO-RESOLVE',
        reason: 'unsupported-option',
      }),
    ]))
  })

  it('maps text port ranges to sing-box range fields without changing their meaning', () => {
    const result = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'singbox',
      [
        'DST-PORT,8000-9000',
        'SRC-PORT,1000:2000',
        'DST-PORT,443',
      ].join('\n')
    )

    expect(JSON.parse(result.content)).toEqual({
      version: 3,
      rules: [
        { port_range: ['8000:9000'] },
        { source_port_range: ['1000:2000'] },
        { port: [443] },
      ],
    })
    expect(result.convertedRuleCount).toBe(3)
    expect(result.skippedRuleCount).toBe(0)
  })

  it('parses sing-box port-range fields but rejects ranges stored in the wrong field', () => {
    const result = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'mihomo',
      JSON.stringify({
        version: 3,
        rules: [
          { port_range: ['8000:9000'] },
          { source_port_range: ['1000:2000'] },
          { port: ['443:444'] },
          { port_range: [443] },
        ],
      })
    )

    expect(result.content).toContain('DST-PORT,8000-9000')
    expect(result.content).toContain('SRC-PORT,1000-2000')
    expect(result.content).not.toContain('443-444')
    expect(result.convertedRuleCount).toBe(2)
    expect(result.skippedRuleTypes).toEqual({ 'INVALID-DST-PORT': 2 })
  })

  it('uses each text client port spelling and skips unsupported source-port rules', () => {
    const source = JSON.stringify({
      version: 3,
      rules: [
        { domain_suffix: ['example.com'] },
        { port: [443] },
        { port_range: ['8000:9000'] },
        { source_port_range: ['1000:2000'] },
      ],
    })

    const surge = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'surge',
      source,
    )
    const loon = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'loon',
      source,
    )
    const shadowrocket = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'shadowrocket',
      source,
    )
    const quantumultx = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'quantumultx',
      source,
    )

    expect(surge.content).toContain('DEST-PORT,443')
    expect(surge.content).toContain('DEST-PORT,8000-9000')
    expect(surge.content).toContain('SRC-PORT,1000-2000')
    expect(loon.content).toContain('DEST-PORT,8000-9000')
    expect(loon.content).toContain('SRC-PORT,1000-2000')
    expect(shadowrocket.content).toContain('DST-PORT,8000-9000')
    expect(shadowrocket.content).not.toContain('SRC-PORT')
    expect(shadowrocket.skippedRuleTypes).toEqual({ 'SRC-PORT': 1 })
    expect(quantumultx.content).toBe('HOST-SUFFIX,example.com\n')
    expect(quantumultx.skippedRuleTypes).toEqual({ 'DST-PORT': 2, 'SRC-PORT': 1 })
  })

  it('separates sing-box transport networks from sniffed protocols', () => {
    const result = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'singbox',
      [
        'PROTOCOL,tcp',
        'PROTOCOL,http',
        'NETWORK,udp',
        'NETWORK,icmp',
        'NETWORK,http',
        'PROTOCOL,unknown-probe',
      ].join('\n')
    )

    expect(JSON.parse(result.content)).toEqual({
      version: 3,
      rules: [
        { network: ['tcp'] },
        { protocol: ['http'] },
        { network: ['udp'] },
        { network: ['icmp'] },
      ],
    })
    expect(result.skippedRuleTypes).toEqual({
      'INVALID-NETWORK': 1,
      PROTOCOL: 1,
    })
  })

  it('uses the shared value-level protocol resolver for Mihomo, Surge, and Loon', () => {
    const source = JSON.stringify({
      version: 3,
      rules: [
        { network: ['tcp'] },
        { protocol: ['udp'] },
        { protocol: ['https'] },
        { network: ['icmp'] },
      ],
    })
    const mihomo = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'mihomo',
      source,
    )
    const surge = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'surge',
      source,
    )
    const loon = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'loon',
      source,
    )

    expect(mihomo.content).toContain('NETWORK,tcp')
    expect(mihomo.content).toContain('NETWORK,udp')
    expect(mihomo.content).not.toContain('https')
    expect(mihomo.skippedRuleTypes).toEqual({ PROTOCOL: 1, NETWORK: 1 })
    expect(surge.content).toContain('PROTOCOL,TCP')
    expect(surge.content).toContain('PROTOCOL,UDP')
    expect(surge.content).toContain('PROTOCOL,HTTPS')
    expect(surge.skippedRuleTypes).toEqual({ NETWORK: 1 })
    expect(loon.content).toContain('PROTOCOL,TCP')
    expect(loon.content).toContain('PROTOCOL,UDP')
    expect(loon.content).not.toContain('HTTPS')
    expect(loon.skippedRuleTypes).toEqual({ PROTOCOL: 1, NETWORK: 1 })
  })

  it('does not drop no-resolve from non-classical Mihomo provider output', () => {
    expect(() => convertRuleSetContent(
      { format: 'egern', behavior: 'ipcidr' },
      'mihomo',
      'ip_cidr_set:\n  - 10.0.0.0/8\nno_resolve: true\n'
    )).toThrow('No rules can be represented safely in Mihomo provider format')
  })

  it('converts sing-box source rules to Quantumult X without flattening compound rules', () => {
    const result = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'quantumultx',
      JSON.stringify({ version: 3, rules: [
        { domain: ['exact.example'] },
        { domain_suffix: ['suffix.example'] },
        { ip_cidr: ['2001:db8::/32'] },
        { domain_suffix: ['combined.example'], network: ['tcp'] },
        { process_name: ['unsafe'] },
      ] })
    )
    expect(result.content).toBe('HOST,exact.example\nHOST-SUFFIX,suffix.example\nIP6-CIDR,2001:db8::/32\n')
    expect(result.convertedRuleCount).toBe(3)
    expect(result.skippedRuleCount).toBe(2)
    expect(result.skippedRuleTypes).toEqual({ COMPOUND: 1, 'PROCESS-NAME': 1 })
  })

  it('rejects malformed domain and CIDR payloads instead of emitting invalid target rules', () => {
    const domains = convertRuleSetContent(
      { format: 'text', behavior: 'domain' },
      'singbox',
      'valid.example\ninvalid domain\nhttps://not-a-domain.example/path\n'
    )
    expect(JSON.parse(domains.content).rules).toEqual([{ domain: ['valid.example'] }])
    expect(domains.skippedRuleTypes).toEqual({ 'INVALID-DOMAIN': 2 })
    expect(resolveRuleSetConversionIssues(domains)).toContainEqual(expect.objectContaining({
      type: 'INVALID-DOMAIN', reason: 'invalid-rule', resolution: 'repair-source-rule', examples: ['invalid domain', 'https://not-a-domain.example/path'],
    }))

    const cidrs = convertRuleSetContent(
      { format: 'text', behavior: 'ipcidr' },
      'singbox',
      '10.0.0.0/8\n999.1.1.1/24\n2001:db8::/129\n'
    )
    expect(JSON.parse(cidrs.content).rules).toEqual([{ ip_cidr: ['10.0.0.0/8'] }])
    expect(cidrs.skippedRuleTypes).toEqual({ 'INVALID-CIDR': 2 })
  })

  it('rejects invalid domain regular expressions instead of caching broken target rules', () => {
    const result = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'singbox',
      [
        'DOMAIN-REGEX,^safe\\.(example|test)$',
        'DOMAIN-REGEX,[unterminated',
      ].join('\n')
    )

    expect(JSON.parse(result.content)).toEqual({
      version: 3,
      rules: [{ domain_regex: ['^safe\\.(example|test)$'] }],
    })
    expect(result.skippedRuleTypes).toEqual({ 'INVALID-DOMAIN-REGEX': 1 })
  })

  it('caps diagnostic examples without losing exact skipped counts', () => {
    const invalidRules = Array.from({ length: 30 }, (_, index) => `SCRIPT,legacy-${index}`).join('\n')
    const result = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'singbox',
      `DOMAIN,valid.example\n${invalidRules}`
    )

    expect(result.skippedRuleTypes).toEqual({ SCRIPT: 30 })
    expect(result.skippedRuleExamples.SCRIPT).toHaveLength(3)
    expect(resolveRuleSetConversionIssues(result)).toMatchObject([{
      type: 'SCRIPT', count: 30, reason: 'unsupported-directive', resolution: 'use-native-source',
    }])
  })

  it('caps converted rule mappings without changing complete conversion counts', () => {
    const validRules = Array.from(
      { length: 30 },
      (_, index) => `DOMAIN-SUFFIX,example-${index}.com`,
    ).join('\n')
    const result = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'quantumultx',
      validRules,
    )

    expect(result.convertedRuleCount).toBe(30)
    expect(result.convertedRuleExamples).toHaveLength(20)
    expect(result.convertedRuleExamplesTruncated).toBe(true)
    expect(result.convertedRuleExamples[0]).toEqual({
      source: 'DOMAIN-SUFFIX,example-0.com',
      target: 'HOST-SUFFIX,example-0.com',
    })

    const duplicates = convertRuleSetContent(
      { format: 'clash', behavior: 'classical' },
      'quantumultx',
      Array.from({ length: 30 }, () => 'DOMAIN-SUFFIX,same.example').join('\n'),
    )
    expect(duplicates.convertedRuleCount).toBe(30)
    expect(duplicates.convertedRuleExamples).toHaveLength(1)
    expect(duplicates.convertedRuleExamplesTruncated).toBe(false)
  })

  it('does not ignore unknown sing-box conditions when a known condition is also present', () => {
    const result = convertRuleSetContent(
      { format: 'singbox', behavior: 'classical' },
      'mihomo',
      JSON.stringify({ version: 3, rules: [
        { domain_suffix: ['safe.example'] },
        { domain_suffix: ['would-broaden.example'], process_name: ['browser'] },
      ] })
    )
    expect(result.content).toContain('safe.example')
    expect(result.content).not.toContain('would-broaden.example')
    expect(result.skippedRuleTypes).toEqual({ COMPOUND: 1 })
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
    expect([...values.keys()][0]).toMatch(/^converted-rule-set:v10:[a-f0-9]{64}$/)
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

  it('normalizes cached artifacts created before skipped-type diagnostics existed', async () => {
    const legacy = {
      content: '{"version":3,"rules":[]}', contentType: 'application/json',
      convertedRuleCount: 1, skippedRuleCount: 0,
    }
    const kv = {
      get: async () => JSON.stringify(legacy),
      put: async () => undefined,
    } as unknown as KVNamespace
    const fetcher = async () => { throw new Error('should not fetch') }

    await expect(getConvertedRemoteRuleSet(makeRuleSet(), 'singbox', { kv, fetcher })).resolves.toEqual({
      ...legacy,
      skippedRuleTypes: {},
      skippedRuleExamples: {},
      convertedRuleExamples: [],
      convertedRuleExamplesTruncated: false,
    })
  })

  it('rejects oversized conversion sources before reading their bodies', async () => {
    await expect(getConvertedRemoteRuleSet(makeRuleSet(), 'singbox', {
      fetcher: async () => new Response('small', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } }),
    })).rejects.toMatchObject({ code: 'too_large' } satisfies Partial<RuleSetConversionError>)
  })

  it('preflights partial conversions and blocks conversions with no safe rules', async () => {
    const partial = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      fetcher: async () => new Response('payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy\n'),
    })
    expect(partial.blockingWarning).toBeNull()
    expect(partial.warnings).toContainEqual(expect.objectContaining({
      code: 'remote-rule-set-conversion-partial',
      level: 'partial',
      message: expect.stringMatching(/跳过.*SCRIPT × 1/),
      remediation: expect.objectContaining({
        target: 'remote-rule-sets',
        id: 'rules-1',
        sourceOverrideTarget: 'singbox',
      }),
      transformation: expect.objectContaining({
        resource: 'remote-rule-set',
        action: 'degrade',
        convertedCount: 1,
        skippedCount: 1,
      }),
    }))

    const blocked = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      fetcher: async () => new Response('payload:\n  - SCRIPT,legacy\n'),
    })
    expect(blocked.blockingWarning).toMatchObject({
      level: 'unsupported',
      message: expect.stringContaining('内容无法安全转换'),
      transformation: expect.objectContaining({ reason: 'source-invalid-content' }),
    })
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
      fetcher: async () => { throw new Error('offline') },
    })
    expect(unavailable.blockingWarning).toMatchObject({
      code: 'remote-rule-set-conversion-failed',
      message: expect.stringContaining('下载失败'),
      messageEn: expect.stringContaining('could not be downloaded'),
      transformation: expect.objectContaining({ reason: 'source-download-failed' }),
    })

    const oversized = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
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
      null,
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
      'remote-rule-set-converted',
    ])
    expect(result.warnings[2]?.remediation).toBeUndefined()
  })

  it('does not call a no-resolve rule fully converted when the target has no equivalent option', async () => {
    const compatible = await preflightRuleSetConversions(makeExportData(makeRuleSet()), 'singbox', {
      fetcher: async () => new Response(
        'payload:\n  - DOMAIN-SUFFIX,example.com\n  - IP-CIDR,10.0.0.0/8,no-resolve\n'
      ),
    })
    expect(compatible.blockingWarning).toBeNull()
    expect(compatible.warnings).toContainEqual(expect.objectContaining({
      level: 'partial',
      message: expect.stringContaining('IP-CIDR-NO-RESOLVE × 1'),
    }))

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
