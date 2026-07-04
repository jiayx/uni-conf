import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, UnauthorizedError } from './api'
import { getStoredApiKey } from './auth'

vi.mock('./auth', () => ({
  getStoredApiKey: vi.fn(() => ''),
}))

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    await expect(api.nodes.list({ search: 'airport', country: 'HK' })).resolves.toEqual([
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

  it('extracts JSON download errors instead of exposing raw responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      error: 'No nodes are available',
    }, { status: 409 })))

    await expect(api.export.downloadFormat('mihomo')).rejects.toThrow('No nodes are available')
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
    await api.sources.update('source-1', { enabled: false })
    await api.sources.remove('source-1')
    await api.sources.refresh('source-1')
    await api.nodes.listPage({ page: 2, pageSize: 10, enabled: true })
    await api.nodes.get('node-1')
    await api.nodes.create({ uri: 'trojan://pwd@example.com:443#Node' })
    await api.nodes.update('node-1', { enabled: false })
    await api.nodes.remove('node-1')
    await api.collections.list()
    await api.collections.get('collection-1')
    await api.collections.create({ name: 'All', sourceIds: [], nodeIds: [], filters: [], renames: [], dedup: 'name', sort: 'manual', enabled: true })
    await api.collections.update('collection-1', { enabled: false })
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
    await api.rules.create({ type: 'MATCH', payload: '', targetGroupId: 'group-1', enabled: true, order: 0, compatibility: [] })
    await api.rules.update('rule-1', { enabled: false })
    await api.rules.remove('rule-1')
    await api.rules.reorder(['rule-2', 'rule-1'])
    await api.rules.batchCreate([{ type: 'MATCH', payload: '', targetGroupId: 'group-1', enabled: true, order: 0, compatibility: [] }])
    await api.remoteRuleSets.list()
    await api.remoteRuleSets.get('remote-1')
    await api.remoteRuleSets.create({ name: 'Remote', url: 'https://example.com/list', format: 'text', behavior: 'domain', targetGroupId: 'group-1', updateInterval: 24, enabled: true, sortOrder: 1 })
    await api.remoteRuleSets.batchCreate([{ name: 'Remote', url: 'https://example.com/list', format: 'text', behavior: 'domain', targetGroupId: 'group-1', updateInterval: 24, enabled: true, sortOrder: 1 }])
    await api.remoteRuleSets.update('remote-1', { enabled: false })
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
    await api.settings.importData({ version: 1 })
    await api.settings.clearData()

    const calls = fetchMock.mock.calls.map(call => [call[0], call[1]?.method])
    expect(calls).toContainEqual(['/api/sources', 'GET'])
    expect(calls).toContainEqual(['/api/sources/import', 'POST'])
    expect(calls).toContainEqual(['/api/nodes?page=2&pageSize=10&enabled=true', 'GET'])
    expect(calls).toContainEqual(['/api/collections/collection-1/preview', 'GET'])
    expect(calls).toContainEqual(['/api/groups/reorder', 'POST'])
    expect(calls).toContainEqual(['/api/rules/batch', 'POST'])
    expect(calls).toContainEqual(['/api/remote-rule-sets/batch', 'POST'])
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
