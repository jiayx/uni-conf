import { beforeEach, describe, expect, it, vi } from 'vitest'
import dataApp, { restoreDefaultData } from './data'
import { ensureDefaultExportConfig } from '../services/default-export-config'
import { ensureDefaultRemoteRuleSets } from '../services/default-rule-sets'
import { syncAutoNodeGroups } from '../services/auto-node-groups'

vi.mock('../services/default-export-config', () => ({
  ensureDefaultExportConfig: vi.fn(),
}))

vi.mock('../services/default-rule-sets', () => ({
  ensureDefaultRemoteRuleSets: vi.fn(),
}))

vi.mock('../services/auto-node-groups', () => ({
  syncAutoNodeGroups: vi.fn(),
}))

describe('data reset defaults', () => {
  beforeEach(() => {
    vi.mocked(ensureDefaultExportConfig).mockReset()
    vi.mocked(ensureDefaultRemoteRuleSets).mockReset()
    vi.mocked(syncAutoNodeGroups).mockReset()
  })

  it('restores export config, automatic node groups, and remote rule sets after clearing data', async () => {
    const db = {} as D1Database
    const ts = '2026-01-01T00:00:00.000Z'

    await restoreDefaultData(db, ts)

    expect(ensureDefaultExportConfig).toHaveBeenCalledWith(db, ts)
    expect(syncAutoNodeGroups).toHaveBeenCalledWith(db, ts)
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledWith(db, ts)
  })

  it('restores defaults after importing data', async () => {
    const db = createMockDb()

    const response = await dataApp.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tables: {} }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce()
    expect(syncAutoNodeGroups).toHaveBeenCalledOnce()
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledOnce()
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
