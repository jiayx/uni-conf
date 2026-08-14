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
import ruleSetCatalogsRouter from './routes/rule-set-catalogs'
import dashboardRouter from './routes/dashboard'
import settingsRouter from './routes/settings'
import dataRouter from './routes/data'
import initializationRouter from './routes/initialization'
import workspacesRouter from './routes/workspaces'
import { exportRouter } from './routes/export'
import { subscriptionRouter } from './routes/subscription'
import type { Env } from './types'
import { refreshDueSources } from './services/source-auto-refresh'
import { kvRateLimit } from './middleware/rate-limit'
import { refreshRuleSetCatalogSnapshotIfDue } from './services/rule-set-catalogs'
import { ensureDefaultRemoteRuleSets } from './services/default-rule-sets'
import { getAppSettings } from './services/app-settings'
import { refreshManagedDnsResourcesIfDue } from './services/managed-dns-resources'

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

app.use(
  '*',
  secureHeaders({
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: { geolocation: [], microphone: [], camera: [] },
  }),
)

// CORS - stay on the request origin in production; local development may use a separate frontend origin
app.use('/api/*', (c, next) =>
  cors({
    origin: c.env.ENVIRONMENT === 'production' ? new URL(c.req.url).origin : '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id'],
    exposeHeaders: ['Content-Disposition', 'X-Request-Id', 'X-UniConf-Error-Code', 'X-UniConf-Capability-Profile'],
  })(c, next),
)

app.use(
  '/api/*',
  bodyLimit({
    maxSize: 25 * 1024 * 1024,
    onError: (c) => c.json({ success: false, error: 'Request body exceeds 25 MiB' }, 413),
  }),
)

app.use(
  '/api/*',
  kvRateLimit({
    namespace: 'admin-auth-failures',
    limit: 20,
    countResponse: (status) => status === 401,
  }),
)
app.use('/sub/*', kvRateLimit({ namespace: 'public-subscriptions', limit: 120 }))

// Health check - stays public for infra probes
app.get('/api/health', (c) => c.json({ success: true, data: { status: 'ok', env: c.env.ENVIRONMENT } }))
app.get('/api/ready', async (c) => {
  const checks = await checkReadiness(c.env)
  const ready = Object.values(checks).every(Boolean)
  return c.json(
    {
      success: ready,
      data: { status: ready ? 'ready' : 'not_ready', env: c.env.ENVIRONMENT, checks },
    },
    ready ? 200 : 503,
  )
})

// Everything else under /api/* requires the shared bearer token when API_KEY is configured
app.use('/api/*', apiAuth)
app.get('/api/auth/check', (c) => c.json({ success: true, data: { ok: true } }))
app.route('/api/workspaces', workspacesRouter)

// API routes
app.route('/api/sources', sourcesRouter)
app.route('/api/nodes', nodesRouter)
app.route('/api/collections', collectionsRouter)
app.route('/api/groups', groupsRouter)
app.route('/api/rules', rulesRouter)
app.route('/api/remote-rule-sets', remoteRuleSetsRouter)
app.route('/api/rule-set-catalogs', ruleSetCatalogsRouter)
app.route('/api/export', exportRouter)
app.route('/api/dashboard', dashboardRouter)
app.route('/api/settings', settingsRouter)
app.route('/api/data', dataRouter)
app.route('/api/initialize', initializationRouter)

// Public subscription endpoint (no /api prefix)
app.route('/', subscriptionRouter)

// 404 handler
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  logEvent(
    'worker_error',
    {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: redactLogPath(c.req.path),
      error: err instanceof Error ? err.message : String(err),
    },
    'error',
  )
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
    const catalogResult = await refreshCatalogsForSchedule(env)
    const dnsResourceResult = await refreshManagedDnsResourcesForSchedule(env)
    const { errors, ...summary } = result
    logEvent(
      'source_auto_refresh',
      {
        ...summary,
        failedSourceIds: errors.map((item) => item.sourceId),
        durationMs: Date.now() - startedAt,
        environment: env.ENVIRONMENT,
      },
      result.failedCount > 0 ? 'error' : 'log',
    )
    if (catalogResult) {
      logEvent(
        'rule_set_catalog_refresh',
        {
          ...catalogResult,
          environment: env.ENVIRONMENT,
        },
        catalogResult.error ? 'error' : 'log',
      )
    }
    if (!dnsResourceResult.skipped) {
      logEvent(
        'managed_dns_resource_refresh',
        {
          ...dnsResourceResult,
          environment: env.ENVIRONMENT,
        },
        dnsResourceResult.error ? 'error' : 'log',
      )
    }
  },
} satisfies ExportedHandler<Env>

export function redactLogPath(path: string): string {
  if (!path.startsWith('/sub/')) return path
  const [, prefix, , ...rest] = path.split('/')
  return `/${prefix}/[redacted]${rest.length > 0 ? `/${rest.join('/')}` : ''}`
}

async function refreshCatalogsForSchedule(env: Env): Promise<{
  catalogCount?: number
  ruleSetCount?: number
  error?: string
} | null> {
  try {
    const snapshot = await refreshRuleSetCatalogSnapshotIfDue(env)
    if (!snapshot) return null
    const timestamp = new Date().toISOString()
    const { results: workspaces } = await env.DB.prepare('SELECT id FROM workspaces').all<{ id: string }>()
    for (const workspace of workspaces) {
      const settings = await getAppSettings(env.DB, workspace.id)
      await ensureDefaultRemoteRuleSets(
        env.DB,
        timestamp,
        settings.unmatchedTrafficPolicy,
        snapshot,
        workspace.id,
      )
    }
    return {
      catalogCount: snapshot.catalogs.length,
      ruleSetCount: snapshot.catalogs.reduce((sum, catalog) => sum + catalog.items.length, 0),
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function refreshManagedDnsResourcesForSchedule(env: Env): Promise<{
  domainCount?: number
  error?: string
  skipped?: boolean
}> {
  try {
    const domainCount = await refreshManagedDnsResourcesIfDue(env.KV)
    return domainCount === null ? { skipped: true } : { domainCount }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function checkReadiness(env: Env): Promise<{
  database: boolean
  kv: boolean
  apiKeyConfigured: boolean
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
  }
}

async function checkBinding(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check()
  } catch {
    return false
  }
}

export function logEvent(event: string, fields: Record<string, unknown>, level: 'log' | 'error' = 'log'): void {
  console[level](JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }))
}
