import { Hono } from 'hono';
import { load as parseYAML } from 'js-yaml';
import type { Env } from '../types';
import {
  jsonStringify,
  mapSource,
  newId,
  now,
} from '../db/helpers';
import { detectCountry } from '@uni-conf/shared';
import { MIHOMO_TYPE_TO_PROTOCOL, SINGBOX_TYPE_TO_PROTOCOL, URI_SCHEME_TO_PROTOCOL } from '@uni-conf/types';
import type { ProxyProtocol, NormalizedProxyConfig, SourceNodeGroup } from '@uni-conf/types';

const app = new Hono<{ Bindings: Env }>();

// ─── List all sources ─────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, type, url, format, enabled, node_count, last_updated,
      update_interval, user_agent, notes, tags, source_groups,
      upload_bytes, download_bytes, total_bytes, expire_time,
      created_at, updated_at
     FROM sources ORDER BY created_at DESC`
  ).all();
  const sources = (results as Record<string, unknown>[]).map(mapSource);
  return c.json({ success: true, data: sources });
});

// ─── Create source ─────────────────────────────────────────────────────────────

app.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    type: string;
    url?: string;
    format?: string;
    enabled?: boolean;
    updateInterval?: number;
    userAgent?: string;
    notes?: string;
    tags?: string[];
  }>();

  if (!body.name || !body.type) {
    return c.json({ success: false, error: 'name and type are required' }, 400);
  }

  const id = newId();
  const ts = now();

  await c.env.DB.prepare(
    `INSERT INTO sources (id, name, type, url, format, enabled, node_count, last_updated, update_interval, user_agent, notes, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.name,
      body.type,
      body.url ?? null,
      body.format ?? 'auto',
      body.enabled !== false ? 1 : 0,
      body.updateInterval ?? 0,
      body.userAgent ?? null,
      body.notes ?? null,
      jsonStringify(body.tags ?? []),
      ts,
      ts
    )
    .run();

  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapSource(row!) }, 201);
});

// ─── Get source ───────────────────────────────────────────────────────────────

app.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Source not found' }, 404);
  return c.json({ success: true, data: mapSource(row) });
});

// ─── Update source ────────────────────────────────────────────────────────────

app.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!existing) return c.json({ success: false, error: 'Source not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();
  const ts = now();

  await c.env.DB.prepare(
    `UPDATE sources SET
      name = ?, type = ?, url = ?, format = ?, enabled = ?,
      update_interval = ?, user_agent = ?, notes = ?, tags = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.name ?? existing.name,
      body.type ?? existing.type,
      body.url !== undefined ? body.url : existing.url,
      body.format ?? existing.format,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
      body.updateInterval !== undefined ? body.updateInterval : existing.update_interval,
      // Allow explicitly setting to null or empty string to clear user_agent
      'userAgent' in body ? (body.userAgent || null) : existing.user_agent,
      body.notes !== undefined ? body.notes : existing.notes,
      body.tags !== undefined ? jsonStringify(body.tags) : existing.tags,
      ts,
      id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  return c.json({ success: true, data: mapSource(updated!) });
});

// ─── Delete source (nodes cascade via FK) ─────────────────────────────────────

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM sources WHERE id = ?')
    .bind(id)
    .first();

  if (!existing) return c.json({ success: false, error: 'Source not found' }, 404);

  await c.env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: { id } });
});

// ─── Refresh source ───────────────────────────────────────────────────────────

app.post('/:id/refresh', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM sources WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();

  if (!row) return c.json({ success: false, error: 'Source not found' }, 404);
  if (!row.url) {
    return c.json({ success: false, error: 'Source has no URL to fetch' }, 400);
  }

  // Use mainstream client User-Agent to avoid 502 errors from airport servers
  // that check UA for anti-crawler protection
  // Based on sub-store's default: https://github.com/sub-store-org/Sub-Store
  const defaultUserAgent = 'clash.meta/v1.19.23';

  let rawContent: string;
  let subscriptionInfo: {
    uploadBytes?: number;
    downloadBytes?: number;
    totalBytes?: number;
    expireTime?: number;
  } = {};

  try {
    const response = await fetch(row.url as string, {
      headers: {
        'User-Agent': (row.user_agent as string | null) ?? defaultUserAgent,
        Accept: '*/*',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse subscription-userinfo header if present
    const userInfoHeader = response.headers.get('subscription-userinfo');
    if (userInfoHeader) {
      const parts = userInfoHeader.split(';').map(p => p.trim());
      for (const part of parts) {
        const [key, value] = part.split('=').map(s => s.trim());
        if (key && value) {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue)) {
            if (key === 'upload') subscriptionInfo.uploadBytes = numValue;
            else if (key === 'download') subscriptionInfo.downloadBytes = numValue;
            else if (key === 'total') subscriptionInfo.totalBytes = numValue;
            else if (key === 'expire') subscriptionInfo.expireTime = numValue;
          }
        }
      }
    }

    rawContent = await response.text();
  } catch (err) {
    return c.json(
      { success: false, error: `Failed to fetch URL: ${String(err)}` },
      502
    );
  }

  // Detect format and parse nodes
  const { nodes: parsedNodes, groups: parsedGroups, format } = detectAndParse(rawContent);
  if (parsedNodes.length === 0) {
    return c.json(
      { success: false, error: `No proxy nodes parsed from source content (detected format: ${format})` },
      422
    );
  }

  // Load existing nodes for this source to compute diff
  const { results: existingRows } = await c.env.DB.prepare(
    'SELECT id, name, server, port, protocol, country, country_code, raw_config, parsed_config FROM nodes WHERE source_id = ? AND is_manual = 0'
  )
    .bind(id)
    .all<{
      id: string;
      name: string;
      server: string;
      port: number;
      protocol: string;
      country: string | null;
      country_code: string | null;
      raw_config: string | null;
      parsed_config: string | null;
    }>();

  const existingByKey = new Map(existingRows.map((r) => [`${r.server}:${r.port}:${r.name}`, r]));

  const addedNodes: typeof parsedNodes = [];
  const updatedNodes: Array<{ id: string; node: ParsedNodeRaw }> = [];
  const seenKeys = new Set<string>();

  for (const node of parsedNodes) {
    const key = `${node.server}:${node.port}:${node.name}`;
    if (seenKeys.has(key)) continue;

    const existing = existingByKey.get(key);
    if (existing) {
      if (shouldUpdateNode(existing, node)) {
        updatedNodes.push({ id: existing.id, node });
      }
    } else {
      addedNodes.push(node);
    }
    seenKeys.add(key);
  }

  // Identify nodes to remove (were from this source, not in new set)
  const newKeys = new Set(parsedNodes.map((n) => `${n.server}:${n.port}:${n.name}`));
  const toRemove = existingRows.filter(
    (r) => !newKeys.has(`${r.server}:${r.port}:${r.name}`)
  );

  const ts = now();

  // Insert added nodes
  for (const node of addedNodes) {
    const nodeId = newId();
    await c.env.DB.prepare(
      `INSERT INTO nodes (id, source_id, name, protocol, server, port, country, country_code, enabled, tags, notes, raw_config, parsed_config, is_manual, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '[]', NULL, ?, ?, 0, ?, ?)`
    )
      .bind(
        nodeId,
        id,
        node.name,
        node.protocol,
        node.server,
        node.port,
        node.country ?? null,
        node.countryCode ?? null,
        jsonStringify(node.rawConfig),
        jsonStringify(node.parsedConfig),
        ts,
        ts
      )
      .run();
  }

  // Update existing nodes whose identity is unchanged but config may have changed
  for (const item of updatedNodes) {
    await c.env.DB.prepare(
      `UPDATE nodes SET
        protocol = ?, country = ?, country_code = ?, raw_config = ?, parsed_config = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        item.node.protocol,
        item.node.country ?? null,
        item.node.countryCode ?? null,
        jsonStringify(item.node.rawConfig),
        jsonStringify(item.node.parsedConfig),
        ts,
        item.id
      )
      .run();
  }

  // Delete removed nodes
  for (const rem of toRemove) {
    await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(rem.id).run();
  }

  // Update source node_count, last_updated, and subscription info
  const { results: countResult } = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM nodes WHERE source_id = ?'
  )
    .bind(id)
    .all<{ cnt: number }>();

  const nodeCount = countResult[0]?.cnt ?? parsedNodes.length;

  await c.env.DB.prepare(
    `UPDATE sources SET
      node_count = ?,
      last_updated = ?,
      upload_bytes = ?,
      download_bytes = ?,
      total_bytes = ?,
      expire_time = ?,
      source_groups = ?,
      raw_content = ?,
      updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nodeCount,
      ts,
      subscriptionInfo.uploadBytes ?? null,
      subscriptionInfo.downloadBytes ?? null,
      subscriptionInfo.totalBytes ?? null,
      subscriptionInfo.expireTime ?? null,
      jsonStringify(parsedGroups),
      rawContent,
      ts,
      id
    )
    .run();

  return c.json({
    success: true,
    data: {
      sourceId: id,
      success: true,
      nodeCount,
      addedCount: addedNodes.length,
      updatedCount: updatedNodes.length,
      removedCount: toRemove.length,
      sourceGroupCount: parsedGroups.length,
      format,
    },
  });
});

// ─── Format detection & parsing ───────────────────────────────────────────────

interface ParsedNodeRaw {
  name: string;
  protocol: ProxyProtocol;
  server: string;
  port: number;
  country?: string;
  countryCode?: string;
  rawConfig: Record<string, unknown>;
  parsedConfig: NormalizedProxyConfig;
}

function countryFields(name: string): Pick<ParsedNodeRaw, 'country' | 'countryCode'> {
  const countryInfo = detectCountry(name);
  return {
    country: countryInfo?.country,
    countryCode: countryInfo?.countryCode,
  };
}

function detectAndParse(raw: string): { nodes: ParsedNodeRaw[]; groups: SourceNodeGroup[]; format: string } {
  const trimmed = raw.trim();

  // Try YAML (Clash/Mihomo format)
  if (trimmed.startsWith('proxies:') || trimmed.includes('\nproxies:')) {
    const nodes = parseClashYaml(trimmed);
    const groups = parseClashGroups(trimmed);
    return { nodes, groups, format: 'mihomo' };
  }

  // Try JSON (sing-box format)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const nodes = parseSingboxJson(parsed);
      const groups = parseSingboxGroups(parsed);
      return { nodes, groups, format: 'singbox' };
    } catch {
      // Not valid JSON
    }
  }

  // Try base64
  try {
    const decoded = atob(trimmed.replace(/\s/g, ''));
    const lines = decoded.split('\n').filter((l) => l.trim().length > 0);
    const nodes = parseRawLines(lines);
    if (nodes.length > 0) return { nodes, groups: [], format: 'base64' };
  } catch {
    // Not base64
  }

  // Raw URI lines
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  const nodes = parseRawLines(lines);
  return { nodes, groups: [], format: 'raw' };
}

function shouldUpdateNode(
  existing: {
    protocol: string;
    country: string | null;
    country_code: string | null;
    raw_config: string | null;
    parsed_config: string | null;
  },
  next: ParsedNodeRaw
): boolean {
  return existing.protocol !== next.protocol ||
    (existing.country ?? null) !== (next.country ?? null) ||
    (existing.country_code ?? null) !== (next.countryCode ?? null) ||
    existing.raw_config !== jsonStringify(next.rawConfig) ||
    existing.parsed_config !== jsonStringify(next.parsedConfig);
}

export function parseClashYaml(content: string): ParsedNodeRaw[] {
  // Use full YAML parser for robust handling of all edge cases
  const nodes: ParsedNodeRaw[] = [];

  try {
    const doc = parseYAML(content);
    if (!doc || typeof doc !== 'object') return nodes;

    const proxies = (doc as Record<string, unknown>).proxies;
    if (!Array.isArray(proxies)) return nodes;

    for (const proxy of proxies) {
      if (!proxy || typeof proxy !== 'object') continue;

      const proxyObj = proxy as Record<string, unknown>;
      const name = proxyObj.name;
      const type = proxyObj.type;
      const server = proxyObj.server;
      const port = proxyObj.port;

      // Skip entries missing required fields
      if (!name || !type || !server || !port) continue;

      const nameStr = String(name).trim();
      const typeStr = String(type).trim().toLowerCase();
      const serverStr = String(server).trim();
      const portNum = typeof port === 'number' ? port : parseInt(String(port), 10);

      if (!nameStr || !serverStr || isNaN(portNum)) continue;

      const protocol = clashTypeToProtocol(typeStr);
      const rawConfig = proxyObj;

      nodes.push({
        name: nameStr,
        protocol,
        server: serverStr,
        port: portNum,
        ...countryFields(nameStr),
        rawConfig,
        parsedConfig: buildParsedConfig(protocol, serverStr, portNum, rawConfig),
      });
    }
  } catch (err) {
    console.error('YAML parse error:', err);
    // Return empty array on parse error
  }

  return nodes;
}

export function parseClashGroups(content: string): SourceNodeGroup[] {
  try {
    const doc = parseYAML(content);
    if (!doc || typeof doc !== 'object') return [];

    const groups = (doc as Record<string, unknown>)['proxy-groups'];
    if (!Array.isArray(groups)) return [];

    return groups
      .map((group) => {
        if (!group || typeof group !== 'object') return null;
        const groupObj = group as Record<string, unknown>;
        const name = String(groupObj.name ?? '').trim();
        if (!name) return null;

        const proxies = Array.isArray(groupObj.proxies) ? groupObj.proxies : [];
        const memberNames = proxies
          .map((item) => String(item ?? '').trim())
          .filter((item) => item && item !== 'DIRECT' && item !== 'REJECT');

        const result: SourceNodeGroup = {
          name,
          type: groupObj.type ? String(groupObj.type) : undefined,
          memberNames,
        };
        return result;
      })
      .filter((group): group is SourceNodeGroup => group !== null && group.memberNames.length > 0);
  } catch {
    return [];
  }
}

function clashTypeToProtocol(type: string): ProxyProtocol {
  return MIHOMO_TYPE_TO_PROTOCOL[type] ?? (type === 'hy2' ? 'hysteria2' : 'unknown');
}

function parseSingboxJson(data: Record<string, unknown>): ParsedNodeRaw[] {
  const nodes: ParsedNodeRaw[] = [];
  const outbounds = data.outbounds as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(outbounds)) return nodes;

  const proxyTypes = new Set([
    'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic',
    'anytls', 'wireguard', 'socks', 'http', 'ssh', 'shadowtls',
  ]);

  for (const ob of outbounds) {
    const type = (ob.type as string | undefined)?.toLowerCase() ?? '';
    if (!proxyTypes.has(type)) continue;

    const name = (ob.tag as string | null) ?? 'Unknown';
    const server = (ob.server as string | null) ?? '';
    const port = (ob.server_port as number | null) ?? 0;
    if (!server || !port) continue;

    const protocol = singboxTypeToProtocol(type);
    nodes.push({
      name,
      protocol,
      server,
      port,
      ...countryFields(name),
      rawConfig: ob,
      parsedConfig: buildParsedConfig(protocol, server, port, ob),
    });
  }

  return nodes;
}

function parseSingboxGroups(data: Record<string, unknown>): SourceNodeGroup[] {
  const outbounds = data.outbounds as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(outbounds)) return [];

  const groupTypes = new Set(['selector', 'urltest', 'url-test', 'loadbalance', 'load-balance']);
  return outbounds
    .map((outbound) => {
      const type = String(outbound.type ?? '').toLowerCase();
      if (!groupTypes.has(type)) return null;

      const name = String(outbound.tag ?? '').trim();
      if (!name) return null;

      const members = Array.isArray(outbound.outbounds) ? outbound.outbounds : [];
      const memberNames = members
        .map((item) => String(item ?? '').trim())
        .filter((item) => item && item !== 'direct' && item !== 'block');

      const result: SourceNodeGroup = {
        name,
        type,
        memberNames,
      };
      return result;
    })
    .filter((group): group is SourceNodeGroup => group !== null && group.memberNames.length > 0);
}

function singboxTypeToProtocol(type: string): ProxyProtocol {
  return SINGBOX_TYPE_TO_PROTOCOL[type] ?? 'unknown';
}

function parseRawLines(lines: string[]): ParsedNodeRaw[] {
  const nodes: ParsedNodeRaw[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      if (trimmed.startsWith('vmess://')) {
        const node = parseVmessUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('ss://')) {
        const node = parseSsUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('trojan://')) {
        const node = parseTrojanUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('vless://')) {
        const node = parseVlessUri(trimmed);
        if (node) nodes.push(node);
      } else if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) {
        const node = parseHysteria2Uri(trimmed);
        if (node) nodes.push(node);
      } else if (
        trimmed.startsWith('hysteria://') ||
        trimmed.startsWith('hy://') ||
        trimmed.startsWith('tuic://') ||
        trimmed.startsWith('anytls://') ||
        trimmed.startsWith('shadowtls://') ||
        trimmed.startsWith('wireguard://') ||
        trimmed.startsWith('wg://') ||
        trimmed.startsWith('ssh://') ||
        trimmed.startsWith('naive://') ||
        trimmed.startsWith('naive+https://') ||
        trimmed.startsWith('socks://') ||
        trimmed.startsWith('socks5://') ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://')
      ) {
        const node = parseGenericUrlUri(trimmed);
        if (node) nodes.push(node);
      }
    } catch {
      // Skip malformed URIs
    }
  }

  return nodes;
}

function parseVmessUri(uri: string): ParsedNodeRaw | null {
  const b64 = uri.replace('vmess://', '');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(atob(b64)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const name = (data.ps as string | null) ?? 'VMess';
  const server = (data.add as string | null) ?? '';
  const port = parseInt(String(data.port ?? 0), 10);
  if (!server || !port) return null;

  return {
    name,
    protocol: 'vmess',
    server,
    port,
    ...countryFields(name),
    rawConfig: data,
    parsedConfig: {
      protocol: 'vmess',
      server,
      port,
      uuid: data.id as string,
      tls: data.tls === 'tls',
      sni: data.sni as string | undefined,
      network: (data.net as string | undefined) as NormalizedProxyConfig['network'],
      wsPath: data.path as string | undefined,
      wsHeaders: getVmessWsHeaders(data),
      extra: data,
    },
  };
}

function parseSsUri(uri: string): ParsedNodeRaw | null {
  // ss://BASE64@host:port#name or ss://BASE64(method:pass@host:port)#name
  const hashIdx = uri.indexOf('#');
  const name = hashIdx >= 0 ? decodeURIComponent(uri.slice(hashIdx + 1)) : 'SS';
  const main = hashIdx >= 0 ? uri.slice(5, hashIdx) : uri.slice(5);

  let server: string;
  let port: number;
  let method: string;
  let password: string;

  if (main.includes('@')) {
    // ss://BASE64(method:pass)@host:port
    const atIdx = main.lastIndexOf('@');
    const credPart = main.slice(0, atIdx);
    const hostPart = main.slice(atIdx + 1);

    let creds: string;
    try {
      creds = atob(credPart);
    } catch {
      creds = credPart;
    }

    const colonIdx = creds.indexOf(':');
    method = creds.slice(0, colonIdx);
    password = creds.slice(colonIdx + 1);

    const lastColon = hostPart.lastIndexOf(':');
    server = hostPart.slice(0, lastColon);
    port = parseInt(hostPart.slice(lastColon + 1), 10);
  } else {
    // ss://BASE64
    let decoded: string;
    try {
      decoded = atob(main);
    } catch {
      return null;
    }
    const atIdx = decoded.lastIndexOf('@');
    const creds = decoded.slice(0, atIdx);
    const hostPart = decoded.slice(atIdx + 1);
    const colonIdx = creds.indexOf(':');
    method = creds.slice(0, colonIdx);
    password = creds.slice(colonIdx + 1);
    const lastColon = hostPart.lastIndexOf(':');
    server = hostPart.slice(0, lastColon);
    port = parseInt(hostPart.slice(lastColon + 1), 10);
  }

  if (!server || !port) return null;

  const rawConfig = { method, password };
  return {
    name,
    protocol: 'ss',
    server,
    port,
    ...countryFields(name),
    rawConfig,
    parsedConfig: {
      protocol: 'ss',
      server,
      port,
      password,
      extra: rawConfig,
    },
  };
}

function parseTrojanUri(uri: string): ParsedNodeRaw | null {
  const url = new URL(uri.replace('trojan://', 'https://'));
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : 'Trojan';
  const server = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const password = url.username;

  if (!server || !port) return null;

  const rawConfig: Record<string, unknown> = {
    password,
    sni: url.searchParams.get('sni') ?? undefined,
    skipCertVerify: url.searchParams.get('allowInsecure') === '1',
  };

  return {
    name,
    protocol: 'trojan',
    server,
    port,
    ...countryFields(name),
    rawConfig,
    parsedConfig: {
      protocol: 'trojan',
      server,
      port,
      password,
      tls: true,
      sni: rawConfig.sni as string | undefined,
      skipCertVerify: rawConfig.skipCertVerify as boolean,
      extra: rawConfig,
    },
  };
}

function parseVlessUri(uri: string): ParsedNodeRaw | null {
  const url = new URL(uri.replace('vless://', 'https://'));
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : 'VLESS';
  const server = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const uuid = url.username;

  if (!server || !port) return null;

  const rawConfig: Record<string, unknown> = {
    uuid,
    flow: url.searchParams.get('flow') ?? undefined,
    security: url.searchParams.get('security') ?? undefined,
    sni: url.searchParams.get('sni') ?? undefined,
    network: url.searchParams.get('type') ?? 'tcp',
    wsPath: url.searchParams.get('path') ?? undefined,
    skipCertVerify: url.searchParams.get('allowInsecure') === '1' ||
      url.searchParams.get('skip-cert-verify') === 'true',
  };

  return {
    name,
    protocol: 'vless',
    server,
    port,
    ...countryFields(name),
    rawConfig,
    parsedConfig: {
      protocol: 'vless',
      server,
      port,
      uuid,
      tls: rawConfig.security === 'tls' || rawConfig.security === 'reality',
      sni: rawConfig.sni as string | undefined,
      skipCertVerify: rawConfig.skipCertVerify as boolean,
      network: (rawConfig.network as NormalizedProxyConfig['network']) ?? 'tcp',
      wsPath: rawConfig.wsPath as string | undefined,
      extra: rawConfig,
    },
  };
}

function parseHysteria2Uri(uri: string): ParsedNodeRaw | null {
  const cleaned = uri.replace('hysteria2://', 'https://').replace('hy2://', 'https://');
  const url = new URL(cleaned);
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : 'Hysteria2';
  const server = url.hostname;
  const port = parseInt(url.port || '443', 10);
  const password = url.username || (url.searchParams.get('auth') ?? '');

  if (!server || !port) return null;

  const rawConfig: Record<string, unknown> = {
    password,
    sni: url.searchParams.get('sni') ?? undefined,
    skipCertVerify: url.searchParams.get('insecure') === '1',
  };

  return {
    name,
    protocol: 'hysteria2',
    server,
    port,
    ...countryFields(name),
    rawConfig,
    parsedConfig: {
      protocol: 'hysteria2',
      server,
      port,
      password,
      tls: true,
      sni: rawConfig.sni as string | undefined,
      skipCertVerify: rawConfig.skipCertVerify as boolean,
      extra: rawConfig,
    },
  };
}

const DEFAULT_PORTS: Partial<Record<ProxyProtocol, number>> = {
  anytls: 443,
  trojan: 443,
  vless: 443,
  hysteria: 443,
  hysteria2: 443,
  tuic: 443,
  naive: 443,
  https: 443,
  http: 80,
  socks5: 1080,
  ssh: 22,
  shadowtls: 443,
  wireguard: 51820,
};

function parseGenericUrlUri(uri: string): ParsedNodeRaw | null {
  const scheme = uri.slice(0, uri.indexOf('://'));
  const protocol = schemeToProtocol(scheme);
  if (!protocol) return null;

  const withoutScheme = uri.slice(scheme.length + 3);
  const hashIdx = withoutScheme.indexOf('#');
  const name = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : protocol.toUpperCase();
  const beforeHash = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;
  const qIdx = beforeHash.indexOf('?');
  const hostAndPath = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
  const slashIdx = hostAndPath.indexOf('/');
  const hostPart = slashIdx >= 0 ? hostAndPath.slice(0, slashIdx) : hostAndPath;
  const uriPath = slashIdx >= 0 ? hostAndPath.slice(slashIdx) : '';
  const query = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : '';
  const params = new URLSearchParams(query);

  const atIdx = hostPart.lastIndexOf('@');
  const userinfo = atIdx >= 0 ? hostPart.slice(0, atIdx) : '';
  const hostPort = atIdx >= 0 ? hostPart.slice(atIdx + 1) : hostPart;

  let server = '';
  let port = DEFAULT_PORTS[protocol] ?? 0;
  if (hostPort.startsWith('[')) {
    const closeBracket = hostPort.indexOf(']');
    server = hostPort.slice(1, closeBracket);
    if (hostPort.length > closeBracket + 1) port = parseInt(hostPort.slice(closeBracket + 2), 10);
  } else {
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx >= 0) {
      server = hostPort.slice(0, colonIdx);
      port = parseInt(hostPort.slice(colonIdx + 1), 10);
    } else {
      server = hostPort;
    }
  }

  if (!server || !port) return null;

  let username: string | undefined;
  let password: string | undefined;
  let uuid: string | undefined;

  if (protocol === 'vless') {
    uuid = decodeURIComponent(userinfo);
  } else if (protocol === 'tuic') {
    const colonIdx = userinfo.indexOf(':');
    uuid = decodeURIComponent(userinfo.slice(0, colonIdx));
    password = decodeURIComponent(userinfo.slice(colonIdx + 1));
  } else if (protocol === 'socks5' || protocol === 'http' || protocol === 'https' || protocol === 'ssh' || protocol === 'naive') {
    if (userinfo.includes(':')) {
      const colonIdx = userinfo.indexOf(':');
      username = decodeURIComponent(userinfo.slice(0, colonIdx));
      password = decodeURIComponent(userinfo.slice(colonIdx + 1));
    } else if (userinfo) {
      username = decodeURIComponent(userinfo);
    }
  } else if (userinfo) {
    password = decodeURIComponent(userinfo);
  }

  const tls =
    protocol === 'https' ||
    protocol === 'anytls' ||
    protocol === 'shadowtls' ||
    protocol === 'naive' ||
    params.get('security') === 'tls' ||
    params.get('security') === 'reality' ||
    params.get('tls') === '1';
  const skipCertVerify =
    params.get('allowInsecure') === '1' ||
    params.get('allowInsecure') === 'true' ||
    params.get('insecure') === '1' ||
    params.get('insecure') === 'true' ||
    params.get('skip-cert-verify') === 'true';

  const rawConfig: Record<string, unknown> = {};
  params.forEach((value, key) => {
    rawConfig[key] = value;
  });
  Object.assign(rawConfig, {
    username,
    password,
    uuid,
    tls,
    sni: params.get('sni') ?? params.get('peer') ?? params.get('host') ?? undefined,
    skipCertVerify,
    network: params.get('type') ?? params.get('network') ?? 'tcp',
    wsPath: params.get('path') ?? (uriPath && uriPath !== '/' ? uriPath : undefined),
    privateKey: params.get('private-key') ?? params.get('privateKey') ?? password,
    publicKey: params.get('public-key') ?? params.get('publicKey') ?? params.get('peer-public-key') ?? undefined,
    presharedKey: params.get('pre-shared-key') ?? params.get('presharedKey') ?? undefined,
    ip: params.get('address') ?? params.get('ip') ?? undefined,
    alpn: params.get('alpn') ?? undefined,
    fingerprint: params.get('fp') ?? params.get('fingerprint') ?? undefined,
  });

  return {
    name,
    protocol,
    server,
    port,
    ...countryFields(name),
    rawConfig,
    parsedConfig: buildParsedConfig(protocol, server, port, rawConfig),
  };
}

function schemeToProtocol(scheme: string): ProxyProtocol | null {
  return URI_SCHEME_TO_PROTOCOL[scheme] ?? null;
}

function buildParsedConfig(
  protocol: ProxyProtocol,
  server: string,
  port: number,
  raw: Record<string, unknown>
): NormalizedProxyConfig {
  return {
    protocol,
    server,
    port,
    password: (raw.password as string | undefined) ?? (raw.pass as string | undefined),
    uuid: (raw.uuid as string | undefined) ?? (raw.id as string | undefined),
    tls: raw.tls === true || raw.tls === 'true' || raw.tls === 'tls' || raw.security === 'tls' || raw.security === 'reality',
    sni: (raw.sni as string | undefined) ?? (raw['servername'] as string | undefined) ?? (raw.host as string | undefined),
    skipCertVerify: parseBoolean(raw['skip-cert-verify'] ?? raw.skipCertVerify ?? raw.allowInsecure ?? raw.insecure),
    network: (raw.network as NormalizedProxyConfig['network']) ??
      (raw.net as NormalizedProxyConfig['network']),
    wsPath: (raw['ws-path'] as string | undefined) ?? (raw.path as string | undefined),
    wsHeaders: (raw['ws-headers'] as Record<string, string> | undefined) ??
      (raw.wsHeaders as Record<string, string> | undefined) ??
      (raw.headers as Record<string, string> | undefined),
    extra: raw,
  };
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function getVmessWsHeaders(data: Record<string, unknown>): Record<string, string> | undefined {
  const host = (data.host as string | undefined) ?? (data.sni as string | undefined)
  return host ? { Host: host } : undefined
}

export default app;
