import { describe, expect, it, vi } from 'vitest'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import rulesApp, {
  isValidRuleType,
  normalizeNullableRuleText,
  validateRuleBatchCreateInput,
  validateRuleBatchEnabledInput,
  validateRuleInput,
  validateRuleReorderInput,
} from './rules'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(),
}))

describe('rules route helpers', () => {
  it('validates rule types from the shared compatibility map', () => {
    expect(isValidRuleType('DOMAIN-SUFFIX')).toBe(true)
    expect(isValidRuleType('DOMAIN_SET')).toBe(false)
    expect(isValidRuleType('')).toBe(false)
  })

  it('requires a valid payload', () => {
    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      targetGroupId: 'builtin-proxy',
      noResolve: false,
      enabled: false,
    })).toBeNull()

    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: '',
      targetGroupId: 'builtin-proxy',
    })).toBe('payload is required unless type is MATCH')
  })

  it('rejects malformed semantic payloads before database access', () => {
    expect(validateRuleInput({ type: 'IP-CIDR', payload: '999.1.1.1/24' }))
      .toBe('payload must be a valid IPv4 CIDR')
    expect(validateRuleInput({ type: 'PORT', payload: '70000' }))
      .toContain('port from 1 to 65535')
    expect(validateRuleInput({ type: 'DOMAIN-REGEX', payload: '[invalid' }))
      .toBe('payload must be a valid domain regular expression')
    expect(validateRuleInput({ type: 'NETWORK', payload: 'quic' }))
      .toBe('payload must be tcp, udp, or icmp')
  })

  it('allows create inputs to omit target policy group', () => {
    expect(validateRuleInput({
      type: 'DOMAIN-SUFFIX',
      payload: 'example.com',
      targetGroupId: ' ',
    })).toBeNull()
  })

  it('normalizes cleared optional rule text to null', () => {
    expect(normalizeNullableRuleText('  note  ')).toBe('note')
    expect(normalizeNullableRuleText('   ')).toBeNull()
    expect(normalizeNullableRuleText(undefined)).toBeNull()
  })

  it('validates and deduplicates batch enable input', () => {
    expect(validateRuleBatchEnabledInput({ ids: [' rule-1 ', 'rule-1', 'rule-2'], enabled: false }))
      .toEqual({ valid: true, ids: ['rule-1', 'rule-2'], enabled: false })
    expect(validateRuleBatchEnabledInput({ ids: [], enabled: true })).toEqual({
      valid: false,
      error: 'ids must contain between 1 and 500 rule ids',
    })
    expect(validateRuleBatchEnabledInput({ ids: ['rule-1'], enabled: 'yes' })).toEqual({
      valid: false,
      error: 'enabled must be a boolean',
    })
  })

  it('bounds batch creation input before touching the database', () => {
    expect(validateRuleBatchCreateInput({ rules: [{ type: 'DOMAIN', payload: 'example.com' }] })).toEqual({
      valid: true,
      rules: [{ type: 'DOMAIN', payload: 'example.com' }],
    })
    expect(validateRuleBatchCreateInput({ rules: [] })).toEqual({
      valid: false,
      error: 'rules must contain between 1 and 500 items',
    })
    expect(validateRuleBatchCreateInput({ rules: Array.from({ length: 501 }, () => ({})) })).toEqual({
      valid: false,
      error: 'rules must contain between 1 and 500 items',
    })
    expect(validateRuleBatchCreateInput({ rules: [null] })).toEqual({
      valid: false,
      error: 'rule at index 0 must be an object',
    })
  })

  it('validates reorder ids and rejects duplicates', () => {
    expect(validateRuleReorderInput({ ids: [' rule-2 ', 'rule-1'] })).toEqual({
      valid: true,
      ids: ['rule-2', 'rule-1'],
    })
    expect(validateRuleReorderInput({ ids: ['rule-1', 'rule-1'] })).toEqual({
      valid: false,
      error: 'rule ids must not contain duplicates',
    })
    expect(validateRuleReorderInput({ ids: ['rule-1', ''] })).toEqual({
      valid: false,
      error: 'every rule id must be a non-empty string',
    })
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

  it('stores canonical payloads for single rule creation', async () => {
    const db = createRulesRouteDb()

    const response = await rulesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'PORT', payload: ' 8000:9000 ' }),
    }, { DB: db })

    expect(response.status).toBe(201)
    expect(db.inserts[0]?.[3]).toBe('8000-9000')
    expect(JSON.parse(String(db.inserts[0]?.[9]))).toEqual(expect.arrayContaining([
      { client: 'mihomo', level: 'convert' },
      { client: 'singbox', level: 'full' },
      { client: 'surge', level: 'convert' },
    ]))
  })

  it('rejects invalid create and update payloads before writing them', async () => {
    vi.clearAllMocks()
    const db = createRulesRouteDb()

    const invalidCreate = await rulesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'IP-CIDR', payload: '999.1.1.1/24' }),
    }, { DB: db })
    expect(invalidCreate.status).toBe(400)
    expect(db.inserts).toHaveLength(0)
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()

    const created = await rulesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'DOMAIN', payload: 'example.com' }),
    }, { DB: db })
    const createdBody = await created.json() as { data: { id: string } }
    const invalidUpdate = await rulesApp.request(`/${createdBody.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'PORT', payload: '9000-8000' }),
    }, { DB: db })

    expect(invalidUpdate.status).toBe(400)
    await expect(invalidUpdate.json()).resolves.toMatchObject({
      error: expect.stringContaining('ascending range'),
    })
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

  it('prevalidates every rule and creates the whole batch with one D1 batch call', async () => {
    vi.clearAllMocks()
    const db = createAtomicRuleCreateMockDb()

    const response = await rulesApp.request('/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rules: [
          { type: 'DOMAIN-SUFFIX', payload: 'one.example', targetGroupId: 'builtin-proxy' },
          { type: 'DOMAIN', payload: 'two.example', targetGroupId: 'builtin-direct' },
          { type: 'PORT', payload: '8000:9000', targetGroupId: 'builtin-proxy' },
        ],
      }),
    }, { DB: db })
    const payload = await response.json() as {
      data: Array<{ type: string; payload: string; order: number; targetGroupId: string }>
    }

    expect(response.status).toBe(201)
    expect(payload.data).toEqual([
      expect.objectContaining({ type: 'DOMAIN-SUFFIX', payload: 'one.example', order: 8, targetGroupId: 'builtin-proxy' }),
      expect.objectContaining({ type: 'DOMAIN', payload: 'two.example', order: 9, targetGroupId: 'builtin-direct' }),
      expect.objectContaining({ type: 'PORT', payload: '8000-9000', order: 10, targetGroupId: 'builtin-proxy' }),
    ])
    expect(db.__batch).toHaveBeenCalledOnce()
    const statements = db.__batch.mock.calls[0]?.[0] as Array<{ __sql: string; __args: unknown[] }>
    expect(statements).toHaveLength(3)
    expect(statements.every(statement => statement.__sql.includes('INSERT INTO rules'))).toBe(true)
  })

  it('does not initialize defaults or write anything when a later batch item is invalid', async () => {
    vi.clearAllMocks()
    const db = createAtomicRuleCreateMockDb()

    const response = await rulesApp.request('/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rules: [
          { type: 'DOMAIN-SUFFIX', payload: 'valid.example' },
          { type: 'DOMAIN-SUFFIX', payload: '' },
        ],
      }),
    }, { DB: db })

    expect(response.status).toBe(400)
    expect(db.__batch).not.toHaveBeenCalled()
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })

  it('updates selected rules in one D1 batch without changing their order', async () => {
    vi.clearAllMocks()
    const db = createRuleBatchMockDb(['rule-1', 'rule-2'])

    const response = await rulesApp.request('/batch-enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['rule-1', 'rule-2'], enabled: false }),
    }, { DB: db })
    const payload = await response.json() as {
      success: boolean
      data: { ids: string[]; enabled: boolean; updatedCount: number }
    }

    expect(response.status).toBe(200)
    expect(payload.data).toEqual({
      ids: ['rule-1', 'rule-2'],
      enabled: false,
      updatedCount: 2,
    })
    expect(db.__batch).toHaveBeenCalledOnce()
    const statements = db.__batch.mock.calls[0]?.[0] as Array<{ __sql: string }>
    expect(statements).toHaveLength(1)
    expect(statements[0]?.__sql).not.toContain('sort_order')
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
  })

  it('rejects a batch when any selected rule no longer exists', async () => {
    vi.clearAllMocks()
    const db = createRuleBatchMockDb(['rule-1'])

    const response = await rulesApp.request('/batch-enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['rule-1', 'missing-rule'], enabled: true }),
    }, { DB: db })

    expect(response.status).toBe(404)
    expect(db.__batch).not.toHaveBeenCalled()
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled()
  })

  it('reorders only when ids are an exact permutation of current rules', async () => {
    const db = createRuleBatchMockDb(['rule-1', 'rule-2'])

    const response = await rulesApp.request('/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['rule-2', 'rule-1'] }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(db.__batch).toHaveBeenCalledOnce()
    const statements = db.__batch.mock.calls[0]?.[0] as Array<{ __args: unknown[] }>
    expect(statements.map(statement => statement.__args)).toEqual([
      [0, expect.any(String), 'rule-2'],
      [1, expect.any(String), 'rule-1'],
    ])
  })

  it('rejects incomplete or stale reorder requests without changing any order', async () => {
    const db = createRuleBatchMockDb(['rule-1', 'rule-2'])

    const response = await rulesApp.request('/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['rule-1', 'missing-rule'] }),
    }, { DB: db })

    expect(response.status).toBe(409)
    expect(db.__batch).not.toHaveBeenCalled()
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

function createRuleBatchMockDb(existingIds: string[]): D1Database & {
  __batch: ReturnType<typeof vi.fn>
} {
  const batch = vi.fn(async () => [])
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => null,
        all: async () => ({
          results: sql.includes('SELECT id FROM rules')
            ? existingIds.filter(id => args.includes(id)).map(id => ({ id }))
            : [],
        }),
        run: async () => ({ success: true }),
        raw: async () => [],
        __sql: sql,
        __args: args,
      }),
      first: async () => null,
      all: async () => ({
        results: sql.includes('SELECT id FROM rules')
          ? existingIds.map(id => ({ id }))
          : [],
      }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch,
    __batch: batch,
  }
  return db as unknown as D1Database & { __batch: ReturnType<typeof vi.fn> }
}

function createAtomicRuleCreateMockDb(): D1Database & {
  __batch: ReturnType<typeof vi.fn>
} {
  const batch = vi.fn(async () => [])
  const enabledRuleTargetIds = ['builtin-proxy', 'builtin-direct', 'builtin-reject']
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => null,
        all: async () => ({
          results: sql.includes('SELECT id, collection_ids FROM groups')
            ? enabledRuleTargetIds.map(id => ({ id, collection_ids: '[]' }))
            : [],
        }),
        run: async () => ({ success: true }),
        raw: async () => [],
        __sql: sql,
        __args: args,
      }),
      first: async () => sql.includes('SELECT MAX(sort_order)') ? { max_order: 7 } : null,
      all: async () => ({
        results: sql.includes('SELECT id, collection_ids FROM groups')
          ? enabledRuleTargetIds.map(id => ({ id, collection_ids: '[]' }))
          : [],
      }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch,
    __batch: batch,
  }
  return db as unknown as D1Database & { __batch: ReturnType<typeof vi.fn> }
}
