import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { api, ApiError, UnauthorizedError } from './api'
import { getStoredApiKey } from './auth'
import type { ExportFormat } from '@uni-conf/types'

vi.mock('./auth', () => ({
  getStoredApiKey: vi.fn(() => ''),
}))

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(data), {
    ...init,
    status: init.status ?? 200,
    headers,
  })
}

describe('api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires declared export formats at every generated-config API boundary', () => {
    expectTypeOf(api.export.previewFormat).parameter(0).toEqualTypeOf<ExportFormat>()
    expectTypeOf(api.export.downloadFormat).parameter(0).toEqualTypeOf<ExportFormat>()
  })

  it('encodes export profile IDs in preview and download URLs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: {} }))
      .mockResolvedValueOnce(new Response('config', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await api.export.previewFormat('singbox', 'profile/a b')
    await api.export.downloadFormat('singbox', 'profile/a b')

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/export/preview/singbox?configId=profile%2Fa%20b',
      '/api/export/download/singbox?configId=profile%2Fa%20b',
    ])
  })

  it('percent-encodes every dynamic resource path segment', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => (
      jsonResponse({ success: true, data: {} })
    ))
    vi.stubGlobal('fetch', fetchMock)
    const id = 'id/a b?#%'
    const encoded = 'id%2Fa%20b%3F%23%25'

    await api.sources.refresh(id)
    await api.sources.retryStructuredImport(id)
    await api.nodes.update(id, { enabled: false })
    await api.collections.updateWithGroup(id, { name: 'Updated' }, 'select')
    await api.groups.remove(id)
    await api.rules.update(id, { enabled: false })
    await api.remoteRuleSets.previewConversion(id, 'singbox')
    await api.export.resetToken(id)

    expect(fetchMock.mock.calls.map(call => [call[0], call[1]?.method])).toEqual([
      [`/api/sources/${encoded}/refresh`, 'POST'],
      [`/api/sources/imports/${encoded}/structured/retry`, 'POST'],
      [`/api/nodes/${encoded}`, 'PUT'],
      [`/api/collections/${encoded}/with-group`, 'PUT'],
      [`/api/groups/${encoded}`, 'DELETE'],
      [`/api/rules/${encoded}`, 'PUT'],
      [`/api/remote-rule-sets/${encoded}/conversion-preview`, 'POST'],
      [`/api/export/configs/${encoded}/reset-token`, 'POST'],
    ])
  })

  it('loads all node pages for callers that need complete node lists', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: {
          items: [{ id: 'node-1', name: 'HK 01' }],
          total: 2,
          page: 1,
          pageSize: 200,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: {
          items: [{ id: 'node-2', name: 'JP 01' }],
          total: 2,
          page: 2,
          pageSize: 200,
        },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.nodes.listAll({ search: 'airport', country: 'HK' })).resolves.toEqual([
      { id: 'node-1', name: 'HK 01' },
      { id: 'node-2', name: 'JP 01' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/nodes?search=airport&page=1&pageSize=200&countryCode=HK')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/nodes?search=airport&page=2&pageSize=200&countryCode=HK')
  })

  it('sends the stored API key as a bearer token', async () => {
    vi.mocked(getStoredApiKey).mockReturnValue('secret')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: { status: 'ok' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api.dashboard.stats()

    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/stats', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
    }))
  })

  it('throws a typed error for unauthorized API responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      error: 'Unauthorized',
    }, { status: 401 })))

    await expect(api.auth.check()).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('preserves API status and machine-readable error codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      error: 'Rule set is too large to convert',
      code: 'too_large',
    }, { status: 413, headers: { 'X-Request-Id': 'request-123' } })))

    const request = api.remoteRuleSets.previewConversion('remote-1', 'singbox')
    await expect(request).rejects.toMatchObject({
      name: 'ApiError', status: 413, code: 'too_large', requestId: 'request-123', message: 'Rule set is too large to convert',
    } satisfies Partial<ApiError>)
  })

  it('preserves diagnostics when an API gateway returns a non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', {
      status: 502,
      headers: {
        'content-type': 'text/html',
        'X-UniConf-Error-Code': 'gateway_failure',
        'X-Request-Id': 'request-gateway-1',
      },
    })))

    await expect(api.dashboard.stats()).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      code: 'gateway_failure',
      requestId: 'request-gateway-1',
      message: 'The server returned an invalid response',
    } satisfies Partial<ApiError>)
  })

  it('preserves structured dependency remediation from API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      error: 'group is targeted by rule: Work Rule',
      code: 'resource_in_use',
      details: {
        dependencies: [
          {
            type: 'rule',
            id: 'rule-1',
            name: 'Work Rule',
            remediation: { target: 'rules', id: 'rule-1' },
          },
          {
            type: 'export-profile',
            id: 'export-1',
            name: 'Mobile',
            remediation: { target: 'export', id: 'export-1' },
          },
        ],
      },
    }, { status: 409 })))

    await expect(api.groups.remove('group-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'resource_in_use',
      details: {
        dependencies: [
          {
            type: 'rule',
            id: 'rule-1',
            name: 'Work Rule',
            remediation: { target: 'rules', id: 'rule-1' },
          },
          {
            type: 'export-profile',
            id: 'export-1',
            name: 'Mobile',
            remediation: { target: 'export', id: 'export-1' },
          },
        ],
      },
    } satisfies Partial<ApiError>)
  })

  it('extracts JSON download errors instead of exposing raw responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      error: 'No nodes are available',
    }, {
      status: 409,
      headers: { 'X-UniConf-Error-Code': 'export_not_ready', 'X-Request-Id': 'request-456' },
    })))

    await expect(api.export.downloadFormat('mihomo')).rejects.toMatchObject({
      name: 'ApiError', status: 409, code: 'export_not_ready', requestId: 'request-456', message: 'No nodes are available',
    } satisfies Partial<ApiError>)
  })

  it('routes typed API helpers to the expected endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({
      success: true,
      data: { items: [], nodes: [], ok: true },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api.sources.list()
    await api.sources.get('source-1')
    await api.sources.create({ url: 'https://example.com/sub' })
    await api.sources.import({ content: 'ss://example' })
    await api.sources.listImports()
    await api.sources.previewNodeRetry('run-1')
    await api.sources.retryNodeImport('run-1')
    await api.sources.previewStructuredRetry('run-1')
    await api.sources.retryStructuredImport('run-1', { 'rule:0:DOMAIN|example.com|0': 'use-imported' })
    await api.sources.undoImport('run-1')
    await api.sources.update('source-1', { enabled: false })
    await api.sources.remove('source-1')
    await api.sources.refresh('source-1')
    await api.nodes.listPage({ page: 2, pageSize: 10, enabled: true })
    await api.nodes.get('node-1')
    await api.nodes.create({ uri: 'trojan://pwd@example.com:443#Node' })
    await api.nodes.update('node-1', { enabled: false })
    await api.nodes.setEnabled(['node-1', 'node-2'], false)
    await api.nodes.remove('node-1')
    await api.collections.list()
    await api.collections.get('collection-1')
    await api.collections.create({ name: 'All', sourceIds: [], nodeIds: [], filters: [], renames: [], dedup: 'name', sort: 'manual', enabled: true })
    await api.collections.update('collection-1', { enabled: false })
    await api.collections.createWithGroup({ name: 'JP Auto', sourceIds: [], nodeIds: [], filters: [], renames: [], dedup: 'name', sort: 'manual', enabled: true }, 'url-test')
    await api.collections.updateWithGroup('collection-1', { name: 'JP Fallback' }, 'fallback')
    await api.collections.remove('collection-1')
    await api.collections.preview('collection-1')
    await api.groups.list()
    await api.groups.get('group-1')
    await api.groups.create({ name: 'Proxy', type: 'select', collectionIds: [], groupIds: [], builtins: [], enabled: true, order: 0, isBuiltin: false })
    await api.groups.update('group-1', { enabled: false })
    await api.groups.remove('group-1')
    await api.groups.reorder(['group-2', 'group-1'])
    await api.rules.list()
    await api.rules.get('rule-1')
    await api.rules.create({ type: 'DOMAIN', payload: 'example.com', targetGroupId: 'group-1', enabled: true, order: 0, compatibility: [] })
    await api.rules.update('rule-1', { enabled: false })
    await api.rules.setEnabled(['rule-1', 'rule-2'], false)
    await api.rules.remove('rule-1')
    await api.rules.reorder(['rule-2', 'rule-1'])
    await api.rules.batchCreate([{ type: 'DOMAIN', payload: 'example.com', targetGroupId: 'group-1', enabled: true, order: 0, compatibility: [] }])
    await api.remoteRuleSets.list()
    await api.remoteRuleSets.get('remote-1')
    await api.remoteRuleSets.create({ name: 'Remote', url: 'https://example.com/list', format: 'text', behavior: 'domain', sourceOverrides: {}, targetGroupId: 'group-1', updateInterval: 24, enabled: true, sortOrder: 1 })
    await api.remoteRuleSets.batchCreate([{ name: 'Remote', url: 'https://example.com/list', format: 'text', behavior: 'domain', sourceOverrides: {}, targetGroupId: 'group-1', updateInterval: 24, enabled: true, sortOrder: 1 }])
    await api.remoteRuleSets.update('remote-1', { enabled: false })
    await api.remoteRuleSets.validate('remote-1')
    await api.remoteRuleSets.validateAllSources('remote-1')
    await api.remoteRuleSets.validateSource({ url: 'https://example.com/egern.yaml', targetFormat: 'egern', behavior: 'domain' })
    await api.remoteRuleSets.validateSources([
      { url: 'https://example.com/egern.yaml', targetFormat: 'egern', behavior: 'domain' },
    ])
    await api.remoteRuleSets.previewConversion('remote-1', 'singbox')
    await api.remoteRuleSets.remove('remote-1')
    await api.export.listConfigs()
    await api.export.getConfig('export-1')
    await api.export.createConfig({ format: 'mihomo', enabled: true, includeCollectionIds: [], includeGroupIds: [], includeRuleIds: [], includeRemoteSetIds: [] })
    await api.export.updateConfig('export-1', { enabled: false })
    await api.export.deleteConfig('export-1')
    await api.export.resetToken('export-1')
    await api.export.previewFormat('singbox', 'export-1')
    await api.settings.get()
    await api.settings.update({ language: 'en' })
    await api.settings.importData({ version: 7 })
    await api.settings.clearData()

    const calls = fetchMock.mock.calls.map(call => [call[0], call[1]?.method])
    expect(calls).toContainEqual(['/api/sources', 'GET'])
    expect(calls).toContainEqual(['/api/sources/import', 'POST'])
    expect(calls).toContainEqual(['/api/sources/imports', 'GET'])
    expect(calls).toContainEqual(['/api/sources/imports/run-1/nodes/preview', 'POST'])
    expect(calls).toContainEqual(['/api/sources/imports/run-1/nodes/retry', 'POST'])
    expect(calls).toContainEqual(['/api/sources/imports/run-1/structured/preview', 'POST'])
    expect(calls).toContainEqual(['/api/sources/imports/run-1/structured/retry', 'POST'])
    expect(calls).toContainEqual(['/api/sources/imports/run-1/undo', 'POST'])
    expect(calls).toContainEqual(['/api/nodes?page=2&pageSize=10&enabled=true', 'GET'])
    expect(calls).toContainEqual(['/api/nodes/batch-enabled', 'PUT'])
    expect(calls).toContainEqual(['/api/collections/collection-1/preview', 'GET'])
    expect(calls).toContainEqual(['/api/collections/with-group', 'POST'])
    expect(calls).toContainEqual(['/api/collections/collection-1/with-group', 'PUT'])
    expect(calls).toContainEqual(['/api/groups/reorder', 'POST'])
    expect(calls).toContainEqual(['/api/rules/batch', 'POST'])
    expect(calls).toContainEqual(['/api/rules/batch-enabled', 'PUT'])
    expect(calls).toContainEqual(['/api/remote-rule-sets/batch', 'POST'])
    expect(calls).toContainEqual(['/api/remote-rule-sets/remote-1/validate', 'POST'])
    expect(calls).toContainEqual(['/api/remote-rule-sets/remote-1/validate-all', 'POST'])
    expect(calls).toContainEqual(['/api/remote-rule-sets/validate-source', 'POST'])
    expect(calls).toContainEqual(['/api/remote-rule-sets/validate-sources', 'POST'])
    expect(calls).toContainEqual(['/api/export/preview/singbox?configId=export-1', 'GET'])
    expect(calls).toContainEqual(['/api/data/import', 'POST'])
    expect(calls).toContainEqual(['/api/data', 'DELETE'])
  })

  it('downloads files and backup data with fallback filenames and auth handling', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('mixed-port: 7890', {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="custom.yaml"' },
      }))
      .mockResolvedValueOnce(new Response('backup', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.export.downloadFormat('mihomo', 'export-1')).resolves.toMatchObject({
      filename: 'custom.yaml',
    })
    await expect(api.settings.exportData()).resolves.toBeInstanceOf(Blob)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/export/download/mihomo?configId=export-1')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/data/export')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ cache: 'no-store' })
  })

  it('does not download a backup when the export endpoint returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      error: 'Backup export failed',
    }, { status: 500 })))

    await expect(api.settings.exportData()).rejects.toThrow('Backup export failed')
  })

  it('extracts plain text download errors and handles malformed JSON errors', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('# Plain download failure', { status: 409 }))
      .mockResolvedValueOnce(new Response('{', {
        status: 409,
        headers: { 'content-type': 'application/json' },
      })))

    await expect(api.export.downloadFormat('mihomo')).rejects.toThrow('Plain download failure')
    await expect(api.export.downloadFormat('mihomo')).rejects.toThrow('Download failed')
  })
})
