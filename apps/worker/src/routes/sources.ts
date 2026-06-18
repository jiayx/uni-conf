import { Hono } from 'hono';
import type { Env } from '../types';
import {
  jsonStringify,
  mapSource,
  newId,
  now,
} from '../db/helpers';
import type { ProxyProtocol, NormalizedProxyConfig } from '@uni-conf/types';

const app = new Hono<{ Bindings: Env }>();

// ─── List all sources ─────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM sources ORDER BY created_at DESC'
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
      body.userAgent !== undefined ? body.userAgent : existing.user_agent,
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

  let rawContent: string;
  try {
    const response = await fetch(row.url as string, {
      headers: {
        'User-Agent': (row.user_agent as string | null) ?? 'ClashMeta/1.0',
        Accept: '*/*',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    rawContent = await response.text();
  } catch (err) {
    return c.json(
      { success: false, error: `Failed to fetch URL: ${String(err)}` },
      502
    );
  }

  // Detect format and parse nodes
  const { nodes: parsedNodes, format } = detectAndParse(rawContent);
  if (parsedNodes.length === 0) {
    return c.json(
      { success: false, error: `No proxy nodes parsed from source content (detected format: ${format})` },
      422
    );
  }

  // Load existing nodes for this source to compute diff
  const { results: existingRows } = await c.env.DB.prepare(
    'SELECT id, name, server, port FROM nodes WHERE source_id = ? AND is_manual = 0'
  )
    .bind(id)
    .all<{ id: string; name: string; server: string; port: number }>();

  const existingKeys = new Set(existingRows.map((r) => `${r.server}:${r.port}:${r.name}`));

  const addedNodes: typeof parsedNodes = [];
  const seenKeys = new Set<string>();

  for (const node of parsedNodes) {
    const key = `${node.server}:${node.port}:${node.name}`;
    if (!existingKeys.has(key) && !seenKeys.has(key)) {
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

  // Delete removed nodes
  for (const rem of toRemove) {
    await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(rem.id).run();
  }

  // Update source node_count and last_updated
  const { results: countResult } = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM nodes WHERE source_id = ?'
  )
    .bind(id)
    .all<{ cnt: number }>();

  const nodeCount = countResult[0]?.cnt ?? parsedNodes.length;

  await c.env.DB.prepare(
    'UPDATE sources SET node_count = ?, last_updated = ?, updated_at = ? WHERE id = ?'
  )
    .bind(nodeCount, ts, ts, id)
    .run();

  return c.json({
    success: true,
    data: {
      sourceId: id,
      success: true,
      nodeCount,
      addedCount: addedNodes.length,
      removedCount: toRemove.length,
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

function detectAndParse(raw: string): { nodes: ParsedNodeRaw[]; format: string } {
  const trimmed = raw.trim();

  // Try YAML (Clash/Mihomo format)
  if (trimmed.startsWith('proxies:') || trimmed.includes('\nproxies:')) {
    const nodes = parseClashYaml(trimmed);
    return { nodes, format: 'mihomo' };
  }

  // Try JSON (sing-box format)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const nodes = parseSingboxJson(parsed);
      return { nodes, format: 'singbox' };
    } catch {
      // Not valid JSON
    }
  }

  // Try base64
  try {
    const decoded = atob(trimmed.replace(/\s/g, ''));
    const lines = decoded.split('\n').filter((l) => l.trim().length > 0);
    const nodes = parseRawLines(lines);
    if (nodes.length > 0) return { nodes, format: 'base64' };
  } catch {
    // Not base64
  }

  // Raw URI lines
  const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
  const nodes = parseRawLines(lines);
  return { nodes, format: 'raw' };
}

function parseClashYaml(content: string): ParsedNodeRaw[] {
  // Simple YAML proxy list parser – extracts proxy entries without full YAML lib
  const nodes: ParsedNodeRaw[] = [];
  const proxyBlockMatch = content.match(/proxies:\s*\n([\s\S]*?)(?=\n\w|\n?$)/);
  if (!proxyBlockMatch) return nodes;

  const block = proxyBlockMatch[1];
  if (block === undefined) return nodes;
  // Split into individual proxy entries (each starting with "  - name:")
  const entries = block.split(/\n {2}- (?=name:)/);

  for (const entry of entries) {
    const nameMatch = entry.match(/name:\s*["']?([^"'\n]+)["']?/);
    const typeMatch = entry.match(/type:\s*([^\n]+)/);
    const serverMatch = entry.match(/server:\s*([^\n]+)/);
    const portMatch = entry.match(/port:\s*(\d+)/);

    const nameValue = nameMatch?.[1];
    const typeValue = typeMatch?.[1];
    const serverValue = serverMatch?.[1];
    const portValue = portMatch?.[1];
    if (!nameValue || !typeValue || !serverValue || !portValue) continue;

    const name = nameValue.trim();
    const type = typeValue.trim().toLowerCase();
    const server = serverValue.trim();
    const port = parseInt(portValue.trim(), 10);

    const protocol = clashTypeToProtocol(type);
    const rawConfig = parseEntryToObject(entry);

    nodes.push({
      name,
      protocol,
      server,
      port,
      rawConfig,
      parsedConfig: buildParsedConfig(protocol, server, port, rawConfig),
    });
  }

  return nodes;
}

function parseEntryToObject(entry: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const lines = entry.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s+(\w[\w-]*):\s*(.+)$/);
    if (match) {
      const key = match[1];
      const rawValue = match[2];
      if (!key || !rawValue) continue;
      const val = rawValue.trim().replace(/^["']|["']$/g, '');
      // Try numeric
      if (/^\d+$/.test(val)) {
        obj[key] = parseInt(val, 10);
      } else if (val === 'true') {
        obj[key] = true;
      } else if (val === 'false') {
        obj[key] = false;
      } else {
        obj[key] = val;
      }
    }
  }
  return obj;
}

function clashTypeToProtocol(type: string): ProxyProtocol {
  const map: Record<string, ProxyProtocol> = {
    ss: 'ss',
    ssr: 'ssr',
    vmess: 'vmess',
    vless: 'vless',
    trojan: 'trojan',
    hysteria: 'hysteria',
    hysteria2: 'hysteria2',
    hy2: 'hysteria2',
    tuic: 'tuic',
    wireguard: 'wireguard',
    socks5: 'socks5',
    http: 'http',
    https: 'https',
    reality: 'reality',
  };
  return map[type] ?? 'unknown';
}

function parseSingboxJson(data: Record<string, unknown>): ParsedNodeRaw[] {
  const nodes: ParsedNodeRaw[] = [];
  const outbounds = data.outbounds as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(outbounds)) return nodes;

  const proxyTypes = new Set([
    'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic',
    'wireguard', 'socks', 'http', 'ssh', 'shadowtls',
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
      rawConfig: ob,
      parsedConfig: buildParsedConfig(protocol, server, port, ob),
    });
  }

  return nodes;
}

function singboxTypeToProtocol(type: string): ProxyProtocol {
  const map: Record<string, ProxyProtocol> = {
    shadowsocks: 'ss',
    vmess: 'vmess',
    vless: 'vless',
    trojan: 'trojan',
    hysteria: 'hysteria',
    hysteria2: 'hysteria2',
    tuic: 'tuic',
    wireguard: 'wireguard',
    socks: 'socks5',
    http: 'http',
    ssh: 'ssh',
    shadowtls: 'shadowtls',
  };
  return map[type] ?? 'unknown';
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
    tls: raw.tls === true || raw.tls === 'tls',
    sni: (raw.sni as string | undefined) ?? (raw['servername'] as string | undefined),
    skipCertVerify: Boolean(
      raw['skip-cert-verify'] ?? raw.skipCertVerify ?? raw.allowInsecure
    ),
    network: (raw.network as NormalizedProxyConfig['network']) ??
      (raw.net as NormalizedProxyConfig['network']),
    wsPath: (raw['ws-path'] as string | undefined) ?? (raw.path as string | undefined),
    wsHeaders: (raw['ws-headers'] as Record<string, string> | undefined) ??
      (raw.wsHeaders as Record<string, string> | undefined) ??
      (raw.headers as Record<string, string> | undefined),
    extra: raw,
  };
}

function getVmessWsHeaders(data: Record<string, unknown>): Record<string, string> | undefined {
  const host = (data.host as string | undefined) ?? (data.sni as string | undefined)
  return host ? { Host: host } : undefined
}

export default app;
