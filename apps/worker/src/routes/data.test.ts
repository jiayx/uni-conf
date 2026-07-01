import { beforeEach, describe, expect, it, vi } from 'vitest'
import dataApp, { restoreDefaultData } from './data'
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
