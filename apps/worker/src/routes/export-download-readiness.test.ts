import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as yaml from 'js-yaml'
import type { ExportData } from '../export-data'
import type { AppSettings, ExportFormat } from '@uni-conf/types'
import { exportRouter } from './export'
import { subscriptionRouter } from './subscription'
import { buildExportData, getEnabledExportConfigByToken, getExportConfigById } from '../export-data'
import { renderExportData } from '../generators/export-renderer'
import { ensureDefaultExportConfig } from '../services/default-export-config'
import { validateRenderedExport } from '../services/export-artifact-validation'
import { getAppSettings } from '../services/app-settings'

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

vi.mock('../services/export-artifact-validation', () => ({
  validateRenderedExport: vi.fn((format: ExportFormat) => ({
    format,
    kind: format === 'singbox' ? 'json' : 'yaml',
    valid: true,
    issues: [],
  })),
  exportArtifactWarnings: vi.fn(() => []),
}))

vi.mock('../services/app-settings', () => ({
  getAppSettings: vi.fn(async () => ({
    showCompatibilityWarnings: true,
  })),
}))

vi.mock('../services/default-export-config', () => ({
  DEFAULT_EXPORT_CONFIG_ID: 'default-mihomo',
  ensureDefaultExportConfig: vi.fn(async () => ({
    id: 'default-mihomo',
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
    vi.unstubAllGlobals()
    vi.mocked(getAppSettings).mockResolvedValue({
      showCompatibilityWarnings: true, ruleSetConversionPolicy: 'compatible',
    } as AppSettings)
    vi.mocked(ensureDefaultExportConfig).mockResolvedValue({
      id: 'default-mihomo', name: 'Default', format: 'mihomo', token: 'token', enabled: true,
      includeCollectionIds: [], includeGroupIds: [], includeRuleIds: [], includeRemoteSetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({ nodes: [] }))
    vi.mocked(getEnabledExportConfigByToken).mockResolvedValue({
      id: 'default-mihomo',
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
    expect(response.headers.get('X-UniConf-Error-Code')).toBe('export_not_ready')
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'export_not_ready',
      error: expect.stringContaining('没有可导出的节点'),
    })
    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce()
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('blocks default authenticated preview and download while the public profile is paused', async () => {
    vi.mocked(ensureDefaultExportConfig).mockResolvedValue({
      id: 'default-config', name: 'Default', format: 'mihomo', token: 'token', enabled: false,
      includeCollectionIds: [], includeGroupIds: [], includeRuleIds: [], includeRemoteSetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const preview = await exportRouter.request('/preview/mihomo', {}, { DB: createMockDb() })
    const download = await exportRouter.request('/download/mihomo', {}, { DB: createMockDb() })

    expect(preview.status).toBe(403)
    expect(download.status).toBe(403)
    await expect(preview.json()).resolves.toMatchObject({ error: 'Export config is disabled' })
    await expect(download.json()).resolves.toMatchObject({ error: 'Export config is disabled' })
    expect(buildExportData).not.toHaveBeenCalled()
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

  it('blocks authenticated downloads when the export graph has structural errors', async () => {
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
          parsedConfig: {
            protocol: 'ss',
            server: 'ss.example.com',
            port: 8388,
            password: 'password',
            extra: { cipher: 'aes-256-gcm' },
          },
          isManual: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      groups: [
        {
          id: 'proxy',
          name: 'PROXY',
          type: 'select',
          collectionIds: [],
          groupIds: ['missing-child'],
          builtins: [],
          enabled: true,
          order: 0,
          isBuiltin: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    const response = await exportRouter.request('/download/mihomo', {}, { DB: createMockDb() })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('引用了不存在或未导出的策略组'),
    })
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('defers compatible rule-set conversion during authenticated downloads', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeConvertibleExportData())
    const fetcher = vi.fn(async () => new Response('payload:\n  - SCRIPT,legacy-only\n'))
    vi.stubGlobal('fetch', fetcher)

    const response = await exportRouter.request('/download/singbox', {}, { DB: createMockDb() })

    expect(response.status).toBe(200)
    expect(fetcher).not.toHaveBeenCalled()
    expect(renderExportData).toHaveBeenCalled()
  })

  it('does not report successful compatible conversions as preview warnings', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeConvertibleExportData())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy\n'
    )))

    const response = await exportRouter.request('/preview/singbox', {}, { DB: createMockDb() })
    const body = await response.json() as { data: { warnings: Array<{ message: string }> } }

    expect(response.status).toBe(200)
    expect(body.data.warnings).toEqual([])
  })

  it('blocks partial authenticated and public conversions in strict completeness mode', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      showCompatibilityWarnings: true, ruleSetConversionPolicy: 'strict',
    } as AppSettings)
    vi.mocked(buildExportData).mockResolvedValue(makeConvertibleExportData())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy\n'
    )))

    const download = await exportRouter.request('/download/singbox', {}, { DB: createMockDb() })
    expect(download.status).toBe(409)
    expect(download.headers.get('X-UniConf-Error-Code')).toBe('conversion_incomplete')
    await expect(download.json()).resolves.toMatchObject({ code: 'conversion_incomplete', error: expect.stringContaining('严格完整模式') })

    const subscription = await subscriptionRouter.request('/sub/token/singbox.json', {}, { DB: createMockDb() })
    expect(subscription.status).toBe(409)
    expect(subscription.headers.get('X-UniConf-Error-Code')).toBe('conversion_incomplete')
    await expect(subscription.text()).resolves.toContain('严格完整模式')
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('lets an export profile override the global conversion policy in both directions', async () => {
    const strictProfile = {
      id: 'strict-profile',
      name: 'Strict',
      format: 'singbox' as const,
      token: 'token',
      enabled: true,
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      ruleSetConversionPolicy: 'strict' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(getExportConfigById).mockResolvedValue(strictProfile)
    vi.mocked(buildExportData).mockResolvedValue(makeConvertibleExportData())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy\n'
    )))

    const strictDownload = await exportRouter.request(
      '/download/singbox?configId=strict-profile',
      {},
      { DB: createMockDb() },
    )
    expect(strictDownload.status).toBe(409)
    expect(strictDownload.headers.get('X-UniConf-Error-Code')).toBe('conversion_incomplete')

    vi.mocked(getAppSettings).mockResolvedValue({
      showCompatibilityWarnings: true, ruleSetConversionPolicy: 'strict',
    } as AppSettings)
    vi.mocked(getEnabledExportConfigByToken).mockResolvedValue({
      ...strictProfile,
      id: 'compatible-profile',
      ruleSetConversionPolicy: 'compatible',
    })
    vi.mocked(renderExportData).mockReturnValue({
      content: '{"outbounds":[]}',
      contentType: 'application/json; charset=utf-8',
    })

    const compatibleSubscription = await subscriptionRouter.request(
      '/sub/token/singbox.json',
      {},
      { DB: createMockDb() },
    )
    expect(compatibleSubscription.status).toBe(200)
    expect(compatibleSubscription.headers.get('X-UniConf-Error-Code')).toBeNull()
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
    expect(response.headers.get('X-UniConf-Capability-Profile')).toBe('uni-conf-exporter/singbox@19')
    expect(ensureDefaultExportConfig).toHaveBeenCalledOnce()
    expect(buildExportData).toHaveBeenCalledWith(db, expect.objectContaining({ format: 'mihomo' }), 'singbox')
    expect(renderExportData).toHaveBeenCalledWith(
      expect.anything(),
      'singbox',
      expect.objectContaining({
        dnsPolicy: expect.objectContaining({
          address: expect.objectContaining({ mode: 'fake-ip' }),
          resolution: expect.objectContaining({ mode: 'split' }),
        }),
      })
    )
  })

  it('returns runtime artifact validation with authenticated previews', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({ nodes: [renderableNode()] }))
    vi.mocked(validateRenderedExport).mockReturnValue({
      format: 'mihomo',
      kind: 'yaml',
      valid: true,
      issues: [],
    })

    const response = await exportRouter.request('/preview/mihomo', {}, { DB: createMockDb() })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        format: 'mihomo',
        capabilityProfile: { id: 'uni-conf-exporter', revision: 19, format: 'mihomo' },
        artifactValidation: { format: 'mihomo', kind: 'yaml', valid: true, issues: [] },
        readiness: { ready: true, blockingWarnings: [] },
      },
    })
  })

  it('renders raw node quick downloads with the canonical node subscription filename', async () => {
    const parsedConfig = {
      protocol: 'ss' as const,
      server: 'ss.example.com',
      port: 8388,
      password: 'password',
      extra: { cipher: 'aes-256-gcm' },
    }
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      nodeRows: [
        {
          id: 'node-ss',
          source_id: 'source-1',
          name: 'SS 01',
          protocol: 'ss',
          server: 'ss.example.com',
          port: 8388,
          enabled: 1,
          tags: '[]',
          raw_config: '{}',
          parsed_config: JSON.stringify(parsedConfig),
          is_manual: 0,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
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
          parsedConfig,
          isManual: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    const db = createMockDb()
    const response = await exportRouter.request('/download/nodes_raw', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="nodes-raw.txt"')
    expect(buildExportData).toHaveBeenCalledWith(db, expect.objectContaining({ format: 'mihomo' }), 'nodes_raw')
    expect(renderExportData).toHaveBeenCalledWith(
      expect.anything(),
      'nodes_raw',
      expect.objectContaining({ dnsPolicy: undefined })
    )
  })

  it('blocks public subscriptions when no nodes are exportable', async () => {
    const db = createMockDb()
    const response = await subscriptionRouter.request('/sub/token/mihomo.yaml', {}, { DB: db })

    expect(response.status).toBe(409)
    await expect(response.text()).resolves.toContain('没有可导出的节点')
    expect(response.headers.get('Subscription-Userinfo')).toBeNull()
    expect(getEnabledExportConfigByToken).toHaveBeenCalledWith(db, 'token')
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('returns a non-cacheable not-found response for paused or rotated public links', async () => {
    vi.mocked(getEnabledExportConfigByToken).mockResolvedValueOnce(null)

    const response = await subscriptionRouter.request('/sub/disabled-token/mihomo.yaml', {}, { DB: createMockDb() })

    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
    expect(response.headers.get('X-UniConf-Error-Code')).toBe('subscription_unavailable')
    await expect(response.text()).resolves.toContain('not found or disabled')
    expect(buildExportData).not.toHaveBeenCalled()
  })

  it('only serves an advanced export profile in its configured format', async () => {
    const advancedProfile = {
      id: 'mobile-singbox',
      name: 'Mobile',
      format: 'singbox' as const,
      dnsPolicy: {
        address: {
          mode: 'fake-ip' as const,
          realIpExceptions: {
            includeManagedDefaults: true,
            domains: [],
          },
        },
        resolution: { mode: 'split' as const, preset: 'managed' as const },
      },
      token: 'mobile-token',
      enabled: true,
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(getExportConfigById).mockResolvedValue(advancedProfile)
    vi.mocked(getEnabledExportConfigByToken).mockResolvedValue(advancedProfile)

    const admin = await exportRouter.request(
      '/download/mihomo?configId=mobile-singbox',
      {},
      { DB: createMockDb() },
    )
    const publicSubscription = await subscriptionRouter.request(
      '/sub/mobile-token/mihomo.yaml',
      {},
      { DB: createMockDb() },
    )

    expect(admin.status).toBe(400)
    await expect(admin.json()).resolves.toMatchObject({
      success: false,
      error: 'Export profile does not support this format',
    })
    expect(publicSubscription.status).toBe(404)
    expect(publicSubscription.headers.get('X-UniConf-Error-Code')).toBe('subscription_format_mismatch')
    expect(publicSubscription.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
    expect(buildExportData).not.toHaveBeenCalled()
  })

  it('serves token-scoped, semantics-preserving converted rule sets', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      remoteSets: [{
        id: 'rules-1', name: 'Clash Rules', url: 'https://rules.example.com/list.yaml',
        format: 'clash', behavior: 'classical', targetGroupId: 'group-1', updateInterval: 12,
        sourceOverrides: {},
        enabled: true, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy-script\n',
      { status: 200, headers: { 'content-type': 'text/yaml' } }
    )))

    const response = await subscriptionRouter.request(
      '/sub/token/rules/rules-1/singbox.json',
      {},
      { DB: createMockDb() }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
    expect(response.headers.get('X-UniConf-Converted-Rules')).toBe('1')
    expect(response.headers.get('X-UniConf-Skipped-Rules')).toBe('1')
    expect(response.headers.get('X-UniConf-Skipped-Rule-Types')).toBe('SCRIPT=1')
    expect(response.headers.get('X-UniConf-Capability-Profile')).toBe('uni-conf-exporter/singbox@19')
    await expect(response.json()).resolves.toEqual({
      version: 3,
      rules: [{ domain_suffix: ['example.com'] }],
    })
  })

  it('enforces strict completeness again at the token-scoped converted rule-set endpoint', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      showCompatibilityWarnings: true, ruleSetConversionPolicy: 'strict',
    } as AppSettings)
    vi.mocked(buildExportData).mockResolvedValue(makeConvertibleExportData())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy-script\n',
    )))

    const response = await subscriptionRouter.request(
      '/sub/token/rules/rules-1/singbox.json',
      {},
      { DB: createMockDb() },
    )

    expect(response.status).toBe(409)
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
    expect(response.headers.get('X-UniConf-Error-Code')).toBe('conversion_incomplete')
    expect(response.headers.get('X-UniConf-Converted-Rules')).toBeNull()
    await expect(response.text()).resolves.toContain('Strict completeness mode rejected 1 unconverted rule')
  })

  it('lets a compatible profile override global strict mode at the converted rule-set endpoint', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      showCompatibilityWarnings: true, ruleSetConversionPolicy: 'strict',
    } as AppSettings)
    vi.mocked(getEnabledExportConfigByToken).mockResolvedValue({
      id: 'compatible-profile',
      name: 'Compatible',
      format: 'singbox',
      token: 'token',
      enabled: true,
      includeCollectionIds: [],
      includeGroupIds: [],
      includeRuleIds: [],
      includeRemoteSetIds: [],
      ruleSetConversionPolicy: 'compatible',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    vi.mocked(buildExportData).mockResolvedValue(makeConvertibleExportData())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'payload:\n  - DOMAIN-SUFFIX,example.com\n  - SCRIPT,legacy-script\n',
    )))

    const response = await subscriptionRouter.request(
      '/sub/token/rules/rules-1/singbox.json',
      {},
      { DB: createMockDb() },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-UniConf-Capability-Profile')).toBe('uni-conf-exporter/singbox@19')
    expect(response.headers.get('X-UniConf-Converted-Rules')).toBe('1')
    expect(response.headers.get('X-UniConf-Skipped-Rules')).toBe('1')
  })

  it('serves a token-scoped Quantumult X list converted from sing-box source rules', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      remoteSets: [{
        id: 'rules-qx', name: 'sing-box Rules', url: 'https://rules.example.com/list.json',
        format: 'singbox', behavior: 'classical', targetGroupId: 'group-1', updateInterval: 12,
        sourceOverrides: {},
        enabled: true, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      version: 3,
      rules: [{ domain_suffix: ['example.com'] }, { process_name: ['unsupported'] }],
    }))))

    const response = await subscriptionRouter.request(
      '/sub/token/rules/rules-qx/quantumultx.list',
      {},
      { DB: createMockDb() }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/plain')
    expect(response.headers.get('X-UniConf-Converted-Rules')).toBe('1')
    expect(response.headers.get('X-UniConf-Skipped-Rules')).toBe('1')
    expect(response.headers.get('X-UniConf-Skipped-Rule-Types')).toBe('PROCESS-NAME=1')
    await expect(response.text()).resolves.toBe('HOST-SUFFIX,example.com\n')
  })

  it('serves token-scoped native Egern YAML converted from sing-box source rules', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      remoteSets: [{
        id: 'rules-egern', name: 'sing-box Rules', url: 'https://rules.example.com/list.json',
        format: 'singbox', behavior: 'classical', targetGroupId: 'group-1', updateInterval: 12,
        sourceOverrides: {},
        enabled: true, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      version: 3,
      rules: [{ domain_suffix: ['example.com'] }, { source_port: [8080] }],
    }))))

    const response = await subscriptionRouter.request(
      '/sub/token/rules/rules-egern/egern.yaml',
      {},
      { DB: createMockDb() }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/yaml')
    expect(response.headers.get('X-UniConf-Converted-Rules')).toBe('1')
    expect(response.headers.get('X-UniConf-Skipped-Rule-Types')).toBe('SRC-PORT=1')
    expect(yaml.load(await response.text())).toEqual({ domain_suffix_set: ['example.com'] })
  })

  it('uses the requested Clash context instead of a Mihomo override at the conversion endpoint', async () => {
    const sourceUrl = 'https://rules.example.com/source.json'
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      remoteSets: [{
        id: 'rules-clash', name: 'Client-specific Rules', url: sourceUrl,
        format: 'singbox', behavior: 'classical', targetGroupId: 'group-1', updateInterval: 12,
        sourceOverrides: { mihomo: 'https://rules.example.com/native-mihomo.yaml' },
        enabled: true, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    }))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      version: 3,
      rules: [{ domain_suffix: ['example.com'] }],
    })))
    vi.stubGlobal('fetch', fetchMock)

    const response = await subscriptionRouter.request(
      '/sub/token/rules/rules-clash/mihomo.yaml?for=clash',
      {},
      { DB: createMockDb() }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-UniConf-Capability-Profile')).toBe('uni-conf-exporter/clash@19')
    expect(fetchMock).toHaveBeenCalledWith(
      sourceUrl,
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(await response.text()).toContain('DOMAIN-SUFFIX,example.com')
    expect(buildExportData).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'clash')
  })

  it('rejects an invalid target-client context at the conversion endpoint', async () => {
    const response = await subscriptionRouter.request(
      '/sub/token/rules/rules-1/mihomo.yaml?for=nodes_raw',
      {},
      { DB: createMockDb() }
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('X-UniConf-Error-Code')).toBe('conversion_export_format_invalid')
    expect(buildExportData).not.toHaveBeenCalled()
  })

  it('does not expose rule sets outside the token profile scope', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData())
    const response = await subscriptionRouter.request(
      '/sub/token/rules/not-in-profile/singbox.json',
      {},
      { DB: createMockDb() }
    )
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate')
    expect(response.headers.get('X-UniConf-Error-Code')).toBe('rule_set_out_of_scope')
  })

  it('emits a lazy conversion URL without downloading the source first', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeConvertibleExportData())
    const fetcher = vi.fn(async () => new Response('payload:\n  - SCRIPT,legacy-only\n'))
    vi.stubGlobal('fetch', fetcher)

    const response = await subscriptionRouter.request('/sub/token/singbox.json', {}, { DB: createMockDb() })

    expect(response.status).toBe(200)
    expect(fetcher).not.toHaveBeenCalled()
    expect(renderExportData).toHaveBeenCalled()
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

  it('blocks public subscriptions when the export graph has structural errors', async () => {
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
      groups: [
        {
          id: 'proxy',
          name: 'PROXY',
          type: 'select',
          collectionIds: [],
          groupIds: ['missing-child'],
          builtins: [],
          enabled: true,
          order: 0,
          isBuiltin: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    const response = await subscriptionRouter.request('/sub/token/mihomo.yaml', {}, { DB: createMockDb() })

    expect(response.status).toBe(409)
    await expect(response.text()).resolves.toContain('引用了不存在或未导出的策略组')
    expect(renderExportData).not.toHaveBeenCalled()
  })

  it('renders public subscriptions with the filename format and stored DNS policy', async () => {
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
    expect(response.headers.get('X-UniConf-Capability-Profile')).toBe('uni-conf-exporter/singbox@19')
    expect(getEnabledExportConfigByToken).toHaveBeenCalledWith(db, 'token')
    expect(renderExportData).toHaveBeenCalledWith(
      expect.anything(),
      'singbox',
      expect.objectContaining({
        dnsPolicy: expect.objectContaining({
          address: expect.objectContaining({ mode: 'fake-ip' }),
          resolution: expect.objectContaining({ mode: 'split' }),
        }),
      })
    )
  })

  it('builds public node subscriptions with the requested node-only format scope', async () => {
    const parsedConfig = {
      protocol: 'ss' as const,
      server: 'ss.example.com',
      port: 8388,
      password: 'password',
      extra: { cipher: 'aes-256-gcm' },
    }
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({
      nodeRows: [
        {
          id: 'node-ss',
          source_id: 'source-1',
          name: 'SS 01',
          protocol: 'ss',
          server: 'ss.example.com',
          port: 8388,
          enabled: 1,
          tags: '[]',
          raw_config: '{}',
          parsed_config: JSON.stringify(parsedConfig),
          is_manual: 0,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
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
          parsedConfig,
          isManual: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    const db = createMockDb()
    const response = await subscriptionRouter.request('/sub/token/nodes.txt', {}, { DB: db })

    expect(response.status).toBe(200)
    expect(buildExportData).toHaveBeenCalledWith(db, expect.objectContaining({ format: 'mihomo' }), 'nodes_base64')
    expect(renderExportData).toHaveBeenCalledWith(
      expect.anything(),
      'nodes_base64',
      expect.objectContaining({ dnsPolicy: undefined })
    )
  })

  it('blocks admin downloads and public subscriptions when rendered structure is invalid', async () => {
    vi.mocked(buildExportData).mockResolvedValue(makeExportData({ nodes: [renderableNode()] }))
    vi.mocked(validateRenderedExport).mockReturnValue({
      format: 'mihomo',
      kind: 'yaml',
      valid: false,
      issues: [{
        code: 'missing_section',
        path: 'rules',
        message: '缺少 rules 数组',
        messageEn: 'Missing the rules array.',
      }],
    })

    const adminResponse = await exportRouter.request('/download/mihomo', {}, { DB: createMockDb() })
    const publicResponse = await subscriptionRouter.request('/sub/token/mihomo.yaml', {}, { DB: createMockDb() })

    expect(adminResponse.status).toBe(500)
    expect(adminResponse.headers.get('X-UniConf-Error-Code')).toBe('artifact_invalid')
    await expect(adminResponse.json()).resolves.toMatchObject({
      success: false,
      code: 'artifact_invalid',
      error: 'Generated export failed structural validation',
      artifactValidation: { valid: false },
    })
    expect(publicResponse.status).toBe(500)
    expect(publicResponse.headers.get('X-UniConf-Error-Code')).toBe('artifact_invalid')
    await expect(publicResponse.text()).resolves.toContain('failed structural validation')
  })
})

function renderableNode(): ExportData['nodes'][number] {
  return {
    id: 'node-ss',
    sourceId: 'source-1',
    name: 'SS 01',
    protocol: 'ss',
    server: 'ss.example.com',
    port: 8388,
    enabled: true,
    tags: [],
    rawConfig: {},
    parsedConfig: { protocol: 'ss', server: 'ss.example.com', port: 8388, password: 'password', extra: { cipher: 'aes-256-gcm' } },
    isManual: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

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

function makeConvertibleExportData(): ExportData {
  return makeExportData({
    nodes: [renderableNode()],
    groups: [{
      id: 'group-1', name: 'PROXY', type: 'select', collectionIds: [], groupIds: [], builtins: ['DIRECT'],
      enabled: true, order: 1, isBuiltin: false,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    remoteSets: [{
      id: 'rules-1', name: 'Clash Rules', url: 'https://rules.example.com/list.yaml',
      format: 'clash', behavior: 'classical', targetGroupId: 'group-1', updateInterval: 12,
      sourceOverrides: {},
      enabled: true, sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  })
}

function createMockDb(): D1Database {
  return {} as D1Database
}
