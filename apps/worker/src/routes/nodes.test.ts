import { describe, expect, it } from 'vitest';
import { resolveManualNodeInput, validateManualNodeUpdate } from './nodes';

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
    expect(resolveManualNodeInput({
      name: 'Bad Protocol',
      protocol: 'unknown',
      server: 'example.com',
      port: 443,
    })).toBeNull();
    expect(resolveManualNodeInput({
      name: 'Bad Port',
      protocol: 'trojan',
      server: 'example.com',
      port: 70000,
    })).toBeNull();
    expect(resolveManualNodeInput({
      uri: 'trojan://password@example.com:443#OK',
      protocol: 'direct',
    })).toBeNull();
  });

  it('validates manual node updates', () => {
    expect(validateManualNodeUpdate({
      name: '  HK Manual  ',
      protocol: 'trojan',
      server: ' hk.example.com ',
      port: '443',
      countryCode: 'hk',
      tags: [' streaming ', 'streaming', ''],
      notes: ' note ',
      rawConfig: { type: 'trojan' },
      parsedConfig: { protocol: 'trojan' },
    })).toEqual({
      valid: true,
      name: 'HK Manual',
      protocol: 'trojan',
      server: 'hk.example.com',
      port: 443,
      country: undefined,
      countryCode: 'HK',
      enabled: undefined,
      tags: ['streaming'],
      notes: 'note',
      rawConfig: { type: 'trojan' },
      parsedConfig: { protocol: 'trojan' },
    });

    expect(validateManualNodeUpdate({ protocol: 'unknown' })).toEqual({
      valid: false,
      error: 'invalid proxy protocol',
    });
    expect(validateManualNodeUpdate({ port: 0 })).toEqual({
      valid: false,
      error: 'port must be an integer between 1 and 65535',
    });
    expect(validateManualNodeUpdate({ tags: ['ok', 1] })).toEqual({
      valid: false,
      error: 'tags must be an array of strings',
    });
    expect(validateManualNodeUpdate({ parsedConfig: [] })).toEqual({
      valid: false,
      error: 'parsedConfig must be an object',
    });
  });
});
