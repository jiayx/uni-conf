import { describe, expect, it, vi } from 'vitest'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import { exportRouter } from './export'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => undefined),
}))

describe('export token reset route', () => {
  it('keeps the default export token pointing at a reset default config', async () => {
    const state = createState({ defaultExportToken: 'old-token' })
    const db = createMockDb(state)

    const response = await exportRouter.request('/configs/export-1/reset-token', { method: 'POST' }, { DB: db })
    const payload = await response.json<{ data: { token: string } }>()

    expect(response.status).toBe(200)
    expect(payload.data.token).not.toBe('old-token')
    expect(state.exportToken).toBe(payload.data.token)
    expect(state.defaultExportToken).toBe(payload.data.token)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default')
  })

  it('does not move the default export token when another config is reset', async () => {
    const state = createState({ defaultExportToken: 'default-token' })
    const db = createMockDb(state)

    const response = await exportRouter.request('/configs/export-1/reset-token', { method: 'POST' }, { DB: db })
    const payload = await response.json<{ data: { token: string } }>()

    expect(response.status).toBe(200)
    expect(payload.data.token).not.toBe('old-token')
    expect(state.exportToken).toBe(payload.data.token)
    expect(state.defaultExportToken).toBe('default-token')
  })
})

function createState(patch: Partial<TestState> = {}): TestState {
  return {
    exportToken: 'old-token',
    defaultExportToken: 'old-token',
    ...patch,
  }
}

interface TestState {
  exportToken: string
  defaultExportToken: string
}

function createMockDb(state: TestState): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => first(sql, state),
        run: async () => {
          run(sql, args, state)
          return { success: true }
        },
        all: async () => ({ results: [] }),
        raw: async () => [],
      }),
      first: async () => first(sql, state),
      run: async () => ({ success: true }),
      all: async () => ({ results: [] }),
      raw: async () => [],
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database
}

function first(sql: string, state: TestState): Record<string, unknown> | null {
  if (sql.includes('SELECT id, token FROM export_configs WHERE id = ?')) {
    return { id: 'export-1', token: state.exportToken }
  }
  if (sql.includes('SELECT * FROM export_configs WHERE id = ?')) {
    return {
      id: 'export-1',
      name: 'Export',
      format: 'mihomo',
      token: state.exportToken,
      enabled: 1,
      include_collection_ids: '[]',
      include_group_ids: '[]',
      include_rule_ids: '[]',
      include_remote_set_ids: '[]',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
  }
  return null
}

function run(sql: string, args: unknown[], state: TestState): void {
  if (sql.includes('UPDATE export_configs SET token = ?')) {
    state.exportToken = String(args[0])
  }
  if (sql.includes('UPDATE app_settings SET default_export_token')) {
    const previousToken = String(args[3])
    if (state.defaultExportToken === previousToken) {
      state.defaultExportToken = String(args[0])
    }
  }
}
