import type { MiddlewareHandler } from 'hono'
import type { Env } from '../types'

type RateLimitOptions = {
  namespace: string
  limit: number
  countResponse?: (status: number) => boolean
}

/**
 * Best-effort distributed fixed-window limiting backed by KV. Cloudflare controls
 * CF-Connecting-IP in production; local/test environments without KV skip it.
 */
export function kvRateLimit(options: RateLimitOptions): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (!c.env.KV) return next()

    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
    const window = Math.floor(Date.now() / 60_000)
    const key = `rate:${options.namespace}:${window}:${ip}`
    let current: number
    try {
      current = Number(await c.env.KV.get(key)) || 0
    } catch {
      return next()
    }
    if (current >= options.limit) {
      c.header('Retry-After', '60')
      return c.json({ success: false, error: 'Too many requests' }, 429)
    }

    await next()
    if (!options.countResponse || options.countResponse(c.res.status)) {
      try {
        await c.env.KV.put(key, String(current + 1), { expirationTtl: 120 })
      } catch {
        // Rate limiting is protective, but a KV outage must not replace a valid response.
      }
    }
  }
}
