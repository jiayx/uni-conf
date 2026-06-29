import { describe, expect, it, vi } from 'vitest'
import {
  default as remoteRuleSetsApp,
  isManagedRemoteRuleSet,
  isManagedRemoteRuleSetUpdate,
  isValidRuleSetBehavior,
  isValidRuleSetFormat,
  validateRemoteRuleSetWrite,
} from './remote-rule-sets'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(),
}))

describe('remote rule set routes', () => {
  it('treats provider presets as managed rows', () => {
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: 'ai' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: 'uni-conf', preset_id: 'telegram' })).toBe(true)
    expect(isManagedRemoteRuleSet({ preset_source: null, preset_id: null })).toBe(false)
    expect(isManagedRemoteRuleSet({ preset_source: 'quixotic', preset_id: null })).toBe(false)
  })

  it('only allows toggling managed remote rule sets', () => {
    expect(isManagedRemoteRuleSetUpdate({ enabled: false })).toBe(true)
    expect(isManagedRemoteRuleSetUpdate({ enabled: true })).toBe(true)
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
  })

  it('normalizes remote rule set writes', () => {
    expect(validateRemoteRuleSetWrite({
      name: '  AI Rules  ',
      url: ' https://example.com/ai.list ',
      format: 'mihomo',
      behavior: 'classical',
      targetGroupId: ' builtin-ai ',
      updateInterval: 12,
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
      targetGroupId: 'builtin-ai',
      updateInterval: 12,
      enabled: true,
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
    }, { create: true })).toEqual({
      valid: true,
      name: 'Custom Rules',
      url: 'https://example.com/custom.list',
      format: 'mihomo',
      behavior: 'classical',
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
      error: 'url must be an http(s) URL',
    })
    expect(validateRemoteRuleSetWrite({ updateInterval: 0 }, { create: false })).toEqual({
      valid: false,
      error: 'updateInterval must be a positive integer',
    })
    expect(validateRemoteRuleSetWrite({ sortOrder: 1.5 }, { create: false })).toEqual({
      valid: false,
      error: 'sortOrder must be an integer',
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
})

function createRemoteRuleSetRouteDb({
  existing,
  enabledTargetGroupIds,
}: {
  existing: Record<string, unknown>
  enabledTargetGroupIds: Set<string>
}): D1Database & { updates: unknown[][] } {
  const updates: unknown[][] = []
  return {
    updates,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT * FROM remote_rule_sets WHERE id = ?')) return existing
          if (sql.includes('SELECT id, collection_ids FROM groups')) {
            const id = String(args[0] ?? '')
            return enabledTargetGroupIds.has(id) ? { id, collection_ids: '[]' } : null
          }
          return null
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('UPDATE remote_rule_sets SET')) updates.push(args)
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database & { updates: unknown[][] }
}
