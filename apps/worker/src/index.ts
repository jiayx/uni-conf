import { Hono } from 'hono'
import { cors } from 'hono/cors'
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

const app = new Hono<{ Bindings: Env }>()

// CORS - restrict to ALLOWED_ORIGIN when configured; defaults to '*' for local development
app.use('/api/*', (c, next) =>
  cors({ origin: c.env.ALLOWED_ORIGIN || '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] })(c, next)
)

// Health check - stays public for infra probes
app.get('/api/health', (c) => c.json({ success: true, data: { status: 'ok', env: c.env.ENVIRONMENT } }))

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
  console.error('Worker error:', err)
  return c.json({ success: false, error: err.message ?? 'Internal server error' }, 500)
})

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  async scheduled(_event, env) {
    const result = await refreshDueSources(env.DB)
    if (!result.skipped && (result.refreshedCount > 0 || result.failedCount > 0)) {
      console.log('Auto refresh completed', result)
    }
  },
} satisfies ExportedHandler<Env>
