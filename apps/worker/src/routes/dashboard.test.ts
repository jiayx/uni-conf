import { describe, expect, it, vi } from 'vitest'
import dashboardApp from './dashboard'

vi.mock('../export-data', () => ({
  getExportConfigById: vi.fn(async () => ({
    name: 'UniConf', token: 'default-token', format: 'mihomo', enabled: true,
  })),
}))

describe('dashboard rule-set health stats', () => {
  it('returns fresh, stale, pending, and issue counts from operational snapshots', async () => {
    const healthBind = vi.fn(() => ({
      first: async () => ({
        total: 5, valid: 1, warning: 1, invalid: 1, stale: 1, pending: 1,
        last_checked_at: '2026-07-18T03:00:00.000Z',
      }),
    }))
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: sql.includes('remote_rule_set_source_health')
          ? healthBind
          : vi.fn(() => ({
              first: async () => sql.includes('MAX(last_updated)')
                ? { last_refreshed_at: '2026-07-18T02:00:00.000Z' }
                : { count: 2 },
            })),
        first: async () => {
          if (sql.includes('MAX(last_updated)')) return { last_refreshed_at: '2026-07-18T02:00:00.000Z' }
          return { count: 2 }
        },
      })),
    } as unknown as D1Database

    const response = await dashboardApp.request('/stats', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(healthBind).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String), expect.any(String), 'default'
    )
    expect(db.prepare).toHaveBeenCalledWith(expect.stringMatching(/FROM sources WHERE workspace_id = \? AND type <> 'manual'/))
    expect(db.prepare).toHaveBeenCalledWith(expect.stringMatching(/FROM sources WHERE workspace_id = \? AND type = 'url' AND last_refresh_error/))
    expect(db.prepare).toHaveBeenCalledWith(expect.stringMatching(/FROM sources WHERE workspace_id = \? AND type = 'url'/))
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        sourceRefreshFailureCount: 2,
        defaultExportName: 'UniConf',
        ruleSetHealth: {
          total: 5, valid: 1, warning: 1, invalid: 1, stale: 1, pending: 1,
          lastCheckedAt: '2026-07-18T03:00:00.000Z',
        },
      },
    })
  })
})
