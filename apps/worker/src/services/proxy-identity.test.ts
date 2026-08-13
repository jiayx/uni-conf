import { describe, expect, it } from 'vitest'
import {
  proxyConnectionFingerprint,
  sanitizeExportLabel,
  stableJsonStringify,
} from '@uni-conf/shared'

describe('proxy connection identity', () => {
  it('is stable across display metadata, JSON key order, host case, and IPv6 brackets', () => {
    const first = proxyConnectionFingerprint({
      protocol: 'trojan',
      server: 'EXAMPLE.COM',
      port: 443,
      parsedConfig: {
        protocol: 'trojan',
        server: 'EXAMPLE.COM',
        port: 443,
        password: 'secret',
        extra: { sni: 'example.com', alpn: ['h2', 'http/1.1'] },
      },
    })
    const second = proxyConnectionFingerprint({
      protocol: 'trojan',
      server: 'example.com',
      port: 443,
      parsedConfig: JSON.stringify({
        extra: { alpn: ['h2', 'http/1.1'], sni: 'example.com' },
        password: 'secret',
        port: 443,
        server: 'example.com',
        protocol: 'trojan',
        name: 'renamed node',
      }),
    })

    expect(first).toBe(second)
    expect(proxyConnectionFingerprint({
      protocol: 'wireguard',
      server: '[2001:DB8::1]',
      port: 51820,
      parsedConfig: { extra: { privateKey: 'a' } },
    })).toBe(proxyConnectionFingerprint({
      protocol: 'wireguard',
      server: '2001:db8::1',
      port: 51820,
      parsedConfig: { extra: { privateKey: 'a' } },
    }))
  })

  it('changes when connection-affecting credentials or tuning fields change', () => {
    const make = (password: string, congestionControl: string) => proxyConnectionFingerprint({
      protocol: 'tuic',
      server: 'tuic.example.com',
      port: 443,
      parsedConfig: { extra: { uuid: 'id', password, congestionControl } },
    })

    expect(make('old', 'bbr')).not.toBe(make('new', 'bbr'))
    expect(make('old', 'bbr')).not.toBe(make('old', 'cubic'))
  })

  it('provides stable JSON and neutralizes line-oriented config delimiters', () => {
    expect(stableJsonStringify({ z: 1, a: { y: 2, x: undefined } }))
      .toBe('{"a":{"y":2},"z":1}')
    expect(sanitizeExportLabel('Node\nInjected = bad,#comment;next'))
      .toBe('Node Injected ＝ bad，＃comment；next')
  })
})
