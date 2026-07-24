import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { apiAuth } from './middleware/auth'
import sourcesRouter from './routes/sources'
import nodesRouter from './routes/nodes'
import collectionsRouter from './routes/collections'
import groupsRouter from './routes/groups'
import rulesRouter from './routes/rules'
import remoteRuleSetsRouter from './routes/remote-rule-sets'
import dashboardRouter from './routes/dashboard'
import settingsRouter from './routes/settings'
import dataRouter from './routes/data'
import { exportRouter } from './routes/export'
import { subscriptionRouter } from './routes/subscription'
import type { Env } from './types'
import { refreshDueSources } from './services/source-auto-refresh'
import { SCHEDULED_PENDING_HEALTH_BATCH_LIMIT, validatePendingRuleSetSources } from './services/remote-rule-set-health'
import { kvRateLimit } from './middleware/rate-limit'

type AppVariables = { requestId: string }
const app = new Hono<{ Bindings: Env; Variables: AppVariables }>()

app.use('*', async (c, next) => {
  const requestId = c.req.header('cf-ray') || crypto.randomUUID()
  const startedAt = Date.now()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  try {
    await next()
  } finally {
    if (c.env.ENVIRONMENT !== 'test') {
      const errorCode = c.res.headers.get('X-UniConf-Error-Code')
      logEvent('http_request', {
        requestId,
        method: c.req.method,
        path: redactLogPath(c.req.path),
        status: c.res.status,
        ...(errorCode ? { errorCode } : {}),
        durationMs: Date.now() - startedAt,
        environment: c.env.ENVIRONMENT,
      })
    }
  }
})

app.use('*', secureHeaders({
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: { geolocation: [], microphone: [], camera: [] },
}))

// CORS - restrict to ALLOWED_ORIGIN when configured; defaults to '*' for local development
app.use('/api/*', (c, next) =>
  cors({
    origin: c.env.ALLOWED_ORIGIN || (c.env.ENVIRONMENT === 'production' ? '' : '*'),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: [
      'Content-Disposition',
      'X-Request-Id',
      'X-UniConf-Error-Code',
      'X-UniConf-Capability-Profile',
    ],
  })(c, next)
)

app.use('/api/*', bodyLimit({
  maxSize: 25 * 1024 * 1024,
  onError: (c) => c.json({ success: false, error: 'Request body exceeds 25 MiB' }, 413),
}))

app.use('/api/*', kvRateLimit({
  namespace: 'admin-auth-failures',
  limit: 20,
  countResponse: (status) => status === 401,
}))
app.use('/sub/*', kvRateLimit({ namespace: 'public-subscriptions', limit: 120 }))

// Health check - stays public for infra probes
app.get('/api/health', (c) => c.json({ success: true, data: { status: 'ok', env: c.env.ENVIRONMENT } }))
app.get('/api/ready', async (c) => {
  const checks = await checkReadiness(c.env)
  const ready = Object.values(checks).every(Boolean)
  return c.json({
    success: ready,
    data: { status: ready ? 'ready' : 'not_ready', env: c.env.ENVIRONMENT, checks },
  }, ready ? 200 : 503)
})

app.use('/api/*', async (c, next) => {
  if (c.env.ENVIRONMENT === 'production' && !c.env.ALLOWED_ORIGIN) {
    return c.json({ success: false, error: 'ALLOWED_ORIGIN is required in production' }, 500)
  }
  return next()
})

// Everything else under /api/* requires the shared bearer token when API_KEY is configured
app.use('/api/*', apiAuth)
app.get('/api/auth/check', (c) => c.json({ success: true, data: { ok: true } }))

// API routes
app.route('/api/sources', sourcesRouter)
app.route('/api/nodes', nodesRouter)
app.route('/api/collections', collectionsRouter)
app.route('/api/groups', groupsRouter)
app.route('/api/rules', rulesRouter)
app.route('/api/remote-rule-sets', remoteRuleSetsRouter)
app.route('/api/export', exportRouter)
app.route('/api/dashboard', dashboardRouter)
app.route('/api/settings', settingsRouter)
app.route('/api/data', dataRouter)

// Public subscription endpoint (no /api prefix)
app.route('/', subscriptionRouter)

// 404 handler
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  logEvent('worker_error', {
    requestId: c.get('requestId'),
    method: c.req.method,
    path: redactLogPath(c.req.path),
    error: err instanceof Error ? err.message : String(err),
  }, 'error')
  const message = c.env.ENVIRONMENT === 'production' ? 'Internal server error' : err.message
  return c.json({ success: false, error: message || 'Internal server error' }, 500)
})

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  async scheduled(_event, env) {
    const startedAt = Date.now()
    const result = await refreshDueSources(env.DB)
    const { errors, ...summary } = result
    logEvent('source_auto_refresh', {
      ...summary,
      failedSourceIds: errors.map((item) => item.sourceId),
      durationMs: Date.now() - startedAt,
      environment: env.ENVIRONMENT,
    }, result.failedCount > 0 ? 'error' : 'log')

    const healthStartedAt = Date.now()
    if (result.skipped) {
      logEvent('remote_rule_set_health_refresh', {
        checkedCount: 0,
        remainingCount: 0,
        skipped: true,
        durationMs: Date.now() - healthStartedAt,
        environment: env.ENVIRONMENT,
      })
      return
    }
    try {
      const health = await validatePendingRuleSetSources(env.DB, SCHEDULED_PENDING_HEALTH_BATCH_LIMIT)
      logEvent('remote_rule_set_health_refresh', {
        checkedCount: health.checkedCount,
        remainingCount: health.remainingCount,
        skipped: false,
        durationMs: Date.now() - healthStartedAt,
        environment: env.ENVIRONMENT,
      })
    } catch (error) {
      logEvent('remote_rule_set_health_refresh', {
        checkedCount: 0,
        remainingCount: 0,
        skipped: false,
        failed: true,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - healthStartedAt,
        environment: env.ENVIRONMENT,
      }, 'error')
    }
  },
} satisfies ExportedHandler<Env>

export function redactLogPath(path: string): string {
  if (!path.startsWith('/sub/')) return path
  const [, prefix, , ...rest] = path.split('/')
  return `/${prefix}/[redacted]${rest.length > 0 ? `/${rest.join('/')}` : ''}`
}

export async function checkReadiness(env: Env): Promise<{
  database: boolean
  kv: boolean
  apiKeyConfigured: boolean
  allowedOriginConfigured: boolean
}> {
  const [database, kv] = await Promise.all([
    checkBinding(async () => Boolean(await env.DB?.prepare('SELECT 1 AS ok').first<{ ok: number }>())),
    checkBinding(async () => {
      await env.KV?.get('__uni_conf_readiness__')
      return Boolean(env.KV)
    }),
  ])
  const production = env.ENVIRONMENT === 'production'
  return {
    database,
    kv,
    apiKeyConfigured: !production || Boolean(env.API_KEY),
    allowedOriginConfigured: !production || Boolean(env.ALLOWED_ORIGIN),
  }
}

async function checkBinding(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check()
  } catch {
    return false
  }
}

export function logEvent(
  event: string,
  fields: Record<string, unknown>,
  level: 'log' | 'error' = 'log'
): void {
  console[level](JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }))
}
