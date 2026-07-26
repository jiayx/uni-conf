import { Hono } from 'hono'
import type { Env } from '../types'
import { now } from '../db/helpers'
import { ensureZeroSetupDefaults } from '../services/zero-setup'

const app = new Hono<{ Bindings: Env }>()

app.post('/', async (c) => {
  await ensureZeroSetupDefaults(c.env.DB, now())
  return c.json({ success: true, data: { initialized: true } })
})

export default app
