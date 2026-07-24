const DEFAULT_MAX_REDIRECTS = 5

export type SafeRemoteUrlErrorCode =
  | 'invalid_url'
  | 'unsupported_protocol'
  | 'credentials_not_allowed'
  | 'private_address'
  | 'blocked_hostname'
  | 'invalid_redirect'
  | 'too_many_redirects'

export class SafeRemoteUrlError extends Error {
  constructor(
    public readonly code: SafeRemoteUrlErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SafeRemoteUrlError'
  }
}

export function parseSafeRemoteHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SafeRemoteUrlError('invalid_url', 'Remote URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeRemoteUrlError('unsupported_protocol', 'Remote URL must use HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new SafeRemoteUrlError('credentials_not_allowed', 'Remote URL must not contain credentials')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!hostname) throw new SafeRemoteUrlError('invalid_url', 'Remote URL must contain a hostname')
  if (isBlockedHostname(hostname)) {
    throw new SafeRemoteUrlError('blocked_hostname', 'Remote URL hostname is not publicly routable')
  }
  const ipv4 = parseIpv4(hostname)
  if (ipv4 && isBlockedIpv4(ipv4)) {
    throw new SafeRemoteUrlError('private_address', 'Remote URL must not use a private or reserved IPv4 address')
  }
  const ipv6 = parseIpv6(hostname)
  if (ipv6 && isBlockedIpv6(ipv6)) {
    throw new SafeRemoteUrlError('private_address', 'Remote URL must not use a private or reserved IPv6 address')
  }
  return url
}

export function isSafeRemoteHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    parseSafeRemoteHttpUrl(value.trim())
    return true
  } catch {
    return false
  }
}

export async function safeRemoteFetch(
  fetcher: typeof fetch,
  value: string,
  init: RequestInit,
  options: { timeoutMs: number; maxRedirects?: number }
): Promise<Response> {
  let current = parseSafeRemoteHttpUrl(value)
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  let method = (init.method ?? 'GET').toUpperCase()
  let headers = new Headers(init.headers)

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await fetcher(current.toString(), {
        ...init,
        method,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      })
      if (!isRedirectStatus(response.status)) return response
      if (redirectCount >= maxRedirects) {
        throw new SafeRemoteUrlError('too_many_redirects', `Remote URL exceeded ${maxRedirects} redirects`)
      }
      const location = response.headers.get('location')
      if (!location) throw new SafeRemoteUrlError('invalid_redirect', 'Remote redirect has no Location header')

      let next: URL
      try {
        next = parseSafeRemoteHttpUrl(new URL(location, current).toString())
      } catch (error) {
        if (error instanceof SafeRemoteUrlError) throw error
        throw new SafeRemoteUrlError('invalid_redirect', 'Remote redirect URL is invalid')
      }
      if (next.origin !== current.origin) {
        headers = new Headers(headers)
        headers.delete('authorization')
        headers.delete('cookie')
        headers.delete('proxy-authorization')
      }
      if (response.status === 303 && method !== 'HEAD') method = 'GET'
      current = next
    }
  } finally {
    clearTimeout(timer)
  }
}

function isBlockedHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname === 'home.arpa'
    || hostname.endsWith('.home.arpa')
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a = 0, b = 0] = octets
  return a === 0
    || a === 10
    || (a === 100 && b >= 64 && b <= 127)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
    || (a === 192 && b === 0 && octets[2] === 2)
    || (a === 198 && b === 51 && octets[2] === 100)
    || (a === 203 && b === 0 && octets[2] === 113)
}

function parseIpv6(hostname: string): number[] | null {
  if (!hostname.includes(':') || hostname.includes('%')) return null
  const doubleColon = hostname.indexOf('::')
  if (doubleColon !== -1 && doubleColon !== hostname.lastIndexOf('::')) return null
  const left = doubleColon === -1 ? hostname.split(':') : hostname.slice(0, doubleColon).split(':').filter(Boolean)
  const right = doubleColon === -1 ? [] : hostname.slice(doubleColon + 2).split(':').filter(Boolean)
  const parsedLeft = parseIpv6Parts(left)
  const parsedRight = parseIpv6Parts(right)
  if (!parsedLeft || !parsedRight) return null
  const missing = 8 - parsedLeft.length - parsedRight.length
  if ((doubleColon === -1 && missing !== 0) || (doubleColon !== -1 && missing < 1)) return null
  const words = [...parsedLeft, ...Array.from({ length: missing }, () => 0), ...parsedRight]
  return words.flatMap((word) => [word >> 8, word & 0xff])
}

function parseIpv6Parts(parts: string[]): number[] | null {
  const words: number[] = []
  for (const [index, part] of parts.entries()) {
    if (part.includes('.')) {
      if (index !== parts.length - 1) return null
      const ipv4 = parseIpv4(part)
      if (!ipv4) return null
      words.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!)
    } else {
      if (!/^[\da-f]{1,4}$/i.test(part)) return null
      words.push(parseInt(part, 16))
    }
  }
  return words
}

function isBlockedIpv6(bytes: number[]): boolean {
  const allZero = bytes.every((byte) => byte === 0)
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  const ipv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0)
  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  const wellKnownNat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b
    && bytes.slice(4, 12).every((byte) => byte === 0)
  const localNat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff
    && bytes[3] === 0x9b && bytes[4] === 0x00 && bytes[5] === 0x01
  if (mappedIpv4) return isBlockedIpv4(bytes.slice(12))
  if (wellKnownNat64) return isBlockedIpv4(bytes.slice(12))
  return allZero
    || loopback
    || ipv4Compatible
    || localNat64
    || (bytes[0]! & 0xfe) === 0xfc
    || (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80)
    || bytes[0] === 0xff
    || (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8)
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}
