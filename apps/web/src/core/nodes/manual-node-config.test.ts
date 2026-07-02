import { describe, expect, it } from 'vitest'
import {
  buildManualNodeParsedConfig,
  compactManualNodeExtra,
  completeManualNodeExtra,
  getMissingRequiredManualNodeFields,
} from './manual-node-config'

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

  it('treats implicit TLS protocols like URI parsing for structured manual input', () => {
    expect(buildManualNodeParsedConfig('anytls', 'hk.example.com', 443, {
      password: 'secret',
    })).toMatchObject({
      protocol: 'anytls',
      password: 'secret',
      tls: true,
    })

    expect(buildManualNodeParsedConfig('hysteria', 'sg.example.com', 443, {
      auth: 'auth-secret',
    })).toMatchObject({
      protocol: 'hysteria',
      password: 'auth-secret',
      tls: true,
      extra: {
        auth: 'auth-secret',
      },
    })
  })

  it('reports missing required fields from the protocol registry', () => {
    expect(completeManualNodeExtra('ss', {})).toMatchObject({ method: 'aes-256-gcm' })
    expect(getMissingRequiredManualNodeFields('ss', {})).toEqual(['Password'])
    expect(getMissingRequiredManualNodeFields('anytls', {
      password: '',
      clientFingerprint: 'chrome',
    })).toEqual(['Password'])
    expect(getMissingRequiredManualNodeFields('tuic', {
      uuid: '12345678-1234-1234-1234-123456789012',
      password: 'secret',
    })).toEqual([])
  })
})
