import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExportData } from '../export-data'
import { exportRouter } from './export'
import { subscriptionRouter } from './subscription'
import { buildExportData, getEnabledExportConfigByToken } from '../export-data'
import { renderExportData } from '../generators/export-renderer'
import { ensureDefaultExportConfig } from '../services/default-export-config'

vi.mock('../export-data', () => ({
  buildExportData: vi.fn(),
  getEnabledExportConfigByToken: vi.fn(),
  getExportConfigById: vi.fn(),
}))

vi.mock('../generators/export-renderer', () => ({
  renderExportData: vi.fn(() => ({
    content: 'proxies: []',
    contentType: 'text/yaml; charset=utf-8',
  })),
}))

vi.mock('../services/app-settings', () => ({
  getAppSettings: vi.fn(async () => ({
    dnsMode: 'smart',
    showCompatibilityWarnings: true,
  })),
}))

vi.mock('../services/default-export-config', () => ({
  ensureDefaultExportConfig: vi.fn(async () => ({
    id: 'default-config',
    name: 'Default',
    format: 'mihomo',
    token: 'token',
    enabled: true,
    includeCollectionIds: [],
    includeGroupIds: [],
    includeRuleIds: [],
    includeRemoteSetIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })),
  generateExportToken: vi.fn(() => 'token'),
}))

describe('export download readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({ nodes: [] }))
    vi.mocked(getEnabledExportConfigByToken).mockResolvedValue({
      id: 'config-1',
      name: 'Default',
      format: 'mihomo',
      token: 'token',
      enabled: true,
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('blocks authenticated downloads when no nodes are exportable', async () => {
    const response = await exportRouter.request('/download/mihomo', {}, { DB: createMockDb() })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('没有可导出的节点'),
    })
    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce()
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('blocks authenticated downloads when all nodes are unsupported by the target exporter', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      nodes: [
        {
          id: 'node-wireguard',
          sourceId: 'source-1',
          name: 'WG 01',
          protocol: 'wireguard',
          server: 'wg.example.com',
          port: 51820,
          enabled: true,
          tags: [],
          rawConfig: {},
          parsedConfig: { protocol: 'wireguard', server: 'wg.example.com', port: 51820, extra: {} },
          isManual: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    const response = await exportRouter.request('/download/mihomo', {}, { DB: createMockDb() })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('没有可导出到 mihomo 的节点'),
    })
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('renders quick downloads with the requested format while reusing the default export scope', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      nodes: [
        {
          id: 'node-ss',
          sourceId: 'source-1',
          name: 'SS 01',
          protocol: 'ss',
          server: 'ss.example.com',
          port: 8388,
          enabled: true,
          tags: [],
          rawConfig: {},
          parsedConfig: { protocol: 'ss', server: 'ss.example.com', port: 8388, extra: {} },
          isManual: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    const db = createMockDb()
    const response = await exportRouter.request('/download/singbox', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="singbox.json"')
    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce()
    expect(buildExportData).toHaveBeenCalledWith(db, expect.objectContaining({ format: 'mihomo' }))
    expect(renderExportData).toHaveBeenCalledWith(
      expect.anything(),
      'singbox',
      expect.objectContaining({ dnsMode: 'smart' })
    )
  })

  it('blocks public subscriptions when no nodes are exportable', async () => {
    const db = createMockDb()
    const response = await subscriptionRouter.request('/sub/token/mihomo.yaml', {}, { DB: db })

    expect(response.status).toBe(409)
    await expect(response.text()).resolves.toContain('没有可导出的节点')
    expect(response.headers.get('Subscription-Userinfo')).toBe('upload=0; download=0; total=10737418240; expire=4099680000')
    expect(getEnabledExportConfigByToken).toHaveBeenCalledWith(db, 'token')
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('blocks public subscriptions when all nodes are unsupported by the target exporter', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      nodes: [
        {
          id: 'node-wireguard',
          sourceId: 'source-1',
          name: 'WG 01',
          protocol: 'wireguard',
          server: 'wg.example.com',
          port: 51820,
          enabled: true,
          tags: [],
          rawConfig: {},
          parsedConfig: { protocol: 'wireguard', server: 'wg.example.com', port: 51820, extra: {} },
          isManual: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    const response = await subscriptionRouter.request('/sub/token/mihomo.yaml', {}, { DB: createMockDb() })

    expect(response.status).toBe(409)
    await expect(response.text()).resolves.toContain('没有可导出到 mihomo 的节点')
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('renders public subscriptions with the filename format and stored DNS mode', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      nodes: [
        {
          id: 'node-ss',
          sourceId: 'source-1',
          name: 'SS 01',
          protocol: 'ss',
          server: 'ss.example.com',
          port: 8388,
          enabled: true,
          tags: [],
          rawConfig: {},
          parsedConfig: { protocol: 'ss', server: 'ss.example.com', port: 8388, extra: {} },
          isManual: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    const db = createMockDb()
    const response = await subscriptionRouter.request('/sub/token/singbox.json', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="singbox.json"')
    expect(getEnabledExportConfigByToken).toHaveBeenCalledWith(db, 'token')
    expect(renderExportData).toHaveBeenCalledWith(
      expect.anything(),
      'singbox',
      expect.objectContaining({ dnsMode: 'smart' })
    )
  })
})

function makeExportData(patch: Partial<ExportData> = {}): ExportData {
  return {
    nodeRows: [],
    groupRows: [],
    ruleRows: [],
    remoteSetRows: [],
    sourceRows: [],
    sources: [],
    nodes: [],
    groups: [],
    rules: [],
    remoteSets: [],
    collectionNodeNames: {},
    ...patch,
  }
}

function createMockDb(): D1Database {
  return {} as D1Database
}
