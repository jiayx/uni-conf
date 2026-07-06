import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Guards /api/* with a shared bearer token when API_KEY is configured.
 * Leaving API_KEY unset keeps the API open only outside production.
 */
export const apiAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const apiKey = c.env.API_KEY;
  if (!apiKey && c.env.ENVIRONMENT === 'production') {
    return c.json({ success: false, error: 'API_KEY is required in production' }, 500);
  }
  if (!apiKey) return next();

  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token || !timingSafeEqual(token, apiKey)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  return next();
};
