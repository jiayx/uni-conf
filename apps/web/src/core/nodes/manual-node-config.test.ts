import { describe, expect, it } from 'vitest'
import { buildManualNodeParsedConfig, compactManualNodeExtra } from './manual-node-config'

describe('manual node config helpers', () => {
  it('keeps every protocol registry field in parsedConfig.extra for structured manual input', () => {
    const extra = compactManualNodeExtra({
      password: 'secret',
      clientFingerprint: 'chrome',
      alpn: ['h2', 'http/1.1'],
      sni: 'example.com',
      tls: true,
      skipCertVerify: false,
      udp: true,
      empty: '',
    })
    const parsed = buildManualNodeParsedConfig('anytls', 'hk.example.com', 443, extra)

    expect(parsed).toMatchObject({
      protocol: 'anytls',
      server: 'hk.example.com',
      port: 443,
      password: 'secret',
      tls: true,
      sni: 'example.com',
      skipCertVerify: false,
      extra: {
        password: 'secret',
        clientFingerprint: 'chrome',
        alpn: ['h2', 'http/1.1'],
        sni: 'example.com',
        tls: true,
        skipCertVerify: false,
        udp: true,
      },
    })
    expect(parsed.extra).not.toHaveProperty('empty')
  })

  it('derives top-level TLS fields from VLESS REALITY form values while preserving native details', () => {
    const parsed = buildManualNodeParsedConfig('vless', 'us.example.com', 443, {
      uuid: '12345678-1234-1234-1234-123456789012',
      security: 'reality',
      sni: 'www.example.com',
      publicKey: 'public-key',
      shortId: 'abcd',
      flow: 'xtls-rprx-vision',
    })

    expect(parsed).toMatchObject({
      protocol: 'vless',
      uuid: '12345678-1234-1234-1234-123456789012',
      tls: true,
      sni: 'www.example.com',
      extra: {
        security: 'reality',
        publicKey: 'public-key',
        shortId: 'abcd',
        flow: 'xtls-rprx-vision',
      },
    })
  })
})
