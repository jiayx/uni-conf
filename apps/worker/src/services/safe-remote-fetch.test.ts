import { describe, expect, it, vi } from 'vitest'
import { isSafeRemoteHttpUrl, parseSafeRemoteHttpUrl, safeRemoteFetch, SafeRemoteUrlError } from './safe-remote-fetch'

describe('safe remote fetch', () => {
  it.each([
    'http://localhost/rules',
    'http://service.local/rules',
    'http://127.0.0.1/rules',
    'http://127.1/rules',
    'http://0x7f000001/rules',
    'http://2130706433/rules',
    'http://10.1.2.3/rules',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.1/rules',
    'http://[::1]/rules',
    'http://[::127.0.0.1]/rules',
    'http://[::ffff:127.0.0.1]/rules',
    'http://[64:ff9b::127.0.0.1]/rules',
    'http://[fc00::1]/rules',
    'http://[fe80::1]/rules',
    'http://user:pass@example.com/rules',
    'file:///tmp/rules',
  ])('blocks non-public target %s', (url) => {
    expect(isSafeRemoteHttpUrl(url)).toBe(false)
    expect(() => parseSafeRemoteHttpUrl(url)).toThrow(SafeRemoteUrlError)
  })

  it.each([
    'https://example.com/rules.list',
    'http://1.1.1.1/rules',
    'https://[2606:4700:4700::1111]/rules',
  ])('accepts a public HTTP target %s', (url) => {
    expect(isSafeRemoteHttpUrl(url)).toBe(true)
  })

  it('follows validated relative redirects manually', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/final' } }))
      .mockResolvedValueOnce(new Response('ok')) as unknown as typeof fetch

    const response = await safeRemoteFetch(fetcher, 'https://example.com/start', {}, { timeoutMs: 1000 })

    expect(await response.text()).toBe('ok')
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://example.com/start', expect.objectContaining({ redirect: 'manual' }))
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://example.com/final', expect.objectContaining({ redirect: 'manual' }))
  })

  it('blocks a redirect to a private target before requesting it', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data' },
    })) as unknown as typeof fetch

    await expect(safeRemoteFetch(fetcher, 'https://example.com/start', {}, { timeoutMs: 1000 }))
      .rejects.toMatchObject({ code: 'private_address' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('limits redirect chains', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: '/again' },
    })) as unknown as typeof fetch

    await expect(safeRemoteFetch(fetcher, 'https://example.com/start', {}, { timeoutMs: 1000, maxRedirects: 2 }))
      .rejects.toMatchObject({ code: 'too_many_redirects' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('removes credential headers when redirecting across origins', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://cdn.example.com/final' } }))
      .mockResolvedValueOnce(new Response('ok'))
    const fetcher = fetchMock as unknown as typeof fetch

    await safeRemoteFetch(fetcher, 'https://example.com/start', {
      headers: { Authorization: 'Bearer secret', Cookie: 'secret=value', Accept: 'text/plain' },
    }, { timeoutMs: 1000 })

    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit
    const headers = new Headers(secondInit.headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('accept')).toBe('text/plain')
  })
})
