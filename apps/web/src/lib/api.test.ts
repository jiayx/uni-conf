import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, UnauthorizedError } from './api'
import { getStoredApiKey } from './auth'

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
    await api.nodes.getUri(id)
    await api.nodes.update(id, { enabled: false })
    await api.collections.updateWithGroup(id, { name: 'Updated' }, 'select')
    await api.groups.remove(id)
    await api.rules.update(id, { enabled: false })
    await api.remoteRuleSets.update(id, { enabled: false })
    await api.export.resetToken(id)

    expect(fetchMock.mock.calls.map(call => [call[0], call[1]?.method])).toEqual([
      [`/api/sources/${encoded}/refresh`, 'POST'],
      [`/api/sources/imports/${encoded}/structured/retry`, 'POST'],
      [`/api/nodes/${encoded}/uri`, 'GET'],
      [`/api/nodes/${encoded}`, 'PUT'],
      [`/api/collections/${encoded}/with-group`, 'PUT'],
      [`/api/groups/${encoded}`, 'DELETE'],
      [`/api/rules/${encoded}`, 'PUT'],
      [`/api/remote-rule-sets/${encoded}`, 'PUT'],
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

    const request = api.remoteRuleSets.update('remote-1', { enabled: true })
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
