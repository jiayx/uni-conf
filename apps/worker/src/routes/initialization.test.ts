import { beforeEach, describe, expect, it, vi } from 'vitest'
import initializationApp from './initialization'
import { ensureWorkspaceInitialized } from '../services/zero-setup'

vi.mock('../services/zero-setup', () => ({
  ensureWorkspaceInitialized: vi.fn(async () => undefined),
}))

describe('application initialization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('initializes zero-setup state through one explicit command', async () => {
    const db = {} as D1Database
    const kv = {} as KVNamespace
    const response = await initializationApp.request('/', { method: 'POST' }, { DB: db, KV: kv })

    expect(response.status).toBe(200)
    expect(ensureWorkspaceInitialized).toHaveBeenCalledWith(db, kv, expect.any(String), 'default')
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { initialized: true },
    })
  })
})
