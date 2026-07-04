import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index'
import { refreshDueSources } from './services/source-auto-refresh'
import type { Env } from './types'

vi.mock('./services/source-auto-refresh', () => ({
  refreshDueSources: vi.fn(async () => ({
    checkedCount: 1,
    refreshedCount: 1,
    failedCount: 0,
    skipped: false,
    refreshedSourceIds: ['source-1'],
    errors: [],
  })),
}))

describe('worker entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs due source refreshes from the scheduled handler', async () => {
    const env = { DB: {} as D1Database } as Env

    await worker.scheduled?.({} as ScheduledController, env)

    expect(refreshDueSources).toHaveBeenCalledWith(env.DB)
  })

  it('serves API requests through the fetch handler', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/health'),
      { ENVIRONMENT: 'test' } as Env,
      {} as ExecutionContext
    )

    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { status: 'ok', env: 'test' },
    })
  })

  it('keeps /api/health public even when API_KEY is configured', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/health'),
      { ENVIRONMENT: 'test', API_KEY: 'secret' } as Env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(200)
  })

  it('rejects protected API routes without a bearer token when API_KEY is configured', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/dashboard'),
      { ENVIRONMENT: 'test', API_KEY: 'secret', DB: {} as D1Database } as Env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(401)
  })

  it('allows /api/auth/check with the correct bearer token', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/auth/check', {
        headers: { Authorization: 'Bearer secret' },
      }),
      { ENVIRONMENT: 'test', API_KEY: 'secret' } as Env,
      {} as ExecutionContext
    )

    await expect(response.json()).resolves.toEqual({ success: true, data: { ok: true } })
  })
})
