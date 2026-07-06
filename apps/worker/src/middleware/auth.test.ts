import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { apiAuth } from './auth'
import type { Env } from '../types'

function buildApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.use('/api/*', apiAuth)
  app.get('/api/ping', (c) => c.json({ success: true, data: 'pong' }))
  return app
}

describe('apiAuth middleware', () => {
  it('allows requests through when API_KEY is not configured', async () => {
    const app = buildApp()
    const res = await app.request('/api/ping', {}, { ENVIRONMENT: 'test' } as Env)
    expect(res.status).toBe(200)
  })

  it('fails closed in production when API_KEY is not configured', async () => {
    const app = buildApp()
    const res = await app.request('/api/ping', {}, { ENVIRONMENT: 'production' } as Env)
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: 'API_KEY is required in production',
    })
  })

  it('rejects requests without a bearer token when API_KEY is configured', async () => {
    const app = buildApp()
    const res = await app.request('/api/ping', {}, { ENVIRONMENT: 'test', API_KEY: 'secret' } as Env)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })
  })

  it('rejects requests with the wrong bearer token', async () => {
    const app = buildApp()
    const res = await app.request(
      '/api/ping',
      { headers: { Authorization: 'Bearer wrong' } },
      { ENVIRONMENT: 'test', API_KEY: 'secret' } as Env
    )
    expect(res.status).toBe(401)
  })

  it('allows requests with the correct bearer token', async () => {
    const app = buildApp()
    const res = await app.request(
      '/api/ping',
      { headers: { Authorization: 'Bearer secret' } },
      { ENVIRONMENT: 'test', API_KEY: 'secret' } as Env
    )
    expect(res.status).toBe(200)
  })
})
