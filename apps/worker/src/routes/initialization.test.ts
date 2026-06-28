import { beforeEach, describe, expect, it, vi } from 'vitest'
import dashboardApp from './dashboard'
import collectionsApp from './collections'
import { exportRouter } from './export'
import groupsApp from './groups'
import nodesApp from './nodes'
import remoteRuleSetsApp from './remote-rule-sets'
import rulesApp from './rules'
import settingsApp from './settings'
import sourcesApp from './sources'
import { ensureZeroSetupDefaults } from '../services/zero-setup'
import { getAppSettings } from '../services/app-settings'

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => ({
    token: 'default-token',
    format: 'mihomo',
  })),
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

  it('ensures zero-setup defaults before returning dashboard stats', async () => {
    const db = createStatsDb()

    const response = await dashboardApp.request('/stats', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults before returning settings', async () => {
    const db = createStatsDb()

    const response = await settingsApp.request('/', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
    expect(getAppSettings).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults before returning groups', async () => {
    const db = createStatsDb()

    const response = await groupsApp.request('/', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults before returning source, node, and node group lists', async () => {
    const cases = [
      () => sourcesApp.request('/', {}, { DB: createStatsDb() }),
      () => nodesApp.request('/', {}, { DB: createStatsDb() }),
      () => collectionsApp.request('/', {}, { DB: createStatsDb() }),
    ]

    for (const request of cases) {
      vi.clearAllMocks()
      const response = await request()
      expect(response.status).toBe(200)
      expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
    }
  })

  it('ensures zero-setup defaults before returning advanced detail resources', async () => {
    const cases = [
      () => sourcesApp.request('/item-1', {}, { DB: createStatsDb() }),
      () => nodesApp.request('/item-1', {}, { DB: createStatsDb() }),
      () => collectionsApp.request('/item-1', {}, { DB: createStatsDb() }),
      () => groupsApp.request('/item-1', {}, { DB: createStatsDb() }),
      () => rulesApp.request('/item-1', {}, { DB: createStatsDb() }),
      () => remoteRuleSetsApp.request('/item-1', {}, { DB: createStatsDb() }),
    ]

    for (const request of cases) {
      vi.clearAllMocks()
      const response = await request()
      expect(response.status).toBe(200)
      expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
    }
  })

  it('ensures zero-setup defaults before returning export configs', async () => {
    const db = createStatsDb()

    const response = await exportRouter.request('/configs', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults before returning a single export config', async () => {
    const db = createStatsDb()

    const response = await exportRouter.request('/configs/export-1', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults after creating an export config', async () => {
    const db = createStatsDb()

    const response = await exportRouter.request('/configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'singbox' }),
    }, { DB: db })

    expect(response.status).toBe(201)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults after updating an export config', async () => {
    const db = createStatsDb()

    const response = await exportRouter.request('/configs/export-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Export' }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults after deleting an export config', async () => {
    const db = createStatsDb()

    const response = await exportRouter.request('/configs/export-1', { method: 'DELETE' }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults after resetting an export token', async () => {
    const db = createStatsDb()

    const response = await exportRouter.request('/configs/export-1/reset-token', { method: 'POST' }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults before returning remote rule sets', async () => {
    const db = createStatsDb()

    const response = await remoteRuleSetsApp.request('/', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults before returning manual rules', async () => {
    const db = createStatsDb()

    const response = await rulesApp.request('/', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })

  it('ensures zero-setup defaults after deleting custom rules and remote rule sets', async () => {
    for (const request of [
      () => rulesApp.request('/item-1', { method: 'DELETE' }, { DB: createStatsDb() }),
      () => remoteRuleSetsApp.request('/item-1', { method: 'DELETE' }, { DB: createStatsDb() }),
    ]) {
      vi.clearAllMocks()
      const response = await request()
      expect(response.status).toBe(200)
      expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
    }
  })

  it('ensures zero-setup defaults after updating settings', async () => {
    const db = createStatsDb()

    const response = await settingsApp.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ routingPolicyTemplate: 'empty', dnsMode: 'smart' }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
    expect(getAppSettings).toHaveBeenCalledTimes(2)
  })

  it('persists the scenario template and its recommended DNS mode together', async () => {
    const db = createStatsDb()

    const response = await settingsApp.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ routingPolicyTemplate: 'router', dnsMode: 'compatible' }),
    }, { DB: db })

    expect(response.status).toBe(200)
    expect(db.operations).toContainEqual(expect.objectContaining({
      operation: 'update-settings',
      routingPolicyTemplate: 'router',
      dnsMode: 'compatible',
    }))
    expect(ensureZeroSetupDefaults).toHaveBeenCalledOnce()
  })
})

function createStatsDb(): D1Database & { operations: Array<Record<string, unknown>> } {
  const exportRow = {
    id: 'export-1',
    name: 'Default',
    format: 'mihomo',
    token: 'token',
    enabled: 1,
    include_collection_ids: '[]',
    include_group_ids: '[]',
    include_rule_ids: '[]',
    include_remote_set_ids: '[]',
    extra_config: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    count: 0,
    last_refreshed_at: null,
  }
  const operations: Array<Record<string, unknown>> = []

  return {
    operations,
    prepare: vi.fn(() => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: async () => exportRow,
        all: async () => ({ results: [] }),
        run: async () => {
          if (args.length > 0) {
            operations.push({
              operation: 'update-settings',
              language: args[0],
              theme: args[1],
              routingPolicyTemplate: args[2],
              dnsMode: args[4],
            })
          }
          return { success: true }
        },
        raw: async () => [],
      })),
      first: async () => exportRow,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database & { operations: Array<Record<string, unknown>> }
}
