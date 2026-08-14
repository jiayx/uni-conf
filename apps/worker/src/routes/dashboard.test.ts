import { describe, expect, it, vi } from 'vitest'
import dashboardApp from './dashboard'

vi.mock('../export-data', () => ({
  getExportConfigById: vi.fn(async () => ({
    name: 'UniConf', token: 'default-token', format: 'mihomo', enabled: true,
  })),
}))
describe('dashboard stats', () => {
  it('returns core counts and export details', async () => {
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: async () => sql.includes('MAX(last_updated)')
            ? { last_refreshed_at: '2026-07-18T02:00:00.000Z' }
            : { count: 2 },
        })),
        first: async () => ({ count: 2 }),
      })),
    } as unknown as D1Database

    const response = await dashboardApp.request('/stats', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("FROM sources WHERE workspace_id = ? AND type <> 'manual'"))
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("FROM sources WHERE workspace_id = ? AND type = 'url' AND last_refresh_error"))
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        sourceCount: 2,
        sourceRefreshFailureCount: 2,
        defaultExportName: 'UniConf',
        lastRefreshedAt: '2026-07-18T02:00:00.000Z',
      },
    })
  })
})
