import { Hono } from 'hono'
import type { Env } from '../types'
import {
  getRuleSetCatalogSnapshot,
  refreshRuleSetCatalogSnapshotIfDue,
} from '../services/rule-set-catalogs'

const app = new Hono<{ Bindings: Env }>()

app.get('/quixotic', async (c) => {
  try {
    const current = await getRuleSetCatalogSnapshot(c.env.KV)
    const refreshed = await refreshRuleSetCatalogSnapshotIfDue(c.env).catch(() => null)
    const snapshot = refreshed ?? current
    const catalog = snapshot.catalogs.find(item => item.id === 'quixotic')
    if (!catalog) throw new Error('Quixotic catalog is unavailable')
    return c.json({ success: true, data: catalog })
  } catch (error) {
    return c.json({
      success: false,
      code: 'catalog_refresh_failed',
      error: error instanceof Error ? error.message : 'Rule catalog refresh failed',
    }, 422)
  }
})

export default app
