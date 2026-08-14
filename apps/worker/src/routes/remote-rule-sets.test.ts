import { describe, expect, it, vi } from 'vitest'
import {
  default as remoteRuleSetsApp,
  isManagedRemoteRuleSet,
  isManagedRemoteRuleSetUpdate,
  isValidRuleSetBehavior,
  validateRemoteRuleSetWrite,
} from './remote-rule-sets'
import { ensureZeroSetupDefaults } from '../services/zero-setup'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(),
}))

describe('remote rule set routes', () => {
  it('treats provider presets as managed rows', () => {
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: 'ai' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: 'broker-rules', preset_id: 'broker' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: null, preset_id: null })).toBe(false)
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: null })).toBe(false)
  })

  it('only allows toggling, target overrides, or target-native source overrides on managed remote rule sets', () => {
    expect(isManagedRemoteRuleSetUpdate({ enabled: false })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ enabled: true })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ sourceOverrides: { singbox: 'https://example.com/ai.srs' } })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ targetOverrideGroupId: 'builtin-proxy' })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ targetOverrideGroupId: null })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ enabled: true, sourceOverrides: {} })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({})).toBe(false)
    expect(isManagedRemoteRuleSetUpdate({ name: 'AI' })).toBe(false)
    expect(isManagedRemoteRuleSetUpdate({ enabled: false, targetGroupId: 'builtin-proxy' })).toBe(false)
  })

  it('validates rule set behavior values', () => {
    expect(isValidRuleSetBehavior('domain')).toBe(true)
    expect(isValidRuleSetBehavior('ipcidr')).toBe(true)
    expect(isValidRuleSetBehavior('classical')).toBe(true)
    expect(isValidRuleSetBehavior('text')).toBe(false)
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

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'managed_rule_set_unused',
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
      error: 'built-in remote rule sets only allow enabled state, target override, and target-native source overrides to be changed',
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
    expect(db.updates[0]?.[10]).toBe(0)
    expect(db.batches).toHaveLength(0)
  })

  it('stores and clears a managed target override without changing the canonical target', async () => {
    const initialSyncCalls = vi.mocked(ensureZeroSetupDefaults).mock.calls.length
    const db = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow(),
      enabledTargetGroupIds: new Set(['builtin-ai', 'builtin-proxy']),
    })

    const overrideResponse = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetOverrideGroupId: 'builtin-proxy' }),
    }, { DB: db })

    expect(overrideResponse.status).toBe(200)
    expect(db.updates[0]?.[7]).toBe('builtin-ai')
    expect(db.updates[0]?.[8]).toBe('builtin-proxy')
    expect(ensureZeroSetupDefaults).toHaveBeenCalledTimes(initialSyncCalls + 2)

    const clearDb = createRemoteRuleSetRouteDb({
      existing: managedRemoteRuleSetRow({ target_override_group_id: 'builtin-proxy' }),
      enabledTargetGroupIds: new Set(['builtin-ai', 'builtin-proxy']),
    })
    const clearResponse = await remoteRuleSetsApp.request('/preset-ai', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetOverrideGroupId: null }),
    }, { DB: clearDb })

    expect(clearResponse.status).toBe(200)
    expect(clearDb.updates[0]?.[7]).toBe('builtin-ai')
    expect(clearDb.updates[0]?.[8]).toBeNull()
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
    expect(db.batches).toHaveLength(0)
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
    expect(db.batches).toHaveLength(0)
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
    target_override_group_id: null,
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

function createRemoteRuleSetRouteDb({
  existing,
  enabledTargetGroupIds,
  allRuleSets = [],
  events,
}: {
  existing: Record<string, unknown>
  enabledTargetGroupIds: Set<string>
  allRuleSets?: Record<string, unknown>[]
  events?: string[]
}): D1Database & { updates: unknown[][]; deletes: unknown[][]; batches: unknown[][] } {
  const updates: unknown[][] = []
  const deletes: unknown[][] = []
  const batches: unknown[][] = []
  return {
    updates,
    deletes,
    batches,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM remote_rule_sets WHERE id = ?')) {
            events?.push('select-existing')
            return existing
          }
          if (sql.includes('SELECT id, preset_source, preset_id FROM remote_rule_sets WHERE id = ?')) return existing
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
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({
        results: sql.includes('FROM remote_rule_sets') ? allRuleSets
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
  } as unknown as D1Database & { updates: unknown[][]; deletes: unknown[][]; batches: unknown[][] }
}
