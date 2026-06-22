import { describe, expect, it } from 'vitest';
import { resolveManualNodeInput } from './nodes';

describe('manual node input', () => {
  it('resolves a node from a share URI', () => {
    const input = resolveManualNodeInput({
      uri: 'vless://12345678-1234-1234-1234-123456789012@us.example.com:443?security=reality&type=tcp&sni=example.com#🇺🇸 US 2x',
    });

    expect(input).toMatchObject({
      name: '🇺🇸 US 2x',
      protocol: 'vless',
      server: 'us.example.com',
      port: 443,
      country: 'United States',
      countryCode: 'US',
      tags: ['multiplier:2x', 'high-multiplier'],
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
      name: '🇩🇪 Manual DE Trojan x1',
      protocol: 'trojan',
      server: 'trojan.example.com',
      port: 443,
    });

    expect(input).toMatchObject({
      name: '🇩🇪 Manual DE Trojan x1',
      protocol: 'trojan',
      server: 'trojan.example.com',
      port: 443,
      country: 'Germany',
      countryCode: 'DE',
      tags: ['multiplier:1x'],
    });
  });

  it('does not override explicit structured manual country fields', () => {
    const input = resolveManualNodeInput({
      name: '🇩🇪 Override Region',
      protocol: 'trojan',
      server: 'trojan.example.com',
      port: 443,
      country: 'Custom Region',
      countryCode: 'CR',
    });

    expect(input).toMatchObject({
      country: 'Custom Region',
      countryCode: 'CR',
    });
  });

  it('rejects invalid manual input', () => {
    expect(resolveManualNodeInput({ uri: 'not-a-node' })).toBeNull();
    expect(resolveManualNodeInput({ name: 'Missing fields' })).toBeNull();
  });
});
