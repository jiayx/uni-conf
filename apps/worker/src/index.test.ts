import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { redactLogPath } from './index'
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

  it('redacts subscription tokens from structured request logs', () => {
    expect(redactLogPath('/sub/secret-token/mihomo.yaml')).toBe('/sub/[redacted]/mihomo.yaml')
    expect(redactLogPath('/api/sources')).toBe('/api/sources')
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
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(response.headers.get('X-Request-Id')).toMatch(/\S+/)
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

  it('fails closed when production CORS configuration is missing', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/auth/check', {
        headers: { Authorization: 'Bearer secret' },
      }),
      { ENVIRONMENT: 'production', API_KEY: 'secret' } as Env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'ALLOWED_ORIGIN is required in production',
    })
  })

  it('rejects oversized API request bodies', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/auth/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(26 * 1024 * 1024) },
        body: '{}',
      }),
      { ENVIRONMENT: 'test' } as Env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(413)
  })
})
