import { describe, expect, it } from 'vitest';
import { resolveManualNodeInput } from './nodes';

describe('manual node input', () => {
  it('resolves a node from a share URI', () => {
    const input = resolveManualNodeInput({
      uri: 'vless://12345678-1234-1234-1234-123456789012@us.example.com:443?security=reality&type=tcp&sni=example.com#🇺🇸 US 01',
    });

    expect(input).toMatchObject({
      name: '🇺🇸 US 01',
      protocol: 'vless',
      server: 'us.example.com',
      port: 443,
      country: 'United States',
      countryCode: 'US',
    });
    expect(input?.rawConfig).toMatchObject({
      sourceFormat: 'uri',
      uri: expect.stringContaining('vless://'),
    });
    expect(input?.parsedConfig).toMatchObject({
      protocol: 'vless',
      uuid: '12345678-1234-1234-1234-123456789012',
      tls: true,
      sni: 'example.com',
    });
  });

  it('keeps structured manual node input supported', () => {
    const input = resolveManualNodeInput({
      name: 'Manual Trojan',
      protocol: 'trojan',
      server: 'trojan.example.com',
      port: 443,
    });

    expect(input).toMatchObject({
      name: 'Manual Trojan',
      protocol: 'trojan',
      server: 'trojan.example.com',
      port: 443,
    });
  });

  it('rejects invalid manual input', () => {
    expect(resolveManualNodeInput({ uri: 'not-a-node' })).toBeNull();
    expect(resolveManualNodeInput({ name: 'Missing fields' })).toBeNull();
  });
});
