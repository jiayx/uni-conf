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
})
