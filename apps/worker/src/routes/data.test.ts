import { beforeEach, describe, expect, it, vi } from 'vitest'
import dataApp, { restoreDefaultData, validateBackupPayload } from './data'
import { ensureZeroSetupDefaults } from '../services/zero-setup'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(),
}))

describe('data reset defaults', () => {
  beforeEach(() => {
    vi.mocked(ensureZeroSetupDefaults).mockReset()
  })

  it('restores zero-setup defaults after clearing data', async () => {
    const db = {} as D1Database
    const ts = '2026-01-01T00:00:00.000Z'

    await restoreDefaultData(db, ts)

    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, ts)
  })

  it('restores defaults before exporting data', async () => {
    const db = createMockDb()

    const response = await dataApp.request('/export', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('restores defaults after importing data', async () => {
    const db = createMockDb()

    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tables: {} }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('rejects unknown tables and SQL identifier-like columns before touching the database', async () => {
    expect(validateBackupPayload({ tables: { unexpected: [] } })).toEqual({
      valid: false,
      error: 'unknown backup table: unexpected',
    })
    expect(validateBackupPayload({ tables: { sources: [{ "id) VALUES ('x'); --": 'bad' }] } })).toEqual({
      valid: false,
      error: "unknown column sources.id) VALUES ('x'); --",
    })
  })

  it('rejects dangling references before destructive restore', async () => {
    const db = createMockDb()
    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, tables: { nodes: [{ id: 'n1', source_id: 'missing' }] } }),
    }, { DB: db })

    expect(response.status).toBe(400)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('supports non-destructive backup validation with a row summary', async () => {
    const db = createMockDb()
    const response = await dataApp.request('/import/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 2, tables: { sources: [{ id: 's1' }] } }),
    }, { DB: db })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { version: 2, totalRows: 1, containsSensitiveData: true, tables: { sources: 1 } },
    })
    expect(db.batch).not.toHaveBeenCalled()
  })
})

function createMockDb(): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: async () => ({ success: true }),
        first: async () => null,
        all: async () => ({ results: [] }),
        raw: async () => [],
      })),
      run: async () => ({ success: true }),
      first: async () => null,
      all: async () => ({ results: [] }),
      raw: async () => [],
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database
}
