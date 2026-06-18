import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { sourcesRouter } from './routes/sources'
import { nodesRouter } from './routes/nodes'
import { collectionsRouter } from './routes/collections'
import { groupsRouter } from './routes/groups'
import { rulesRouter } from './routes/rules'
import { templatesRouter } from './routes/templates'
import { exportRouter } from './routes/export'
import { subscriptionRouter } from './routes/subscription'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

// CORS - allow all origins for API (frontend is same domain in prod)
app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }))

// Health check
app.get('/api/health', (c) => c.json({ success: true, data: { status: 'ok', env: c.env.ENVIRONMENT } }))

// API routes
app.route('/api/sources', sourcesRouter)
app.route('/api/nodes', nodesRouter)
app.route('/api/collections', collectionsRouter)
app.route('/api/groups', groupsRouter)
app.route('/api/rules', rulesRouter)
app.route('/api/templates', templatesRouter)
app.route('/api/export', exportRouter)

// Public subscription endpoint (no /api prefix)
app.route('/', subscriptionRouter)

// 404 handler
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  console.error('Worker error:', err)
  return c.json({ success: false, error: err.message ?? 'Internal server error' }, 500)
})

export default app
