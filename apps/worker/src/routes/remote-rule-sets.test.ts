import { describe, expect, it, vi } from 'vitest'
import {
  default as remoteRuleSetsApp,
  isManagedRemoteRuleSet,
  isManagedRemoteRuleSetUpdate,
  isValidRuleSetBehavior,
  isValidRuleSetFormat,
  isRuleSetPreviewTarget,
  validateRemoteRuleSetWrite,
} from './remote-rule-sets'
import { validateRemoteRuleSetContent } from '../services/remote-rule-set-validation'
import { getConvertedRemoteRuleSet, RuleSetConversionError } from '../services/rule-set-conversion'
import { ensureZeroSetupDefaults } from '../services/zero-setup'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(),
}))

vi.mock('../services/remote-rule-set-validation', () => ({
  validateRemoteRuleSetContent: vi.fn(),
}))

vi.mock('../services/rule-set-conversion', async () => {
  const actual = await vi.importActual<typeof import('../services/rule-set-conversion')>('../services/rule-set-conversion')
  return { ...actual, getConvertedRemoteRuleSet: vi.fn() }
})

describe('remote rule set routes', () => {
  it('treats provider presets as managed rows', () => {
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: 'ai' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: 'uni-conf', preset_id: 'telegram' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: null, preset_id: null })).toBe(false)
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: null })).toBe(false)
  })

  it('only allows toggling or target-native source overrides on managed remote rule sets', () => {
    expect(isManagedRemoteRuleSetUpdate({ enabled: false })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ enabled: true })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ sourceOverrides: { singbox: 'https://example.com/ai.srs' } })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ enabled: true, sourceOverrides: {} })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({})).toBe(false)
    expect(isManagedRemoteRuleSetUpdate({ name: 'AI' })).toBe(false)
    expect(isManagedRemoteRuleSetUpdate({ enabled: false, targetGroupId: 'builtin-proxy' })).toBe(false)
  })

  it('validates rule set format and behavior values', () => {
    expect(isValidRuleSetFormat('mihomo')).toBe(true)
    expect(isValidRuleSetFormat('singbox')).toBe(true)
    expect(isValidRuleSetFormat('yaml')).toBe(false)
    expect(isValidRuleSetFormat('')).toBe(false)

    expect(isValidRuleSetBehavior('domain')).toBe(true)
    expect(isValidRuleSetBehavior('ipcidr')).toBe(true)
    expect(isValidRuleSetBehavior('classical')).toBe(true)
    expect(isValidRuleSetBehavior('text')).toBe(false)
    expect(isRuleSetPreviewTarget('quantumultx')).toBe(true)
    expect(isRuleSetPreviewTarget('nodes_raw')).toBe(false)
  })

  it('normalizes remote rule set writes', () => {
    expect(validateRemoteRuleSetWrite({
      name: '  AI Rules  ',
      url: ' https://example.com/ai.list ',
      format: 'mihomo',
      behavior: 'classical',
      sourceOverrides: {
        singbox: ' https://rules.example.com/ai.srs ',
        egern: 'https://rules.example.com/ai.yaml',
      },
      targetGroupId: ' builtin-ai ',
      updateInterval: 12,
      enabled: false,
      sortOrder: 40,
      notes: ' note ',
      presetSource: 'quixotic',
      presetId: 'ai',
    }, { create: true })).toEqual({
      valid: true,
      name: 'AI Rules',
      url: 'https://example.com/ai.list',
      format: 'mihomo',
      behavior: 'classical',
      sourceOverrides: {
        singbox: 'https://rules.example.com/ai.srs',
        egern: 'https://rules.example.com/ai.yaml',
      },
      targetGroupId: 'builtin-ai',
      updateInterval: 12,
      enabled: false,
      sortOrder: 40,
      lastUpdated: undefined,
      notes: 'note',
    })
  })

  it('defaults custom remote rule sets to PROXY when target is omitted', () => {
    expect(validateRemoteRuleSetWrite({
      name: 'Custom Rules',
      url: 'https://example.com/custom.list',
      format: 'mihomo',
      behavior: 'classical',
      sourceOverrides: {},
    }, { create: true })).toEqual({
      valid: true,
      name: 'Custom Rules',
      url: 'https://example.com/custom.list',
      format: 'mihomo',
      behavior: 'classical',
      sourceOverrides: {},
      targetGroupId: 'builtin-proxy',
      updateInterval: 24,
      enabled: true,
      sortOrder: 500,
      lastUpdated: undefined,
      notes: undefined,
    })
  })

  it('rejects malformed remote rule set writes', () => {
    expect(validateRemoteRuleSetWrite({ name: 'Missing fields' }, { create: true })).toEqual({
      valid: false,
      error: 'url is required',
    })
    expect(validateRemoteRuleSetWrite({ url: './local.list' }, { create: false })).toEqual({
      valid: false,
      error: 'url must be a public http(s) URL',
    })
    expect(validateRemoteRuleSetWrite({ url: 'http://169.254.169.254/latest/meta-data' }, { create: false })).toEqual({
      valid: false,
      error: 'url must be a public http(s) URL',
    })
    expect(validateRemoteRuleSetWrite({ url: 'https://user:pass@example.com/rules' }, { create: false })).toEqual({
      valid: false,
      error: 'url must be a public http(s) URL',
    })
    expect(validateRemoteRuleSetWrite({ updateInterval: 0 }, { create: false })).toEqual({
      valid: false,
      error: 'updateInterval must be a positive integer',
    })
    expect(validateRemoteRuleSetWrite({ sortOrder: 1.5 }, { create: false })).toEqual({
      valid: false,
      error: 'sortOrder must be an integer',
    })
    expect(validateRemoteRuleSetWrite({ sourceOverrides: { nodes_raw: 'https://example.com/raw' } } as never, { create: false })).toEqual({
      valid: false,
      error: 'sourceOverrides must contain public http(s) URLs for supported target clients',
    })
    expect(validateRemoteRuleSetWrite({ sourceOverrides: { singbox: 'http://127.0.0.1/rules.srs' } }, { create: false })).toEqual({
      valid: false,
      error: 'sourceOverrides must contain public http(s) URLs for supported target clients',
    })
  })

  it('rejects enabling a remote rule set whose current target group is disabled', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: {
        id: 'preset-ai',
        name: 'AI',
        url: 'https://example.com/ai.list',
        format: 'mihomo',
        behavior: 'classical',
        preset_source: 'quixotic',
        preset_id: 'ai',
        target_group_id: 'builtin-ai',
        update_interval: 24,
        enabled: 0,
        sort_order: 40,
        last_updated: null,
        notes: '[uni-conf:auto-disabled:missing-target]',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      enabledTargetGroupIds: new Set(['builtin-proxy', 'builtin-direct', 'builtin-reject']),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    }, { DB: db })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'target group is disabled or missing',
    })
    expect(db.updates).toHaveLength(0)
  })

  it('rejects editing managed remote rule set fields through the route', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow(),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Edited AI' }),
    }, { DB: db })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'built-in remote rule sets only allow enabled state and target-native source overrides to be changed',
    })
    expect(db.updates).toHaveLength(0)
  })

  it('allows toggling managed remote rule sets through the route', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({ enabled: 1 }),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0]?.[9]).toBe(0)
    expect(db.healthDeletes).toHaveLength(0)
    expect(db.batches).toHaveLength(0)
  })

  it('synchronizes managed defaults before reading the row to update', async () => {
    const events: string[] = []
    vi.mocked(ensureZeroSetupDefaults).mockImplementationOnce(async () => {
      events.push('sync')
      return {} as never
    })
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow(),
      enabledTargetGroupIds: new Set(['builtin-ai']),
      events,
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(events.slice(0, 2)).toEqual(['sync', 'select-existing'])
  })

  it('persists target-native source overrides for managed rule sets without changing canonical fields', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow(),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceOverrides: { singbox: 'https://rules.example.com/ai.srs' } }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0]?.slice(0, 6)).toEqual([
      'AI', 'https://example.com/ai.list', 'mihomo', 'classical', 'quixotic', 'ai',
    ])
    expect(db.updates[0]?.[6]).toBe('{"singbox":"https://rules.example.com/ai.srs"}')
    expect(db.healthDeletes).toEqual([['preset-ai']])
    expect(db.batches).toHaveLength(1)
  })

  it('persists target-native source overrides for custom rule sets', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({ preset_source: null, preset_id: null }),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceOverrides: { egern: 'https://rules.example.com/native.yaml' } }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0]?.[6]).toBe('{"egern":"https://rules.example.com/native.yaml"}')
    expect(db.healthDeletes).toEqual([['preset-ai']])
    expect(db.batches).toHaveLength(1)
  })

  it('rejects deleting managed remote rule sets through the route', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow(),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', { method: 'DELETE' }, { DB: db })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'built-in remote rule sets can be disabled but not deleted',
    })
    expect(db.deletes).toHaveLength(0)
  })

  it('validates a stored remote rule set through the content validator', async () => {
    const existing = managedRemoteRuleSetRow()
    const db = createRemoteRuleSetRouteDb({ existing, enabledTargetGroupIds: new Set(['builtin-ai']) })
    vi.mocked(validateRemoteRuleSetContent).mockResolvedValue({
      status: 'valid',
      checkedAt: '2026-07-14T00:00:00.000Z',
      url: String(existing['url']),
      format: 'mihomo',
      behavior: 'classical',
      inspectionMode: 'text',
      httpStatus: 200,
      contentType: 'text/plain',
      byteLength: 128,
      ruleCount: 4,
      invalidRuleCount: 0,
      issues: [],
    })

    const response = await remoteRuleSetsApp.request('/preset-ai/validate', { method: 'POST' }, { DB: db })

    expect(response.status).toBe(200)
    expect(validateRemoteRuleSetContent).toHaveBeenCalledWith(expect.objectContaining({ id: 'preset-ai', format: 'mihomo' }))
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { status: 'valid', ruleCount: 4 } })
  })

  it('returns 404 when validating a missing remote rule set', async () => {
    const db = createRemoteRuleSetRouteDb({ existing: null as unknown as Record<string, unknown>, enabledTargetGroupIds: new Set() })
    const response = await remoteRuleSetsApp.request('/missing/validate', { method: 'POST' }, { DB: db })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Remote rule set not found' })
  })

  it('summarizes the stored default and target-native source health', async () => {
    vi.mocked(validateRemoteRuleSetContent).mockClear()
    vi.mocked(validateRemoteRuleSetContent).mockImplementation(async ruleSet => {
      const status = ruleSet.url.includes('broken') ? 'invalid' : ruleSet.url.endsWith('.srs') ? 'warning' : 'valid'
      return {
        status, checkedAt: '2026-07-18T00:00:00.000Z',
        url: ruleSet.url, format: ruleSet.format, behavior: ruleSet.behavior,
        inspectionMode: ruleSet.format === 'singbox' ? 'binary-header' : 'structured',
        httpStatus: 200, byteLength: 128, ruleCount: status === 'warning' ? undefined : 4,
        invalidRuleCount: 0, issues: [],
      }
    })
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({
        preset_source: null, preset_id: null,
        source_overrides: JSON.stringify({
          egern: 'https://rules.example.com/broken.yaml',
          singbox: 'https://rules.example.com/native.srs',
        }),
      }),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai/validate-all', { method: 'POST' }, { DB: db })

    expect(response.status).toBe(200)
    expect(validateRemoteRuleSetContent).toHaveBeenCalledTimes(3)
    expect(vi.mocked(validateRemoteRuleSetContent).mock.calls.every(call => Boolean(call[1]?.checkedAt))).toBe(true)
    expect(db.healthWrites).toHaveLength(1)
    expect(db.healthWrites[0]?.[0]).toBe('preset-ai')
    expect(db.healthWrites[0]?.[1]).toEqual(expect.any(String))
    expect(db.healthWrites[0]?.[2]).toEqual(expect.any(String))
    expect(JSON.parse(String(db.healthWrites[0]?.[3]))).toMatchObject({ status: 'invalid', summary: { total: 3 } })
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        status: 'invalid',
        defaultSource: { status: 'valid', format: 'mihomo' },
        sourceOverrides: [
          { targetFormat: 'egern', result: { status: 'invalid' } },
          { targetFormat: 'singbox', result: { status: 'warning' } },
        ],
        summary: { total: 3, valid: 1, warning: 1, invalid: 1 },
      },
    })
  })

  it('returns the persisted whole-source health snapshot and computes freshness', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow(),
      enabledTargetGroupIds: new Set(['builtin-ai']),
      sourceHealth: sourceHealthRow(),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', {}, { DB: db })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        id: 'preset-ai',
        sourceHealth: { status: 'valid', stale: false, expiresAt: '2099-07-19T00:00:00.000Z' },
      },
    })
  })

  it('checks at most five pending rule sets per batch with stable aggregate results', async () => {
    vi.mocked(validateRemoteRuleSetContent).mockClear()
    vi.mocked(validateRemoteRuleSetContent).mockImplementation(async (ruleSet, options) => ({
      status: 'valid', checkedAt: options?.checkedAt ?? '2026-07-18T00:00:00.000Z',
      url: ruleSet.url, format: ruleSet.format, behavior: ruleSet.behavior,
      inspectionMode: 'structured', httpStatus: 200, byteLength: 128,
      ruleCount: 4, invalidRuleCount: 0, issues: [],
    }))
    const rows = Array.from({ length: 6 }, (_, index) => managedRemoteRuleSetRow({
      id: `pending-${index + 1}`,
      preset_source: null,
      preset_id: null,
      source_overrides: JSON.stringify({ egern: `https://rules.example.com/native-${index + 1}.yaml` }),
    }))
    const db = createRemoteRuleSetRouteDb({
      existing: rows[0]!,
      enabledTargetGroupIds: new Set(['builtin-ai']),
      allRuleSets: rows,
      allSourceHealth: [],
    })

    const response = await remoteRuleSetsApp.request('/validate-pending', { method: 'POST' }, { DB: db })

    expect(response.status).toBe(200)
    expect(validateRemoteRuleSetContent).toHaveBeenCalledTimes(10)
    expect(db.healthWrites).toHaveLength(5)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        checkedCount: 5,
        remainingCount: 1,
        results: rows.slice(0, 5).map(row => ({
          ruleSetId: row.id,
          health: { status: 'valid', stale: false, summary: { total: 2, valid: 2 } },
        })),
      },
    })
  })

  it('includes rule sets without source overrides in pending health checks', async () => {
    vi.mocked(validateRemoteRuleSetContent).mockClear()
    vi.mocked(validateRemoteRuleSetContent).mockImplementation(async (ruleSet, options) => ({
      status: 'valid', checkedAt: options?.checkedAt ?? '2026-07-18T00:00:00.000Z',
      url: ruleSet.url, format: ruleSet.format, behavior: ruleSet.behavior,
      inspectionMode: 'structured', httpStatus: 200, byteLength: 128,
      ruleCount: 4, invalidRuleCount: 0, issues: [],
    }))
    const row = managedRemoteRuleSetRow({
      id: 'default-source-only',
      preset_source: null,
      preset_id: null,
      source_overrides: '{}',
    })
    const db = createRemoteRuleSetRouteDb({
      existing: row,
      enabledTargetGroupIds: new Set(['builtin-ai']),
      allRuleSets: [row],
      allSourceHealth: [],
    })

    const response = await remoteRuleSetsApp.request('/validate-pending', { method: 'POST' }, { DB: db })

    expect(response.status).toBe(200)
    expect(validateRemoteRuleSetContent).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        checkedCount: 1,
        remainingCount: 0,
        results: [{ ruleSetId: 'default-source-only' }],
      },
    })
  })

  it('preserves source health when a full-form update keeps every source field unchanged', async () => {
    const existing = managedRemoteRuleSetRow({
      preset_source: null,
      preset_id: null,
      source_overrides: '{"egern":"https://rules.example.com/native.yaml"}',
    })
    const db = createRemoteRuleSetRouteDb({
      existing,
      enabledTargetGroupIds: new Set(['builtin-ai']),
      sourceHealth: sourceHealthRow(),
    })

    const response = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Renamed AI',
        url: existing.url,
        format: existing.format,
        behavior: existing.behavior,
        sourceOverrides: { egern: 'https://rules.example.com/native.yaml' },
        targetGroupId: existing.target_group_id,
        updateInterval: existing.update_interval,
        enabled: true,
        sortOrder: existing.sort_order,
      }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(db.healthDeletes).toHaveLength(0)
    await expect(response.json()).resolves.toMatchObject({ data: { sourceHealth: { stale: false, status: 'valid' } } })
  })

  it('validates an unsaved target-native source with its target format', async () => {
    vi.mocked(validateRemoteRuleSetContent).mockResolvedValue({
      status: 'valid', checkedAt: '2026-07-18T00:00:00.000Z',
      url: 'https://rules.example.com/egern.yaml', format: 'egern', behavior: 'domain',
      inspectionMode: 'structured', httpStatus: 200, contentType: 'text/yaml',
      byteLength: 256, ruleCount: 8, invalidRuleCount: 0, issues: [],
    })

    const response = await remoteRuleSetsApp.request('/validate-source', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: ' https://rules.example.com/egern.yaml ',
        targetFormat: 'egern',
        behavior: 'domain',
      }),
    }, { DB: {} as D1Database })

    expect(response.status).toBe(200)
    expect(validateRemoteRuleSetContent).toHaveBeenCalledWith({
      url: 'https://rules.example.com/egern.yaml', format: 'egern', behavior: 'domain',
    })
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { status: 'valid', format: 'egern' } })
  })

  it('rejects unsafe or unsupported target-native source validation requests', async () => {
    vi.mocked(validateRemoteRuleSetContent).mockClear()
    const unsafe = await remoteRuleSetsApp.request('/validate-source', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1/rules', targetFormat: 'egern', behavior: 'domain' }),
    }, { DB: {} as D1Database })
    const unsupported = await remoteRuleSetsApp.request('/validate-source', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://rules.example.com/list', targetFormat: 'nodes_raw', behavior: 'domain' }),
    }, { DB: {} as D1Database })

    expect(unsafe.status).toBe(400)
    expect(unsupported.status).toBe(400)
    await expect(unsafe.json()).resolves.toMatchObject({ code: 'unsafe_url' })
    await expect(unsupported.json()).resolves.toMatchObject({ code: 'invalid_format' })
    expect(validateRemoteRuleSetContent).not.toHaveBeenCalled()
  })

  it('validates multiple target-native sources in one ordered batch', async () => {
    vi.mocked(validateRemoteRuleSetContent).mockClear()
    vi.mocked(validateRemoteRuleSetContent).mockImplementation(async ruleSet => ({
      status: 'valid', checkedAt: '2026-07-18T00:00:00.000Z',
      url: ruleSet.url, format: ruleSet.format, behavior: ruleSet.behavior,
      inspectionMode: 'structured', httpStatus: 200, byteLength: 128,
      ruleCount: 4, invalidRuleCount: 0, issues: [],
    }))

    const response = await remoteRuleSetsApp.request('/validate-sources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [
        { url: 'https://rules.example.com/egern.yaml', targetFormat: 'egern', behavior: 'domain' },
        { url: 'https://rules.example.com/singbox.srs', targetFormat: 'singbox', behavior: 'domain' },
      ] }),
    }, { DB: {} as D1Database })

    expect(response.status).toBe(200)
    expect(validateRemoteRuleSetContent).toHaveBeenCalledTimes(2)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { results: [
        { targetFormat: 'egern', result: { format: 'egern', status: 'valid' } },
        { targetFormat: 'singbox', result: { format: 'singbox', status: 'valid' } },
      ] },
    })
  })

  it('rejects duplicate target formats before starting a source validation batch', async () => {
    vi.mocked(validateRemoteRuleSetContent).mockClear()
    const response = await remoteRuleSetsApp.request('/validate-sources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources: [
        { url: 'https://rules.example.com/one.yaml', targetFormat: 'egern', behavior: 'domain' },
        { url: 'https://rules.example.com/two.yaml', targetFormat: 'egern', behavior: 'domain' },
      ] }),
    }, { DB: {} as D1Database })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'duplicate_target' })
    expect(validateRemoteRuleSetContent).not.toHaveBeenCalled()
  })

  it('returns direct compatibility without downloading the source', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({ preset_source: null, preset_id: null, format: 'surge' }),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })
    const response = await remoteRuleSetsApp.request('/preset-ai/conversion-preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetFormat: 'surge' }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(getConvertedRemoteRuleSet).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        checkedAt: expect.any(String),
        mode: 'direct',
        targetFormat: 'surge',
        sourceFormat: 'surge',
        outputFormat: 'surge',
      },
    })
  })

  it('prefers a custom target-native source override without conversion', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({
        preset_source: null,
        preset_id: null,
        format: 'clash',
        url: 'https://example.com/default.list',
        source_overrides: JSON.stringify({ egern: 'https://example.com/native-egern.yaml' }),
      }),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })
    const response = await remoteRuleSetsApp.request('/preset-ai/conversion-preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetFormat: 'egern' }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(getConvertedRemoteRuleSet).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { mode: 'direct', sourceFormat: 'egern', outputFormat: 'egern' },
    })
  })

  it('previews converted content with exact counts and truncation metadata', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({ preset_source: null, preset_id: null, format: 'singbox', url: 'https://example.com/source.json' }),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })
    vi.mocked(getConvertedRemoteRuleSet).mockResolvedValue({
      content: `HOST-SUFFIX,example.com\n${'x'.repeat(13 * 1024)}`,
      contentType: 'text/plain; charset=utf-8',
      convertedRuleCount: 8,
      skippedRuleCount: 2,
      skippedRuleTypes: { 'PROCESS-NAME': 1, COMPOUND: 1 },
      skippedRuleExamples: {
        'PROCESS-NAME': ['{"process_name":["browser"]}'],
        COMPOUND: ['{"domain_suffix":["example.com"],"network":["tcp"]}'],
      },
      convertedRuleExamples: [
        { source: '{"domain_suffix":["example.com"]}', target: 'HOST-SUFFIX,example.com' },
      ],
      convertedRuleExamplesTruncated: true,
    })
    const response = await remoteRuleSetsApp.request('/preset-ai/conversion-preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetFormat: 'quantumultx' }),
    }, { DB: db, KV: {} as KVNamespace })

    expect(response.status).toBe(200)
    expect(getConvertedRemoteRuleSet).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'singbox' }),
      'quantumultx',
      expect.objectContaining({ kv: expect.anything(), bypassCache: true }),
    )
    const payload = await response.json() as { data: { preview: string; truncated: boolean } }
    expect(payload).toMatchObject({
      success: true,
      data: {
        checkedAt: expect.any(String),
        mode: 'converted', targetFormat: 'quantumultx', outputFormat: 'quantumultx',
        convertedRuleCount: 8, skippedRuleCount: 2, truncated: true,
        convertedExamples: [
          { source: '{"domain_suffix":["example.com"]}', target: 'HOST-SUFFIX,example.com' },
        ],
        convertedExamplesTruncated: true,
        issues: [
          { type: 'COMPOUND', count: 1, reason: 'compound-condition', resolution: 'use-native-source' },
          { type: 'PROCESS-NAME', count: 1, reason: 'unsupported-directive', resolution: 'use-native-source' },
        ],
      },
    })
    expect(payload.data.preview).toHaveLength(12 * 1024)
    expect(payload.data.preview).toMatch(/^HOST-SUFFIX,example\.com/)
  })

  it('reports unsupported targets without attempting a conversion', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({ preset_source: null, preset_id: null, format: 'unknown' }),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })
    const response = await remoteRuleSetsApp.request('/preset-ai/conversion-preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetFormat: 'singbox' }),
    }, { DB: db })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { mode: 'unsupported' } })
  })

  it('validates preview targets and preserves typed conversion failures', async () => {
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({ preset_source: null, preset_id: null, format: 'singbox' }),
      enabledTargetGroupIds: new Set(['builtin-ai']),
    })
    const invalid = await remoteRuleSetsApp.request('/preset-ai/conversion-preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetFormat: 'nodes_raw' }),
    }, { DB: db })
    expect(invalid.status).toBe(400)

    vi.mocked(getConvertedRemoteRuleSet).mockRejectedValue(new RuleSetConversionError('too_large', 'Rule set is too large to convert'))
    const tooLarge = await remoteRuleSetsApp.request('/preset-ai/conversion-preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetFormat: 'quantumultx' }),
    }, { DB: db })
    expect(tooLarge.status).toBe(413)
    await expect(tooLarge.json()).resolves.toMatchObject({ success: false, code: 'too_large' })
  })
})

function managedRemoteRuleSetRow(patch: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'preset-ai',
    name: 'AI',
    url: 'https://example.com/ai.list',
    format: 'mihomo',
    behavior: 'classical',
    preset_source: 'quixotic',
    preset_id: 'ai',
    target_group_id: 'builtin-ai',
    update_interval: 24,
    enabled: 1,
    sort_order: 40,
    last_updated: null,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

function sourceHealthRow(): Record<string, unknown> {
  return {
    remote_rule_set_id: 'preset-ai',
    expires_at: '2099-07-19T00:00:00.000Z',
    result: JSON.stringify({
      status: 'valid', checkedAt: '2099-07-18T00:00:00.000Z',
      defaultSource: {
        status: 'valid', checkedAt: '2099-07-18T00:00:00.000Z',
        url: 'https://example.com/ai.list', format: 'mihomo', behavior: 'classical',
        inspectionMode: 'structured', byteLength: 128, ruleCount: 4, invalidRuleCount: 0, issues: [],
      },
      sourceOverrides: [],
      summary: { total: 1, valid: 1, warning: 0, invalid: 0 },
    }),
  }
}

function createRemoteRuleSetRouteDb({
  existing,
  enabledTargetGroupIds,
  sourceHealth,
  allRuleSets = [],
  allSourceHealth = [],
  events,
}: {
  existing: Record<string, unknown>
  enabledTargetGroupIds: Set<string>
  sourceHealth?: Record<string, unknown>
  allRuleSets?: Record<string, unknown>[]
  allSourceHealth?: Record<string, unknown>[]
  events?: string[]
}): D1Database & { updates: unknown[][]; deletes: unknown[][]; healthWrites: unknown[][]; healthDeletes: unknown[][]; batches: unknown[][] } {
  const updates: unknown[][] = []
  const deletes: unknown[][] = []
  const healthWrites: unknown[][] = []
  const healthDeletes: unknown[][] = []
  const batches: unknown[][] = []
  return {
    updates,
    deletes,
    healthWrites,
    healthDeletes,
    batches,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM remote_rule_sets WHERE id = ?')) {
            events?.push('select-existing')
            return existing
          }
          if (sql.includes('SELECT id, preset_source, preset_id FROM remote_rule_sets WHERE id = ?')) return existing
          if (sql.includes('FROM remote_rule_set_source_health WHERE remote_rule_set_id = ?')) return sourceHealth ?? null
          if (sql.includes('SELECT id, collection_ids FROM groups')) {
            const id = String(args[0] ?? '')
            return enabledTargetGroupIds.has(id) ? { id, collection_ids: '[]' } : null
          }
          return null
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('UPDATE remote_rule_sets SET')) updates.push(args)
          if (sql.includes('DELETE FROM remote_rule_sets WHERE id = ?')) deletes.push(args)
          if (sql.includes('INSERT INTO remote_rule_set_source_health')) healthWrites.push(args)
          if (sql.includes('DELETE FROM remote_rule_set_source_health')) healthDeletes.push(args)
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({
        results: sql.includes('FROM remote_rule_set_source_health') ? allSourceHealth
          : sql.includes('FROM remote_rule_sets') ? allRuleSets
            : [],
      }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch: vi.fn(async (statements: D1PreparedStatement[]) => {
      batches.push(statements)
      for (const statement of statements) await statement.run()
      return []
    }),
  } as unknown as D1Database & { updates: unknown[][]; deletes: unknown[][]; healthWrites: unknown[][]; healthDeletes: unknown[][]; batches: unknown[][] }
}
