import { describe, expect, it, vi } from 'vitest';
import { ensureZeroSetupDefaults } from '../services/zero-setup';
import nodesApp, {
  normalizeNodeSearchQuery,
  resolveManualNodeInput,
  toNodeSummary,
  validateManualNodeUpdate,
  validateNodeBatchEnabledInput,
} from './nodes';
import { MAX_NODE_SEARCH_LENGTH } from '@uni-conf/shared';

vi.mock('../services/zero-setup', () => ({
  ensureZeroSetupDefaults: vi.fn(async () => ({
    id: 'default-mihomo',
    token: 'default-token',
    format: 'mihomo',
  })),
}));

describe('manual node input', () => {
  it('redacts credentials from list summaries while retaining routing metadata', () => {
    const summary = toNodeSummary({
      id: 'n1', sourceId: 's1', name: 'Node', protocol: 'trojan', server: 'example.com', port: 443,
      enabled: true, tags: [], rawConfig: { password: 'secret' },
      parsedConfig: { protocol: 'trojan', server: 'example.com', port: 443, password: 'secret', tls: true, extra: { password: 'secret' } },
      isManual: true, createdAt: 'now', updatedAt: 'now',
    });

    expect(summary.rawConfig).toEqual({});
    expect(summary.parsedConfig).toEqual({ protocol: 'trojan', server: 'example.com', port: 443, tls: true, network: undefined, extra: {} });
  });

  it('resolves a node from a share URI', () => {
    const input = resolveManualNodeInput({
      uri: 'vless://12345678-1234-1234-1234-123456789012@us.example.com:443?security=reality&type=tcp&sni=example.com&pbk=public-key&sid=abcd#🇺🇸 US 2x',
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
      extra: {
        publicKey: 'public-key',
        shortId: 'abcd',
      },
    });
  });

  it('resolves AnyTLS share URI manual nodes as a mainstream protocol', () => {
    const input = resolveManualNodeInput({
      uri: 'anytls://secret@hk.example.com:443?security=tls&sni=hk.example.com&alpn=h2,http/1.1&fp=chrome&udp=1#🇭🇰 HK AnyTLS 01',
    });

    expect(input).toMatchObject({
      name: '🇭🇰 HK AnyTLS 01',
      protocol: 'anytls',
      server: 'hk.example.com',
      port: 443,
      country: 'Hong Kong',
      countryCode: 'HK',
    });
    expect(input?.rawConfig).toMatchObject({
      sourceFormat: 'uri',
      uri: expect.stringContaining('anytls://'),
      password: 'secret',
      tls: true,
      sni: 'hk.example.com',
      alpn: 'h2,http/1.1',
    });
    expect(input?.parsedConfig).toMatchObject({
      protocol: 'anytls',
      server: 'hk.example.com',
      port: 443,
      password: 'secret',
      tls: true,
      sni: 'hk.example.com',
      extra: {
        clientFingerprint: 'chrome',
      },
    });
  });

  it('uses the overridden display name for URI manual node recognition', () => {
    const input = resolveManualNodeInput({
      uri: 'trojan://password@us.example.com:443#🇺🇸 US 01',
      name: '🇨🇦 Netflix CA 2x',
    });

    expect(input).toMatchObject({
      name: '🇨🇦 Netflix CA 2x',
      country: 'Canada',
      countryCode: 'CA',
      tags: expect.arrayContaining(['streaming', 'multiplier:2x', 'high-multiplier']),
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

  it('normalizes structured manual protocol fields like URI input', () => {
    const anytls = resolveManualNodeInput({
      name: '🇭🇰 Manual HK AnyTLS',
      protocol: 'anytls',
      server: 'hk.example.com',
      port: 443,
      rawConfig: {
        password: 'secret',
        sni: 'hk.example.com',
      },
    });
    const hysteria = resolveManualNodeInput({
      name: '🇸🇬 Manual SG Hysteria',
      protocol: 'hysteria',
      server: 'sg.example.com',
      port: 443,
      rawConfig: {
        auth: 'auth-secret',
        sni: 'sg.example.com',
      },
    });

    expect(anytls?.parsedConfig).toMatchObject({
      protocol: 'anytls',
      server: 'hk.example.com',
      port: 443,
      password: 'secret',
      tls: true,
      sni: 'hk.example.com',
      extra: {
        password: 'secret',
        sni: 'hk.example.com',
      },
    });
    expect(hysteria?.parsedConfig).toMatchObject({
      protocol: 'hysteria',
      server: 'sg.example.com',
      port: 443,
      password: 'auth-secret',
      tls: true,
      sni: 'sg.example.com',
      extra: {
        auth: 'auth-secret',
        sni: 'sg.example.com',
      },
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
      enabled: false,
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
      enabled: false,
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
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default');
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
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default');
  });

  it('allows subscription nodes to be disabled without changing their source-owned config', async () => {
    vi.clearAllMocks();
    const db = createManualNodeCreateMockDb(false);

    const response = await nodesApp.request('/node-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }, { DB: db });
    const payload = await response.json() as { success: boolean; data: { enabled: boolean } };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, data: { enabled: false } });
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default');
  });

  it('keeps parsedConfig core fields aligned when updating manual node address fields', async () => {
    vi.clearAllMocks();
    const db = createManualNodeCreateMockDb();

    const response = await nodesApp.request('/node-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        server: 'new.example.com',
        port: 8443,
      }),
    }, { DB: db });

    expect(response.status).toBe(200);
    expect(readUpdatedParsedConfig(db)).toMatchObject({
      protocol: 'trojan',
      server: 'new.example.com',
      port: 8443,
      password: 'password',
    });
  });

  it('re-detects country and recognition tags when a manual node is renamed', async () => {
    vi.clearAllMocks();
    const db = createManualNodeCreateMockDb();

    const response = await nodesApp.request('/node-1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '🇨🇦 Netflix CA 2x' }),
    }, { DB: db });
    const payload = await response.json() as { success: boolean; data: { countryCode?: string; tags?: string[] } };
    const update = readUpdatedNodeWrite(db);

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ countryCode: 'CA' });
    expect(update).toMatchObject({
      name: '🇨🇦 Netflix CA 2x',
      country: 'Canada',
      countryCode: 'CA',
    });
    expect(update.tags).toEqual(expect.arrayContaining(['streaming', 'multiplier:2x', 'high-multiplier']));
  });

  it('initializes zero-setup defaults after deleting a manual node', async () => {
    vi.clearAllMocks();
    const db = createManualNodeDeleteMockDb();

    const response = await nodesApp.request('/node-1', { method: 'DELETE' }, { DB: db });

    expect(response.status).toBe(200);
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default');
  });

  it('validates and deduplicates batch enable input', () => {
    expect(validateNodeBatchEnabledInput({ ids: [' node-1 ', 'node-1', 'node-2'], enabled: false }))
      .toEqual({ valid: true, ids: ['node-1', 'node-2'], enabled: false });
    expect(validateNodeBatchEnabledInput({ ids: [], enabled: true })).toEqual({
      valid: false,
      error: 'ids must contain between 1 and 500 node ids',
    });
    expect(validateNodeBatchEnabledInput({ ids: ['node-1'], enabled: 'yes' })).toEqual({
      valid: false,
      error: 'enabled must be a boolean',
    });
  });

  it('updates selected nodes in one D1 batch and resynchronizes zero-setup defaults', async () => {
    vi.clearAllMocks();
    const db = createNodeBatchMockDb(['node-1', 'node-2']);

    const response = await nodesApp.request('/batch-enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['node-1', 'node-2'], enabled: false }),
    }, { DB: db });
    const payload = await response.json() as {
      success: boolean;
      data: { ids: string[]; enabled: boolean; updatedCount: number };
    };

    expect(response.status).toBe(200);
    expect(payload.data).toEqual({
      ids: ['node-1', 'node-2'],
      enabled: false,
      updatedCount: 2,
    });
    expect((db as unknown as { __batch: ReturnType<typeof vi.fn> }).__batch).toHaveBeenCalledOnce();
    expect(ensureZeroSetupDefaults).toHaveBeenCalledWith(db, expect.any(String), 'default');
  });

  it('rejects a batch when any selected node no longer exists', async () => {
    vi.clearAllMocks();
    const db = createNodeBatchMockDb(['node-1']);

    const response = await nodesApp.request('/batch-enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['node-1', 'missing-node'], enabled: true }),
    }, { DB: db });

    expect(response.status).toBe(404);
    expect((db as unknown as { __batch: ReturnType<typeof vi.fn> }).__batch).not.toHaveBeenCalled();
    expect(ensureZeroSetupDefaults).not.toHaveBeenCalled();
  });
});

describe('node listing', () => {
  it('uses bounded instr search instead of LIKE patterns', async () => {
    vi.clearAllMocks();
    const executed: Array<{ sql: string; args: unknown[] }> = [];
    const db = createNodeListMockDb(executed);
    const search = 'trojan://password@example.com:443?'.repeat(40);

    const response = await nodesApp.request(`/?search=${encodeURIComponent(search)}`, {}, { DB: db });

    expect(response.status).toBe(200);
    expect(executed.some((item) => item.sql.includes('LIKE'))).toBe(false);
    expect(executed.some((item) => item.sql.includes('instr(lower(name), lower(?)) > 0'))).toBe(true);
    expect(executed[0]?.args[0]).toBe('default');
    expect(executed[0]?.args[1]).toBe(search.slice(0, MAX_NODE_SEARCH_LENGTH));
  });

  it('normalizes node search input before it reaches SQLite', () => {
    expect(normalizeNodeSearchQuery(`  ${'a'.repeat(MAX_NODE_SEARCH_LENGTH + 20)}  `)).toBe('a'.repeat(MAX_NODE_SEARCH_LENGTH));
    expect(normalizeNodeSearchQuery(undefined)).toBe('');
  });
});

function createManualNodeCreateMockDb(isManual = true): D1Database {
  const inserted: Record<string, unknown> = {};
  const updated: Record<string, unknown> = {};
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
              name: updated.name ?? inserted.name ?? '🇩🇪 DE 01',
              protocol: inserted.protocol ?? 'trojan',
              server: inserted.server ?? 'de.example.com',
              port: inserted.port ?? 443,
              country: updated.country ?? inserted.country ?? 'Germany',
              country_code: updated.country_code ?? inserted.country_code ?? 'DE',
              enabled: updated.enabled ?? 1,
              tags: updated.tags ?? inserted.tags ?? '[]',
              notes: null,
              raw_config: inserted.raw_config ?? '{"password":"password"}',
              parsed_config: updated.parsed_config ?? inserted.parsed_config ?? '{"protocol":"trojan","server":"de.example.com","port":443,"password":"password","extra":{"password":"password"}}',
              is_manual: isManual ? 1 : 0,
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
          if (sql.includes('UPDATE nodes SET enabled = ?, updated_at = ?')) {
            updated.enabled = args[0];
          } else if (sql.includes('UPDATE nodes SET')) {
            updated.name = args[0];
            updated.country = args[4];
            updated.country_code = args[5];
            updated.tags = args[7];
            updated.parsed_config = args[10];
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
    __updated: updated,
  } as unknown as D1Database;
}

function createNodeListMockDb(executed: Array<{ sql: string; args: unknown[] }>): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => {
        executed.push({ sql, args });
        return {
          first: async () => ({ total: 0 }),
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
          raw: async () => [],
        };
      },
      first: async () => ({ total: 0 }),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
  } as unknown as D1Database;
}

function readUpdatedParsedConfig(db: D1Database): Record<string, unknown> {
  const updated = (db as unknown as { __updated: Record<string, unknown> }).__updated;
  return JSON.parse(String(updated.parsed_config ?? '{}')) as Record<string, unknown>;
}

function readUpdatedNodeWrite(db: D1Database): {
  name?: unknown;
  country?: unknown;
  countryCode?: unknown;
  tags: string[];
} {
  const updated = (db as unknown as { __updated: Record<string, unknown> }).__updated;
  return {
    name: updated.name,
    country: updated.country,
    countryCode: updated.country_code,
    tags: JSON.parse(String(updated.tags ?? '[]')) as string[],
  };
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

function createNodeBatchMockDb(existingIds: string[]): D1Database {
  const batch = vi.fn(async () => []);
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => null,
        all: async () => ({
          results: sql.includes('SELECT id FROM nodes')
            ? existingIds.filter(id => args.includes(id)).map(id => ({ id }))
            : [],
        }),
        run: async () => ({ success: true }),
        raw: async () => [],
        __sql: sql,
        __args: args,
      }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true }),
      raw: async () => [],
    })),
    batch,
    __batch: batch,
  };
  return db as unknown as D1Database;
}
