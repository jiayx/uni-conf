import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { kvRateLimit } from './rate-limit'
import type { Env } from '../types'

describe('KV rate limiting', () => {
  it('blocks a client after the configured distributed count', async () => {
    const kv = {
      get: vi.fn(async () => '2'),
      put: vi.fn(async () => undefined),
    } as unknown as KVNamespace
    const app = new Hono<{ Bindings: Env }>()
    app.use('*', kvRateLimit({ namespace: 'test', limit: 2 }))
    app.get('/', (c) => c.text('ok'))

    const response = await app.request('/', { headers: { 'CF-Connecting-IP': '192.0.2.1' } }, { KV: kv } as Env)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
  })

  it('only counts responses selected by the caller', async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    } as unknown as KVNamespace
    const app = new Hono<{ Bindings: Env }>()
    app.use('*', kvRateLimit({ namespace: 'auth', limit: 2, countResponse: (status) => status === 401 }))
    app.get('/ok', (c) => c.text('ok'))
    app.get('/bad', (c) => c.text('bad', 401))

    await app.request('/ok', {}, { KV: kv } as Env)
    expect(kv.put).not.toHaveBeenCalled()
    await app.request('/bad', {}, { KV: kv } as Env)
    expect(kv.put).toHaveBeenCalledOnce()
  })
})
