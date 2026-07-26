import { beforeEach, describe, expect, it, vi } from 'vitest'
import initializationApp from './initialization'
import { ensureZeroSetupDefaults } from '../services/zero-setup'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => ({ id: 'default-mihomo' })),
}))

describe('application initialization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('initializes zero-setup state through one explicit command', async () => {
    const db = {} as D1Database
    const response = await initializationApp.request('/', { method: 'POST' }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String))
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { initialized: true },
    })
  })
})
