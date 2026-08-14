import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { redactLogPath } from './index'
import { refreshRuleSetCatalogSnapshotIfDue } from './services/rule-set-catalogs'
import { refreshDueSources } from './services/source-auto-refresh'
import { refreshManagedDnsResourcesIfDue } from './services/managed-dns-resources'
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

vi.mock('./services/rule-set-catalogs', () => ({
  refreshRuleSetCatalogSnapshotIfDue: vi.fn(async () => null),
}))

vi.mock('./services/managed-dns-resources', () => ({
  refreshManagedDnsResourcesIfDue: vi.fn(async () => 128),
}))

describe('worker entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs due source and rule catalog refreshes from the scheduled handler', async () => {
    const env = { DB: {} as D1Database, KV: {} as KVNamespace } as Env

    await worker.scheduled?.({} as ScheduledController, env)

    expect(refreshDueSources).toHaveBeenCalledWith(env.DB)
    expect(refreshRuleSetCatalogSnapshotIfDue).toHaveBeenCalledWith(env)
    expect(refreshManagedDnsResourcesIfDue).toHaveBeenCalledWith(env.KV)
  })

  it('redacts subscription tokens from structured request logs', () => {
    expect(redactLogPath('/sub/secret-token/mihomo.yaml')).toBe('/sub/[redacted]/mihomo.yaml')
    expect(redactLogPath('/api/sources')).toBe('/api/sources')
  })

  it('logs stable public error codes without exposing subscription tokens', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/sub/secret-token/unknown.conf'),
      { ENVIRONMENT: 'development' } as Env,
      {} as ExecutionContext,
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('X-UniConf-Error-Code')).toBe('subscription_format_invalid')
    const event = JSON.parse(String(consoleSpy.mock.calls.at(-1)?.[0])) as Record<string, unknown>
    expect(event).toMatchObject({
      event: 'http_request',
      path: '/sub/[redacted]/unknown.conf',
      status: 400,
      errorCode: 'subscription_format_invalid',
    })
    expect(JSON.stringify(event)).not.toContain('secret-token')
  })

  it('serves API requests through the fetch handler', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/health'),
      { ENVIRONMENT: 'test' } as Env,
      {} as ExecutionContext,
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
      {} as ExecutionContext,
    )

    expect(response.status).toBe(200)
  })

  it('reports ready when bindings and the production API key are available', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/ready'),
      createReadyEnv({
        ENVIRONMENT: 'production',
        API_KEY: 'secret',
      }),
      {} as ExecutionContext,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        status: 'ready',
        env: 'production',
        checks: {
          database: true,
          kv: true,
          apiKeyConfigured: true,
        },
      },
    })
  })

  it('returns 503 readiness details without exposing secret values', async () => {
    const env = createReadyEnv({ ENVIRONMENT: 'production' })
    env.DB = {
      prepare: vi.fn(() => ({
        first: vi.fn(async () => {
          throw new Error('D1 unavailable')
        }),
      })),
    } as unknown as D1Database
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/ready'),
      env,
      {} as ExecutionContext,
    )

    expect(response.status).toBe(503)
    const payload = (await response.json()) as { data: { checks: Record<string, boolean> } }
    expect(payload.data.checks).toEqual({
      database: false,
      kv: true,
      apiKeyConfigured: false,
    })
    expect(JSON.stringify(payload)).not.toContain('D1 unavailable')
  })

  it('rejects protected API routes without a bearer token when API_KEY is configured', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/dashboard'),
      { ENVIRONMENT: 'test', API_KEY: 'secret', DB: {} as D1Database } as Env,
      {} as ExecutionContext,
    )

    expect(response.status).toBe(401)
  })

  it('allows /api/auth/check with the correct bearer token', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/auth/check', {
        headers: { Authorization: 'Bearer secret' },
      }),
      { ENVIRONMENT: 'test', API_KEY: 'secret' } as Env,
      {} as ExecutionContext,
    )

    await expect(response.json()).resolves.toEqual({ success: true, data: { ok: true } })
  })

  it('defaults production CORS to the request origin', async () => {
    const sameOriginResponse = await worker.fetch(
      new Request('https://uni-conf.example.com/api/auth/check', {
        headers: {
          Authorization: 'Bearer secret',
          Origin: 'https://uni-conf.example.com',
        },
      }),
      { ENVIRONMENT: 'production', API_KEY: 'secret' } as Env,
      {} as ExecutionContext,
    )
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/auth/check', {
        headers: {
          Authorization: 'Bearer secret',
          Origin: 'https://other.example.com',
        },
      }),
      { ENVIRONMENT: 'production', API_KEY: 'secret' } as Env,
      {} as ExecutionContext,
    )

    expect(sameOriginResponse.headers.get('Access-Control-Allow-Origin')).toBe('https://uni-conf.example.com')
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    await expect(response.json()).resolves.toEqual({ success: true, data: { ok: true } })
  })

  it('rejects oversized API request bodies', async () => {
    const response = await worker.fetch(
      new Request('https://uni-conf.example.com/api/auth/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(26 * 1024 * 1024) },
        body: '{}',
      }),
      { ENVIRONMENT: 'test' } as Env,
      {} as ExecutionContext,
    )

    expect(response.status).toBe(413)
  })
})

function createReadyEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {
      prepare: vi.fn(() => ({ first: vi.fn(async () => ({ ok: 1 })) })),
    } as unknown as D1Database,
    KV: { get: vi.fn(async () => null) } as unknown as KVNamespace,
    ...overrides,
  }
}
