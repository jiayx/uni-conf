import { load as parseYAML } from 'js-yaml';
import {
  buildNodeRecognitionTags,
  buildStructuredProxyConfig,
  readNodeNetworkOptions,
  decodeBase64UrlUtf8,
  detectCountry,
  getProxyLinkUriScheme,
  isSubscriptionInfoNodeName,
  parseProxyUrlParts,
  parseSingboxWireGuardEndpoint,
} from '@uni-conf/shared';
import { MIHOMO_TYPE_TO_PROTOCOL, SINGBOX_TYPE_TO_PROTOCOL, URI_SCHEME_TO_PROTOCOL } from '@uni-conf/types';
import type {
  ProxyProtocol,
  NormalizedProxyConfig,
  SourceFormat,
  SourceNodeGroup,
  SourceParseIssue,
} from '@uni-conf/types';
import { isUsableProxyProtocol, missingRequiredProtocolFields } from './protocol-validation';

export interface ParsedNodeRaw {
  name: string;
  protocol: ProxyProtocol;
  server: string;
  port: number;
  country?: string;
  countryCode?: string;
  rawConfig: Record<string, unknown>;
  parsedConfig: NormalizedProxyConfig;
  tags: string[];
}

export function filterUsableParsedContent(
  nodes: ParsedNodeRaw[],
  groups: SourceNodeGroup[]
): { nodes: ParsedNodeRaw[]; groups: SourceNodeGroup[]; excludedCount: number; issues: SourceParseIssue[] } {
  const inspected = nodes.map((node) => ({ node, issue: parsedNodeIssue(node) }));
  const usableNodes = inspected.filter((item) => !item.issue).map((item) => item.node);
  const issues = inspected.flatMap((item) => item.issue ? [item.issue] : []);
  const excludedNames = new Set(inspected.filter((item) => item.issue).map((item) => item.node.name));
  const usableGroups = groups
    .map((group) => ({
      ...group,
      memberNames: group.memberNames.filter((name) => !excludedNames.has(name) && !isSubscriptionInfoNodeName(name)),
    }))
    .filter((group) => group.memberNames.length > 0);

  return {
    nodes: usableNodes,
    groups: usableGroups,
    excludedCount: nodes.length - usableNodes.length,
    issues,
  };
}

function parsedNodeIssue(node: ParsedNodeRaw): SourceParseIssue | null {
  if (isSubscriptionInfoNodeName(node.name)) {
    return { code: 'subscription-info', name: node.name, protocol: node.protocol };
  }
  if (!isUsableProxyProtocol(node.protocol)) {
    return { code: 'unsupported-protocol', name: node.name, protocol: node.protocol };
  }
  const fields = missingRequiredProtocolFields(node.protocol, node.parsedConfig, node.rawConfig);
  return fields.length > 0
    ? { code: 'missing-required-field', name: node.name, protocol: node.protocol, fields }
    : null;
}

function countryFields(name: string, server?: string): Pick<ParsedNodeRaw, 'country' | 'countryCode'> {
  const countryInfo = detectCountry(name)
    ?? (server ? detectCountry(server, { source: 'hostname' }) : null);
  return {
    country: countryInfo?.country,
    countryCode: countryInfo?.countryCode,
  };
}

function recognitionTags(name: string): Pick<ParsedNodeRaw, 'tags'> {
  return { tags: buildNodeRecognitionTags(name) };
}

export function detectAndParse(
  raw: string,
  hint: SourceFormat = 'auto'
): { nodes: ParsedNodeRaw[]; groups: SourceNodeGroup[]; format: SourceFormat } {
  const trimmed = raw.trim();

  if (hint !== 'auto') return parseBySourceFormat(trimmed, hint);

  // Try YAML (Clash/Mihomo format)
  if (trimmed.startsWith('proxies:') || trimmed.includes('\nproxies:')) {
    const nodes = parseClashYaml(trimmed);
    const groups = parseClashGroups(trimmed);
    return { nodes, groups, format: 'mihomo' };
  }

  if (looksLikeIniClientConfig(trimmed)) {
    return { nodes: parseClientTextConfigProxies(trimmed), groups: [], format: 'surge' };
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

function parseBySourceFormat(
  trimmed: string,
  format: Exclude<SourceFormat, 'auto'>
): { nodes: ParsedNodeRaw[]; groups: SourceNodeGroup[]; format: SourceFormat } {
  if (format === 'clash' || format === 'mihomo') {
    return {
      nodes: parseClashYaml(trimmed),
      groups: parseClashGroups(trimmed),
      format,
    };
  }

  if (format === 'singbox') {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        nodes: parseSingboxJson(parsed),
        groups: parseSingboxGroups(parsed),
        format,
      };
    } catch {
      return { nodes: [], groups: [], format };
    }
  }

  if (format === 'base64') {
    try {
      const decoded = atob(trimmed.replace(/\s/g, ''));
      return {
        nodes: parseRawLines(decoded.split('\n').filter((line) => line.trim().length > 0)),
        groups: [],
        format,
      };
    } catch {
      return { nodes: [], groups: [], format };
    }
  }

  if (format === 'shadowrocket') {
    return {
      nodes: parseShadowrocketTextConfigProxies(trimmed),
      groups: [],
      format,
    };
  }

  if (format === 'surge' || format === 'loon' || format === 'quantumultx') {
    return {
      nodes: parseClientTextConfigProxies(trimmed),
      groups: [],
      format,
    };
  }

  return {
    nodes: parseRawLines(trimmed.split('\n').filter((line) => line.trim().length > 0)),
    groups: [],
    format,
  };
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

      const protocol = clashTypeToProtocol(typeStr, proxyObj);
      const rawConfig = proxyObj;

      nodes.push({
        name: nameStr,
        protocol,
        server: serverStr,
        port: portNum,
        ...countryFields(nameStr, serverStr),
        ...recognitionTags(nameStr),
        rawConfig,
        parsedConfig: buildParsedConfig(protocol, serverStr, portNum, rawConfig),
      });
    }
  } catch {
    // Invalid imported content is reported through the preview/import result.
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
          .filter((item) => item && !isMihomoBuiltinPolicyName(item));

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

function clashTypeToProtocol(type: string, proxy?: Record<string, unknown>): ProxyProtocol {
  if (type === 'http' && hasNativeTls(proxy)) return 'https';
  return MIHOMO_TYPE_TO_PROTOCOL[type] ?? (type === 'hy2' ? 'hysteria2' : 'unknown');
}

function parseSingboxJson(data: Record<string, unknown>): ParsedNodeRaw[] {
  const nodes: ParsedNodeRaw[] = [];
  const outbounds = data.outbounds as Array<Record<string, unknown>> | undefined;

  const proxyTypes = new Set([
    'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2', 'tuic',
    'anytls', 'socks', 'http', 'ssh', 'shadowtls',
  ]);

  if (Array.isArray(outbounds)) {
    for (const ob of outbounds) {
      const type = (ob.type as string | undefined)?.toLowerCase() ?? '';
      if (!proxyTypes.has(type)) continue;

      const name = (ob.tag as string | null) ?? 'Unknown';
      const server = (ob.server as string | null) ?? '';
      const port = (ob.server_port as number | null) ?? 0;
      if (!server || !port) continue;

      const protocol = singboxTypeToProtocol(type, ob);
      nodes.push({
        name,
        protocol,
        server,
        port,
        ...countryFields(name, server),
        ...recognitionTags(name),
        rawConfig: ob,
        parsedConfig: buildParsedConfig(protocol, server, port, ob),
      });
    }
  }

  const endpoints = data.endpoints as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(endpoints)) {
    for (const endpoint of endpoints) {
      const parsed = parseSingboxWireGuardEndpoint(endpoint);
      if (!parsed) continue;
      nodes.push({
        ...parsed,
        protocol: 'wireguard',
        ...countryFields(parsed.name, parsed.server),
        ...recognitionTags(parsed.name),
      });
    }
  }

  return nodes;
}

export function parseSingboxGroups(data: Record<string, unknown>): SourceNodeGroup[] {
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
        .filter((item) => item && !isSingboxBuiltinOutboundName(item));

      const result: SourceNodeGroup = {
        name,
        type,
        memberNames,
      };
      return result;
    })
    .filter((group): group is SourceNodeGroup => group !== null && group.memberNames.length > 0);
}

function looksLikeIniClientConfig(content: string): boolean {
  return /^\s*\[(Proxy|Proxy Group|General|Remote Proxy|Rule|server_local)\]/im.test(content);
}

function parseClientTextConfigProxies(content: string): ParsedNodeRaw[] {
  const iniNodes = parseIniClientProxies(content);
  const quantumultXNodes = extractIniSection(content, 'server_local').length > 0
    ? parseRawLines(extractIniSection(content, 'server_local'))
    : [];
  return [...iniNodes, ...quantumultXNodes];
}

function parseShadowrocketTextConfigProxies(content: string): ParsedNodeRaw[] {
  const sectionNodes = parseClientTextConfigProxies(content);
  if (sectionNodes.length > 0) return sectionNodes;
  return parseRawLines(content.split('\n').filter((line) => line.trim().length > 0));
}

function parseIniClientProxies(content: string): ParsedNodeRaw[] {
  const proxyLines = extractIniSection(content, 'Proxy');
  return proxyLines
    .map(parseIniProxyLine)
    .filter((node): node is ParsedNodeRaw => node !== null);
}

function extractIniSection(content: string, sectionName: string): string[] {
  const lines = content.split(/\r?\n/);
  const result: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    const section = trimmed.match(/^\[([^\]]+)\]$/);
    if (section) {
      inSection = section[1]?.trim().toLowerCase() === sectionName.toLowerCase();
      continue;
    }

    if (inSection) result.push(trimmed);
  }

  return result;
}

function parseIniProxyLine(line: string): ParsedNodeRaw | null {
  const separatorIndex = line.indexOf('=');
  if (separatorIndex <= 0) return null;

  const name = line.slice(0, separatorIndex).trim();
  const parts = splitCommaList(line.slice(separatorIndex + 1));
  const type = parts[0]?.trim().toLowerCase();
  const server = parts[1]?.trim();
  const port = parseInt(parts[2]?.trim() ?? '', 10);
  if (!name || !type || !server || !port) return null;

  const rawConfig = parseIniProxyOptions(parts.slice(3));
  const protocol = iniTypeToProtocol(type, rawConfig);
  if (protocol === 'unknown') return null;

  if (rawConfig.password === undefined && rawConfig.pass !== undefined) rawConfig.password = rawConfig.pass;
  if (rawConfig.username === undefined && rawConfig.user !== undefined) rawConfig.username = rawConfig.user;
  if (rawConfig.method === undefined && rawConfig['encrypt-method'] !== undefined) rawConfig.method = rawConfig['encrypt-method'];
  if (rawConfig.cipher === undefined && rawConfig.method !== undefined) rawConfig.cipher = rawConfig.method;

  return {
    name,
    protocol,
    server,
    port,
    ...countryFields(name, server),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: buildParsedConfig(protocol, server, port, rawConfig),
  };
}

function splitCommaList(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of value) {
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      current += char;
      continue;
    }
    if (quote === char) {
      quote = null;
      current += char;
      continue;
    }
    if (char === ',' && quote === null) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function parseIniProxyOptions(parts: string[]): Record<string, unknown> {
  const rawConfig: Record<string, unknown> = {};
  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = trimQuotes(part.slice(separatorIndex + 1).trim());
    rawConfig[key] = coerceIniValue(value);
  }
  return rawConfig;
}

function trimQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceIniValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function hasNativeTls(config?: Record<string, unknown>): boolean {
  if (!config) return false;
  const tls = config.tls;
  if (tls === true || tls === 1 || tls === '1' || tls === 'true' || tls === 'tls') return true;
  const security = config.security;
  if (security === 'tls' || security === 'reality') return true;
  const nestedTls = config.tls;
  if (nestedTls && typeof nestedTls === 'object' && !Array.isArray(nestedTls)) {
    return (nestedTls as Record<string, unknown>).enabled === true;
  }
  return false;
}

function iniTypeToProtocol(type: string, rawConfig?: Record<string, unknown>): ProxyProtocol {
  if (type === 'http' && hasNativeTls(rawConfig)) return 'https';
  if (type === 'socks5' || type === 'socks') return 'socks5';
  if (type === 'hy2') return 'hysteria2';
  return MIHOMO_TYPE_TO_PROTOCOL[type] ?? URI_SCHEME_TO_PROTOCOL[type] ?? 'unknown';
}

function isMihomoBuiltinPolicyName(name: string): boolean {
  return ['DIRECT', 'REJECT'].includes(name.toUpperCase());
}

function isSingboxBuiltinOutboundName(name: string): boolean {
  return ['direct', 'block'].includes(name.toLowerCase());
}

function singboxTypeToProtocol(type: string, outbound?: Record<string, unknown>): ProxyProtocol {
  if (type === 'http' && hasNativeTls(outbound)) return 'https';
  return SINGBOX_TYPE_TO_PROTOCOL[type] ?? 'unknown';
}

export function parseRawLines(lines: string[]): ParsedNodeRaw[] {
  const nodes: ParsedNodeRaw[] = [];
  const appendNode = (node: ParsedNodeRaw, uri: string): void => {
    const query = uri.includes('?') ? uri.slice(uri.indexOf('?') + 1).split('#', 1)[0] : '';
    const options = {
      ...readNodeNetworkOptions(node.parsedConfig.extra),
      ...readNodeNetworkOptions(Object.fromEntries(new URLSearchParams(query))),
    };
    Object.assign(node.rawConfig, options);
    Object.assign(node.parsedConfig.extra, options);
    nodes.push(node);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      if (trimmed.startsWith('vmess://')) {
        const node = parseVmessUri(trimmed);
        if (node) appendNode(node, trimmed);
      } else if (trimmed.startsWith('ss://')) {
        const node = parseSsUri(trimmed);
        if (node) appendNode(node, trimmed);
      } else if (trimmed.startsWith('ssr://')) {
        const node = parseSsrUri(trimmed);
        if (node) appendNode(node, trimmed);
      } else if (trimmed.startsWith('trojan://')) {
        const node = parseTrojanUri(trimmed);
        if (node) appendNode(node, trimmed);
      } else if (trimmed.startsWith('vless://')) {
        const node = parseVlessUri(trimmed);
        if (node) appendNode(node, trimmed);
      } else if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) {
        const node = parseHysteria2Uri(trimmed);
        if (node) appendNode(node, trimmed);
      } else if (getProxyLinkUriScheme(trimmed) !== null || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const node = parseGenericUrlUri(trimmed);
        if (node) appendNode(node, trimmed);
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
    ...countryFields(name, server),
    ...recognitionTags(name),
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
    ...countryFields(name, server),
    ...recognitionTags(name),
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

function parseSsrUri(uri: string): ParsedNodeRaw | null {
  const decoded = decodeBase64Url(uri.slice('ssr://'.length));
  if (!decoded) return null;

  const querySeparator = decoded.indexOf('/?');
  const main = querySeparator >= 0 ? decoded.slice(0, querySeparator) : decoded;
  const query = querySeparator >= 0 ? decoded.slice(querySeparator + 2) : '';
  const [server, portValue, ssrProtocol, method, obfs, passwordValue] = main.split(':');
  const port = parseInt(portValue ?? '', 10);
  const password = decodeBase64Url(passwordValue ?? '');
  if (!server || !port || !ssrProtocol || !method || !obfs || !password) return null;

  const params = new URLSearchParams(query);
  const obfsParam = decodeBase64Url(params.get('obfsparam') ?? '') || undefined;
  const protocolParam = decodeBase64Url(params.get('protoparam') ?? '') || undefined;
  const group = decodeBase64Url(params.get('group') ?? '') || undefined;
  const name = decodeBase64Url(params.get('remarks') ?? '') || 'SSR';
  const rawConfig: Record<string, unknown> = {
    method,
    password,
    protocol: ssrProtocol,
    obfs,
    obfsParam,
    protocolParam,
    group,
  };

  return {
    name,
    protocol: 'ssr',
    server,
    port,
    ...countryFields(name, server),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: {
      protocol: 'ssr',
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
    ...countryFields(name, server),
    ...recognitionTags(name),
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

function decodeBase64Url(value: string): string {
  try {
    return decodeBase64UrlUtf8(value);
  } catch {
    return '';
  }
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
    publicKey: url.searchParams.get('public-key') ?? url.searchParams.get('publicKey') ?? url.searchParams.get('pbk') ?? undefined,
    shortId: url.searchParams.get('short-id') ?? url.searchParams.get('shortId') ?? url.searchParams.get('sid') ?? undefined,
    skipCertVerify: url.searchParams.get('allowInsecure') === '1' ||
      url.searchParams.get('skip-cert-verify') === 'true',
  };

  return {
    name,
    protocol: 'vless',
    server,
    port,
    ...countryFields(name, server),
    ...recognitionTags(name),
    rawConfig,
    parsedConfig: buildParsedConfig('vless', server, port, rawConfig),
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
    ...countryFields(name, server),
    ...recognitionTags(name),
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

function parseGenericUrlUri(uri: string): ParsedNodeRaw | null {
  const scheme = uri.slice(0, uri.indexOf('://'));
  const protocol = schemeToProtocol(scheme);
  if (!protocol) return null;

  const parts = parseProxyUrlParts(uri, scheme, protocol, protocol.toUpperCase());
  if (!parts) return null;
  const { name, params, port, server, uriPath, userinfo } = parts;

  let username: string | undefined;
  let password: string | undefined;
  let uuid: string | undefined;

  if (protocol === 'vless') {
    uuid = decodeURIComponent(userinfo);
  } else if (protocol === 'tuic' || protocol === 'juicity') {
    const colonIdx = userinfo.indexOf(':');
    uuid = decodeURIComponent(userinfo.slice(0, colonIdx));
    password = decodeURIComponent(userinfo.slice(colonIdx + 1));
  } else if (
    protocol === 'socks5'
    || protocol === 'http'
    || protocol === 'https'
    || protocol === 'ssh'
    || protocol === 'naive'
    || protocol === 'mieru'
    || protocol === 'trusttunnel'
  ) {
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
    protocol === 'hysteria' ||
    protocol === 'hysteria2' ||
    protocol === 'anytls' ||
    protocol === 'shadowtls' ||
    protocol === 'naive' ||
    protocol === 'trusttunnel' ||
    protocol === 'juicity' ||
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
    publicKey: params.get('public-key') ?? params.get('publicKey') ?? params.get('peer-public-key') ?? params.get('pbk') ?? undefined,
    shortId: params.get('short-id') ?? params.get('shortId') ?? params.get('sid') ?? undefined,
    presharedKey: params.get('pre-shared-key') ?? params.get('presharedKey') ?? undefined,
    ip: params.get('address') ?? params.get('ip') ?? undefined,
    alpn: params.get('alpn') ?? undefined,
    fingerprint: params.get('fp') ?? params.get('fingerprint') ?? undefined,
    psk: protocol === 'snell' ? password : params.get('psk') ?? undefined,
    key: protocol === 'sudoku' ? password : params.get('key') ?? undefined,
  });

  return {
    name,
    protocol,
    server,
    port,
    ...countryFields(name, server),
    ...recognitionTags(name),
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
  return buildStructuredProxyConfig(protocol, server, port, raw);
}

function getVmessWsHeaders(data: Record<string, unknown>): Record<string, string> | undefined {
  const host = (data.host as string | undefined) ?? (data.sni as string | undefined)
  return host ? { Host: host } : undefined
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
