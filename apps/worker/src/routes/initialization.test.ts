import { beforeEach, describe, expect, it, vi } from 'vitest'
import dashboardApp from './dashboard'
import settingsApp from './settings'
import { ensureDefaultExportConfig } from '../services/default-export-config'
import { ensureDefaultRemoteRuleSets } from '../services/default-rule-sets'
import { syncAutoNodeGroups } from '../services/auto-node-groups'
import { getAppSettings } from '../services/app-settings'

vi.mock('../services/default-export-config', () => ({
  ensureDefaultExportConfig: vi.fn(async () => ({
    token: 'default-token',
    format: 'mihomo',
  })),
}))

vi.mock('../services/default-rule-sets', () => ({
  ensureDefaultRemoteRuleSets: vi.fn(async () => undefined),
}))

vi.mock('../services/auto-node-groups', () => ({
  syncAutoNodeGroups: vi.fn(async () => undefined),
}))

vi.mock('../services/app-settings', () => ({
  getAppSettings: vi.fn(async () => ({
    language: 'zh-CN',
    theme: 'light',
    routingPolicyTemplate: 'common',
    dnsMode: 'smart',
    exportNodeNamingMode: 'source_region_sequence',
    showCompatibilityWarnings: true,
    enableAutoRefresh: true,
    autoRefreshInterval: 1440,
    autoNodeGroupsEnabled: true,
    autoNodeGroupTypes: ['url-test'],
    autoNodeGroupIncludeFlag: true,
  })),
}))

describe('zero-setup route initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('syncs automatic node groups before returning dashboard stats', async () => {
    const db = createStatsDb()

    const response = await dashboardApp.request('/stats', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce()
    expect(syncAutoNodeGroups).toHaveBeenCalledOnce()
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledOnce()
  })

  it('syncs automatic node groups before returning settings', async () => {
    const db = createStatsDb()

    const response = await settingsApp.request('/', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce()
    expect(syncAutoNodeGroups).toHaveBeenCalledOnce()
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledOnce()
    expect(getAppSettings).toHaveBeenCalledOnce()
  })

  it('syncs automatic node groups and default rule sets after updating settings', async () => {
    const db = createStatsDb()

    const response = await settingsApp.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ routingPolicyTemplate: 'empty', dnsMode: 'smart' }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(syncAutoNodeGroups).toHaveBeenCalledOnce()
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledOnce()
    expect(getAppSettings).toHaveBeenCalledTimes(2)
  })
})

function createStatsDb(): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: async () => ({ count: 0, last_refreshed_at: null }),
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
        raw: async () => [],
      })),
      first: async () => ({ count: 0, last_refreshed_at: null }),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database
}
