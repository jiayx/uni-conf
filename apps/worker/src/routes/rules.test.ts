import { describe, expect, it, vi } from 'vitest'
import rulesApp, { isValidRuleType, validateRuleInput } from './rules'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(),
}))

describe('rules route helpers', () => {
  it('validates rule types from the shared compatibility map', () => {
    expect(isValidRuleType('DOMAIN-SUFFIX')).toBe(true)
    expect(isValidRuleType('MATCH')).toBe(true)
    expect(isValidRuleType('DOMAIN_SET')).toBe(false)
    expect(isValidRuleType('')).toBe(false)
  })

  it('requires payload except for MATCH rules', () => {
    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      targetGroupId: 'builtin-proxy',
    })).toBeNull()

    expect(validateRuleInput({
      type: 'MATCH',
      payload: '',
      targetGroupId: 'builtin-proxy',
    })).toBeNull()

    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: '',
      targetGroupId: 'builtin-proxy',
    })).toBe('payload is required unless type is MATCH')
  })

  it('allows create inputs to omit target policy group', () => {
    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      targetGroupId: ' ',
    })).toBeNull()
  })

  it('creates rules with PROXY when the target is omitted', async () => {
    const db = createRulesRouteDb()

    const response = await rulesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'DOMAIN-SUFFIX', payload: 'example.com' }),
    }, { DB: db })

    expect(response.status).toBe(201)
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0]?.[5]).toBe('builtin-proxy')
  })

  it('rejects node outlet targets when creating rules', async () => {
    const db = createRulesRouteDb()

    const response = await rulesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'DOMAIN-SUFFIX',
        payload: 'example.com',
        targetGroupId: 'builtin-auto-select',
      }),
    }, { DB: db })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'target group is disabled or missing',
    })
    expect(db.inserts).toHaveLength(0)
  })

  it('rejects node outlet targets in batch-created rules', async () => {
    const db = createRulesRouteDb()

    const response = await rulesApp.request('/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rules: [{
          type: 'DOMAIN-SUFFIX',
          payload: 'example.com',
          targetGroupId: 'builtin-node-select',
        }],
      }),
    }, { DB: db })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'target group is disabled or missing: builtin-node-select',
    })
    expect(db.inserts).toHaveLength(0)
  })
})

function createRulesRouteDb(): D1Database & { inserts: unknown[][] } {
  const inserts: unknown[][] = []
  let lastInserted: Record<string, unknown> | null = null
  const enabledRuleTargetIds = new Set(['builtin-proxy', 'builtin-direct', 'builtin-reject', 'builtin-ai'])

  return {
    inserts,
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT MAX(sort_order)')) return { max_order: 0 }
          if (sql.includes('SELECT id, collection_ids FROM groups')) {
            const id = String(args[0] ?? '')
            return enabledRuleTargetIds.has(id) ? { id, collection_ids: '[]' } : null
          }
          if (sql.includes('SELECT * FROM rules WHERE id = ?')) return lastInserted
          return null
        },
        all: async () => {
          if (sql.includes('SELECT id, collection_ids FROM groups')) {
            return {
              results: [...enabledRuleTargetIds].map(id => ({ id, collection_ids: '[]' })),
            }
          }
          return { results: [] }
        },
        run: async () => {
          if (sql.includes('INSERT INTO rules')) {
            inserts.push(args)
            lastInserted = ruleRowFromInsert(args)
          }
          return { success: true }
        },
        raw: async () => [],
      }),
      first: async () => {
        if (sql.includes('SELECT MAX(sort_order)')) return { max_order: 0 }
        return null
      },
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database & { inserts: unknown[][] }
}

function ruleRowFromInsert(args: unknown[]): Record<string, unknown> {
  return {
    id: args[0],
    name: args[1],
    type: args[2],
    payload: args[3],
    no_resolve: args[4],
    target_group_id: args[5],
    enabled: args[6],
    sort_order: args[7],
    notes: args[8],
    compatibility: args[9],
    created_at: args[10],
    updated_at: args[11],
  }
}
