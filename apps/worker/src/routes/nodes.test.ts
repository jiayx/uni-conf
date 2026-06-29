import { describe, expect, it, vi } from 'vitest';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import nodesApp, { resolveManualNodeInput, validateManualNodeUpdate } from './nodes';

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => ({
    id: 'default-mihomo',
    token: 'default-token',
    format: 'mihomo',
  })),
}));

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

  it('initializes zero-setup defaults after creating a manual node', async () => {
    vi.clearAllMocks();
    const db = createManualNodeCreateMockDb();

    const response = await nodesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uri: 'trojan://password@de.example.com:443#🇩🇪 DE 01',
      }),
    }, { DB: db });
    const payload = await response.json() as { success: boolean; data: { name: string; countryCode?: string } };

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data).toMatchObject({ name: '🇩🇪 DE 01', countryCode: 'DE' });
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String));
  });

  it('rejects structured manual nodes that miss protocol-required fields', async () => {
    vi.clearAllMocks();
    const db = createManualNodeCreateMockDb();

    const response = await nodesApp.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'SS Missing Password',
        protocol: 'ss',
        server: 'ss.example.com',
        port: 8388,
      }),
    }, { DB: db });
    const payload = await response.json() as { success: boolean; error: string };

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      success: false,
      error: 'missing required protocol fields: password',
    });
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled();
  });

  it('initializes zero-setup defaults after updating a manual node', async () => {
    vi.clearAllMocks();
    const db = createManualNodeCreateMockDb();

    const response = await nodesApp.request('/node-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }, { DB: db });

    expect(response.status).toBe(200);
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String));
  });

  it('initializes zero-setup defaults after deleting a manual node', async () => {
    vi.clearAllMocks();
    const db = createManualNodeDeleteMockDb();

    const response = await nodesApp.request('/node-1', { method: 'DELETE' }, { DB: db });

    expect(response.status).toBe(200);
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String));
  });
});

function createManualNodeCreateMockDb(): D1Database {
  const inserted: Record<string, unknown> = {};
  return {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT id FROM sources WHERE id = ?')) return null;
          if (sql.includes('SELECT COUNT(*) as count FROM nodes WHERE source_id = ?')) return { count: 1 };
          if (sql.includes('SELECT * FROM nodes WHERE id = ?')) {
            return {
              id: args[0],
              source_id: inserted.source_id ?? 'manual',
              name: inserted.name ?? '🇩🇪 DE 01',
              protocol: inserted.protocol ?? 'trojan',
              server: inserted.server ?? 'de.example.com',
              port: inserted.port ?? 443,
              country: inserted.country ?? 'Germany',
              country_code: inserted.country_code ?? 'DE',
              enabled: 1,
              tags: inserted.tags ?? '[]',
              notes: null,
              raw_config: inserted.raw_config ?? '{"password":"password"}',
              parsed_config: inserted.parsed_config ?? '{"protocol":"trojan","server":"de.example.com","port":443,"password":"password","extra":{"password":"password"}}',
              is_manual: 1,
              created_at: inserted.created_at ?? '2026-01-01T00:00:00.000Z',
              updated_at: inserted.updated_at ?? '2026-01-01T00:00:00.000Z',
            };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO nodes')) {
            inserted.id = args[0];
            inserted.source_id = args[1];
            inserted.name = args[2];
            inserted.protocol = args[3];
            inserted.server = args[4];
            inserted.port = args[5];
            inserted.country = args[6];
            inserted.country_code = args[7];
            inserted.tags = args[9];
            inserted.raw_config = args[11];
            inserted.parsed_config = args[12];
            inserted.created_at = args[13];
            inserted.updated_at = args[14];
          }
          return { success: true };
        },
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}

function createManualNodeDeleteMockDb(): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT id, source_id, is_manual FROM nodes WHERE id = ?')) {
            return { id: args[0], source_id: 'manual', is_manual: 1 };
          }
          if (sql.includes('SELECT COUNT(*) as count FROM nodes WHERE source_id = ?')) return { count: 0 };
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
        raw: async () => [],
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}
