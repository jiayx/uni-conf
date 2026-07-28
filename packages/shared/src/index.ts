import { URI_SCHEME_TO_PROTOCOL } from '@uni-conf/types';
import type {
  AutoNodeGroupType,
  DnsAddressMode,
  DnsResolutionMode,
  ExportDnsPolicy,
  ExportFormat,
  NormalizedProxyConfig,
  ProxyProtocol,
  RemoteRuleSetSourceOverrideTarget,
  RuleSetBehavior,
  RuleSetFormat as ModelRuleSetFormat,
  RuleType,
  RoutingPolicyScenarioId,
  SourceFormat,
} from '@uni-conf/types';

export interface CountryInfo {
  country: string;
  countryCode: string;
}

export interface TrafficMultiplierInfo {
  value: number;
  label: string;
  high: boolean;
}

export const AUTO_NODE_GROUP_PREFIX = '[uni-conf:auto-node-group]';
export const DEFAULT_NODE_POOL_COLLECTION_ID = 'builtin-default-node-pool';
export const DEFAULT_NODE_POOL_PREFIX = '[uni-conf:default-node-pool]';
export const SOURCE_NODE_GROUP_PREFIX = '[uni-conf:source-node-group]';
export const MAX_NODE_SEARCH_LENGTH = 200;
export const MAX_NODE_BATCH_SELECTION = 500;
export const MAX_RULE_BATCH_SELECTION = 500;
export const MAX_SOURCE_CONTENT_BYTES = 4 * 1024 * 1024;
export const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;

export const AUTO_NODE_GROUP_TYPE_ORDER = ['select', 'url-test', 'fallback'] as const satisfies readonly AutoNodeGroupType[];

export const AUTO_NODE_TAG_GROUPS = [
  {
    key: 'streaming',
    label: 'Streaming / Unlock',
    name: 'Streaming Auto',
    tags: ['streaming', 'unlock'],
  },
  {
    key: 'native',
    label: 'Native / Residential',
    name: 'Native Auto',
    tags: ['residential', 'native-ip'],
  },
] as const;

export interface AutoNodeGroupMarker {
  key: string;
  scope: 'country' | 'tag';
  countryCode?: string;
  tagKey?: string;
  type: AutoNodeGroupType;
}

export function isAutoNodeGroupType(value: string | undefined): value is AutoNodeGroupType {
  return AUTO_NODE_GROUP_TYPE_ORDER.includes(value as AutoNodeGroupType);
}

export function makeCountryAutoNodeGroupKey(countryCode: string, type: AutoNodeGroupType): string {
  return `country:${countryCode.trim().toUpperCase()}:${type}`;
}

export function makeTagAutoNodeGroupKey(tagKey: string, type: AutoNodeGroupType): string {
  return `tag:${tagKey}:${type}`;
}

export function makeCountryAutoNodeGroupMarker(countryCode: string, type: AutoNodeGroupType): { key: string; text: string } {
  const key = makeCountryAutoNodeGroupKey(countryCode, type);
  return { key, text: `${AUTO_NODE_GROUP_PREFIX} ${key}` };
}

export function makeTagAutoNodeGroupMarker(tagKey: string, type: AutoNodeGroupType): { key: string; text: string } {
  const key = makeTagAutoNodeGroupKey(tagKey, type);
  return { key, text: `${AUTO_NODE_GROUP_PREFIX} ${key}` };
}

export function parseAutoNodeGroupKey(key: string): AutoNodeGroupMarker | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;

  const [scope, value, type] = parts;
  if (!isAutoNodeGroupType(type)) return null;
  if (scope === 'country' && value) {
    const normalizedCode = value.trim().toUpperCase();
    return {
      scope,
      countryCode: normalizedCode,
      type,
      key: makeCountryAutoNodeGroupKey(normalizedCode, type),
    };
  }
  if (scope === 'tag' && value) {
    return {
      scope,
      tagKey: value,
      type,
      key: makeTagAutoNodeGroupKey(value, type),
    };
  }
  return null;
}

export function isCanonicalAutoNodeGroupKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const key = value.trim();
  const marker = parseAutoNodeGroupKey(key);
  if (!marker || marker.key !== key) return false;
  if (marker.scope === 'country') return Boolean(marker.countryCode && /^[A-Z]{2}$/.test(marker.countryCode));
  if (marker.scope === 'tag') return Boolean(marker.tagKey && /^[a-z0-9_-]+$/.test(marker.tagKey));
  return false;
}

export function parseAutoNodeGroupMarker(notes?: string | null): AutoNodeGroupMarker | null {
  if (!notes?.startsWith(AUTO_NODE_GROUP_PREFIX)) return null;
  return parseAutoNodeGroupKey(notes.slice(AUTO_NODE_GROUP_PREFIX.length).trim());
}

export const DEFAULT_HEALTH_CHECK = {
  testUrl: 'http://www.gstatic.com/generate_204',
  interval: 300,
  tolerance: 150,
  lazy: true,
} as const;

export const DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES = 24 * 60;

export const DEFAULT_PROXY_PORTS: Partial<Record<ProxyProtocol, number>> = {
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

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  try {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return binary;
  }
}

export function decodeBase64UrlUtf8(value: string): string {
  if (!value) return '';
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return decodeBase64Utf8(padded);
}

export function decodeMaybeBase64Utf8(value: string): string {
  try {
    return decodeBase64Utf8(value);
  } catch {
    try {
      return decodeBase64UrlUtf8(value);
    } catch {
      return value;
    }
  }
}

export interface ProxyUrlParts {
  name: string;
  server: string;
  port: number;
  params: URLSearchParams;
  userinfo: string;
  uriPath: string;
}

export function parseProxyUrlParts(
  uri: string,
  scheme: string,
  protocol: ProxyProtocol,
  defaultName = ''
): ProxyUrlParts | null {
  try {
    const withoutScheme = uri.slice(scheme.length + 3);
    const hashIdx = withoutScheme.indexOf('#');
    const name = hashIdx >= 0 ? decodeURIComponent(withoutScheme.slice(hashIdx + 1)) : defaultName;
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
    const parsedHostPort = parseProxyHostPort(hostPort, protocol);
    if (!parsedHostPort) return null;

    return {
      name,
      server: parsedHostPort.server,
      port: parsedHostPort.port,
      params,
      userinfo,
      uriPath,
    };
  } catch {
    return null;
  }
}

function parseProxyHostPort(
  hostPort: string,
  protocol: ProxyProtocol
): { server: string; port: number } | null {
  let server: string;
  let port = DEFAULT_PROXY_PORTS[protocol] ?? 0;

  if (hostPort.startsWith('[')) {
    const closeBracket = hostPort.indexOf(']');
    if (closeBracket <= 0) return null;
    server = hostPort.slice(1, closeBracket);
    if (hostPort.length > closeBracket + 1) {
      port = parseInt(hostPort.slice(closeBracket + 2), 10);
    }
  } else {
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx >= 0) {
      server = hostPort.slice(0, colonIdx);
      port = parseInt(hostPort.slice(colonIdx + 1), 10);
    } else {
      server = hostPort;
    }
  }

  return server && Number.isFinite(port) && port > 0 ? { server, port } : null;
}

const WEB_URL_PROXY_SCHEMES = new Set(['http', 'https']);

export const PROXY_LINK_URI_SCHEMES = Object.keys(URI_SCHEME_TO_PROTOCOL)
  .filter((scheme) => !WEB_URL_PROXY_SCHEMES.has(scheme))
  .sort((a, b) => b.length - a.length || a.localeCompare(b));

export function getProxyLinkUriScheme(value: string): string | null {
  const trimmed = value.trimStart().toLowerCase();
  return PROXY_LINK_URI_SCHEMES.find((scheme) => trimmed.startsWith(`${scheme}://`)) ?? null;
}

export function hasProxyLinkUri(value: string): boolean {
  return value.split(/\r?\n/).some((line) => getProxyLinkUriScheme(line) !== null);
}

export const IMPLICIT_TLS_PROXY_PROTOCOLS = [
  'https',
  'hysteria',
  'hysteria2',
  'anytls',
  'shadowtls',
  'naive',
] as const satisfies readonly ProxyProtocol[];

const IMPLICIT_TLS_PROXY_PROTOCOL_SET = new Set<ProxyProtocol>(IMPLICIT_TLS_PROXY_PROTOCOLS);

export function buildStructuredProxyConfig(
  protocol: ProxyProtocol,
  server: string,
  port: number,
  rawConfig: Record<string, unknown> = {}
): NormalizedProxyConfig {
  const extra = normalizeProxyExtra(rawConfig);
  return {
    protocol,
    server,
    port,
    password: protocol === 'hysteria'
      ? asConfigString(extra.password) ?? asConfigString(extra.auth)
      : asConfigString(extra.password),
    uuid: asConfigString(extra.uuid),
    tls: IMPLICIT_TLS_PROXY_PROTOCOL_SET.has(protocol) ||
      asConfigBoolean(extra.tls) ||
      extra.security === 'tls' ||
      extra.security === 'reality',
    sni: asConfigString(extra.sni),
    skipCertVerify: asConfigBoolean(extra.skipCertVerify),
    network: asConfigNetwork(extra.network),
    wsPath: asConfigString(extra.wsPath) ?? asConfigString(extra.path),
    wsHeaders: asConfigHeaders(extra.wsHeaders),
    extra,
  };
}

function normalizeProxyExtra(rawConfig: Record<string, unknown>): Record<string, unknown> {
  const extra = { ...rawConfig };
  assignAlias(extra, 'password', rawConfig.pass);
  assignAlias(extra, 'uuid', rawConfig.id);
  assignAlias(extra, 'sni', rawConfig.servername, rawConfig.host, rawConfig.peer);
  assignAlias(extra, 'skipCertVerify', rawConfig['skip-cert-verify'], rawConfig.allowInsecure, rawConfig.insecure);
  assignAlias(extra, 'network', rawConfig.net, rawConfig.type);
  assignAlias(extra, 'wsPath', rawConfig['ws-path'], rawConfig.path);
  assignAlias(extra, 'wsHeaders', rawConfig['ws-headers'], rawConfig.headers);
  assignAlias(extra, 'alterId', rawConfig.aid);
  assignAlias(extra, 'cipher', rawConfig.scy);
  assignAlias(extra, 'clientFingerprint', rawConfig['client-fingerprint'], rawConfig.fingerprint, rawConfig.fp);
  assignAlias(extra, 'publicKey', rawConfig['public-key'], rawConfig.publicKey, rawConfig['peer-public-key'], rawConfig.pbk);
  assignAlias(extra, 'shortId', rawConfig['short-id'], rawConfig.shortId, rawConfig.sid);
  assignAlias(extra, 'presharedKey', rawConfig['pre-shared-key'], rawConfig.presharedKey);
  assignAlias(extra, 'obfsPassword', rawConfig['obfs-password'], rawConfig.obfsPassword);
  assignAlias(extra, 'congestionControl', rawConfig['congestion-controller'], rawConfig.congestion_control, rawConfig.congestionControl);
  return extra;
}

function assignAlias(target: Record<string, unknown>, key: string, ...values: unknown[]): void {
  if (!isMissingConfigValue(target[key])) return;
  const value = values.find((item) => !isMissingConfigValue(item));
  if (value !== undefined) target[key] = value;
}

function isMissingConfigValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function asConfigString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function asConfigBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'tls';
}

function asConfigNetwork(value: unknown): NormalizedProxyConfig['network'] | undefined {
  if (value === 'tcp' || value === 'ws' || value === 'http' || value === 'h2' || value === 'grpc' || value === 'quic') {
    return value;
  }
  return undefined;
}

function asConfigHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, headerValue]) => typeof headerValue === 'string')
      .map(([headerName, headerValue]) => [headerName, headerValue as string])
  );
}

export const SOURCE_FORMATS = [
  'auto',
  'clash',
  'mihomo',
  'singbox',
  'base64',
  'surge',
  'loon',
  'quantumultx',
  'shadowrocket',
  'raw',
] as const satisfies readonly SourceFormat[];

export interface SourceNodeGroupMarker {
  sourceId: string;
  groupName: string;
}

export function makeSourceNodeGroupKey(sourceId: string, groupName: string): string {
  return `${sourceId}:${encodeURIComponent(groupName)}`;
}

export function makeSourceNodeGroupMarker(sourceId: string, groupName: string): string {
  return `${SOURCE_NODE_GROUP_PREFIX} ${makeSourceNodeGroupKey(sourceId, groupName)}`;
}

export function extractSourceNodeGroupMarkerKey(notes?: string | null): string | null {
  if (!notes?.startsWith(SOURCE_NODE_GROUP_PREFIX)) return null;
  return notes.slice(SOURCE_NODE_GROUP_PREFIX.length).trim() || null;
}

export function parseSourceNodeGroupKey(key: string): SourceNodeGroupMarker | null {
  const separatorIndex = key.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === key.length - 1) return null;

  const sourceId = key.slice(0, separatorIndex).trim();
  const encodedGroupName = key.slice(separatorIndex + 1).trim();
  if (!sourceId || !encodedGroupName) return null;

  try {
    const groupName = decodeURIComponent(encodedGroupName);
    return groupName ? { sourceId, groupName } : null;
  } catch {
    return null;
  }
}

export const GLOBAL_NODE_OUTLET_GROUP_IDS = [
  'builtin-all-nodes',
  'builtin-node-select',
  'builtin-auto-select',
  'builtin-fallback-select',
] as const;

export const RULE_TARGET_FOUNDATION_GROUP_IDS = [
  'builtin-proxy',
  'builtin-direct',
  'builtin-reject',
] as const;

export const DEFAULT_RULE_TARGET_GROUP_ID = RULE_TARGET_FOUNDATION_GROUP_IDS[0];

const GLOBAL_NODE_OUTLET_GROUP_ID_SET = new Set<string>(GLOBAL_NODE_OUTLET_GROUP_IDS);
const RULE_TARGET_FOUNDATION_GROUP_ID_SET = new Set<string>(RULE_TARGET_FOUNDATION_GROUP_IDS);
const FOUNDATION_POLICY_GROUP_ID_SET = new Set<string>([
  ...RULE_TARGET_FOUNDATION_GROUP_IDS,
  ...GLOBAL_NODE_OUTLET_GROUP_IDS,
]);

export function isGlobalNodeOutletGroupId(id: string): boolean {
  return GLOBAL_NODE_OUTLET_GROUP_ID_SET.has(id);
}

export function isRuleTargetFoundationGroupId(id: string): boolean {
  return RULE_TARGET_FOUNDATION_GROUP_ID_SET.has(id);
}

export function isFoundationPolicyGroupId(id: string): boolean {
  return FOUNDATION_POLICY_GROUP_ID_SET.has(id);
}

export function isRuleTargetGroup(group: { id: string; collectionIds?: readonly string[] | null }): boolean {
  return !isGlobalNodeOutletGroupId(group.id) && (group.collectionIds?.length ?? 0) === 0;
}

export type ExportSubscriptionFormat = ExportFormat;
export type RuleSetFormat = ModelRuleSetFormat;

export type RuleCompatibilityType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'DOMAIN-REGEX'
  | 'IP-CIDR'
  | 'IP-CIDR6'
  | 'IP-ASN'
  | 'GEOIP'
  | 'GEOSITE'
  | 'PROCESS-NAME'
  | 'PROCESS-PATH'
  | 'PORT'
  | 'SRC-PORT'
  | 'SRC-IP-CIDR'
  | 'PROTOCOL'
  | 'NETWORK'
  | 'IN-TYPE'
  | 'RULE-SET'
  | 'SCRIPT'
  | 'MATCH';

export type RuleCompatibilityLevel = 'full' | 'partial' | 'convert' | 'unsupported';

export const FULL_CONFIG_EXPORT_FORMATS = [
  'mihomo',
  'clash',
  'singbox',
  'loon',
  'surge',
  'shadowrocket',
  'quantumultx',
  'stash',
  'egern',
] as const satisfies readonly RemoteRuleSetSourceOverrideTarget[];

export const NODE_SUBSCRIPTION_EXPORT_FORMATS = [
  'nodes_base64',
  'nodes_raw',
] as const satisfies readonly ExportSubscriptionFormat[];

export const EXPORT_SUBSCRIPTION_FORMATS = [
  ...FULL_CONFIG_EXPORT_FORMATS,
  ...NODE_SUBSCRIPTION_EXPORT_FORMATS,
] as const satisfies readonly ExportSubscriptionFormat[];

export const RULE_SET_FORMATS = [
  ...FULL_CONFIG_EXPORT_FORMATS,
  'text',
] as const satisfies readonly RuleSetFormat[];

const EXPORT_SUBSCRIPTION_FORMAT_SET: ReadonlySet<string> = new Set(EXPORT_SUBSCRIPTION_FORMATS);
const FULL_CONFIG_EXPORT_FORMAT_SET: ReadonlySet<string> = new Set(FULL_CONFIG_EXPORT_FORMATS);
const RULE_SET_FORMAT_SET: ReadonlySet<string> = new Set(RULE_SET_FORMATS);

export function isExportSubscriptionFormat(value: unknown): value is ExportSubscriptionFormat {
  return typeof value === 'string' && EXPORT_SUBSCRIPTION_FORMAT_SET.has(value);
}

export function isFullConfigExportFormat(value: unknown): value is RemoteRuleSetSourceOverrideTarget {
  return typeof value === 'string' && FULL_CONFIG_EXPORT_FORMAT_SET.has(value);
}

export function isRuleSetFormat(value: unknown): value is RuleSetFormat {
  return typeof value === 'string' && RULE_SET_FORMAT_SET.has(value);
}

export interface ParsedSingboxWireGuardEndpoint {
  name: string;
  server: string;
  port: number;
  rawConfig: Record<string, unknown>;
  parsedConfig: NormalizedProxyConfig;
}

export function parseSingboxWireGuardEndpoint(value: unknown): ParsedSingboxWireGuardEndpoint | null {
  if (!isRecordValue(value) || value.type !== 'wireguard' || !Array.isArray(value.peers) || value.peers.length === 0) {
    return null;
  }
  const peer = value.peers[0];
  if (!isRecordValue(peer)) return null;

  const server = typeof peer.address === 'string' ? peer.address.trim() : '';
  const port = typeof peer.port === 'number' && Number.isInteger(peer.port) ? peer.port : 0;
  if (!server || port <= 0 || port > 65535) return null;

  const name = typeof value.tag === 'string' && value.tag.trim() ? value.tag.trim() : 'WireGuard';
  return {
    name,
    server,
    port,
    rawConfig: value,
    parsedConfig: {
      protocol: 'wireguard',
      server,
      port,
      extra: {
        privateKey: value.private_key,
        publicKey: peer.public_key,
        presharedKey: peer.pre_shared_key,
        address: value.address,
        allowedIPs: peer.allowed_ips,
        reserved: peer.reserved,
      },
    },
  };
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const EXPORT_FORMAT_FILENAMES: Record<ExportSubscriptionFormat, string> = {
  mihomo: 'mihomo.yaml',
  clash: 'clash.yaml',
  singbox: 'singbox.json',
  loon: 'loon.conf',
  surge: 'surge.conf',
  shadowrocket: 'shadowrocket.conf',
  quantumultx: 'quantumultx.conf',
  stash: 'stash.yaml',
  egern: 'egern.yaml',
  nodes_base64: 'nodes.txt',
  nodes_raw: 'nodes-raw.txt',
};

export const EXPORT_FORMAT_BY_FILENAME: Record<string, ExportSubscriptionFormat> = Object.fromEntries(
  Object.entries(EXPORT_FORMAT_FILENAMES).map(([format, filename]) => [filename, format])
) as Record<string, ExportSubscriptionFormat>;

export function getExportSubscriptionFilename(format: ExportSubscriptionFormat): string {
  return EXPORT_FORMAT_FILENAMES[format];
}

export function getExportFormatFromSubscriptionFilename(filename: string): ExportSubscriptionFormat | null {
  return EXPORT_FORMAT_BY_FILENAME[filename] ?? null;
}

export const RULE_COMPATIBILITY: Record<RuleCompatibilityType, Partial<Record<ExportSubscriptionFormat, RuleCompatibilityLevel>>> = {
  'DOMAIN': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'DOMAIN-SUFFIX': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'DOMAIN-KEYWORD': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'DOMAIN-REGEX': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'partial', shadowrocket: 'partial', quantumultx: 'unsupported', stash: 'full', egern: 'full' },
  'IP-CIDR': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'IP-CIDR6': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'IP-ASN': { mihomo: 'full', clash: 'full', singbox: 'unsupported', loon: 'full', surge: 'full', shadowrocket: 'partial', quantumultx: 'unsupported', stash: 'full', egern: 'full' },
  'GEOIP': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'GEOSITE': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'partial', surge: 'partial', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported' },
  'PROCESS-NAME': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'partial', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported' },
  'PROCESS-PATH': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'partial', egern: 'unsupported' },
  'PORT': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'unsupported', stash: 'full', egern: 'full' },
  'SRC-PORT': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported' },
  'SRC-IP-CIDR': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported' },
  'PROTOCOL': { mihomo: 'partial', clash: 'partial', singbox: 'partial', loon: 'partial', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'partial', egern: 'full' },
  'NETWORK': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'partial', surge: 'partial', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'full' },
  'IN-TYPE': { mihomo: 'full', clash: 'full', singbox: 'unsupported', loon: 'unsupported', surge: 'unsupported', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'unsupported', egern: 'unsupported' },
  'RULE-SET': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'full', shadowrocket: 'partial', quantumultx: 'unsupported', stash: 'full', egern: 'full' },
  'SCRIPT': { mihomo: 'partial', clash: 'partial', singbox: 'unsupported', loon: 'partial', surge: 'unsupported', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'partial', egern: 'unsupported' },
  'MATCH': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
};

export function getRuleCompatibilityLevel(
  ruleType: RuleCompatibilityType,
  format: ExportSubscriptionFormat
): RuleCompatibilityLevel {
  return RULE_COMPATIBILITY[ruleType]?.[format] ?? 'unsupported';
}

export function getRuleCompatibility(ruleType: RuleCompatibilityType): Array<{
  client: ExportSubscriptionFormat;
  level: RuleCompatibilityLevel;
}> {
  return EXPORT_SUBSCRIPTION_FORMATS.map((format) => ({
    client: format,
    level: getRuleCompatibilityLevel(ruleType, format),
  }));
}

export type RuleExportCompatibilityReason =
  | 'protocol-to-network'
  | 'network-to-protocol'
  | 'target-rule-spelling'
  | 'unsupported-rule-value';

export interface RuleExportResolution {
  level: RuleCompatibilityLevel;
  type: string;
  payload: string;
  reason?: RuleExportCompatibilityReason;
}

const SINGBOX_SNIFF_PROTOCOLS = new Set([
  'http', 'tls', 'quic', 'stun', 'dns', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp',
]);
const SURGE_PROTOCOLS = new Set([
  'http', 'https', 'tcp', 'udp', 'doh', 'doh3', 'doq', 'quic', 'stun',
]);
const EGERN_PROTOCOLS = new Set([
  'tcp', 'udp', 'http', 'https', 'quic', 'stun',
]);
const LOON_PROTOCOLS = new Set(['tcp', 'udp']);

/**
 * Resolves value-dependent compatibility and an exact target rule spelling.
 * Type-only matrices cannot express cases such as Surge PROTOCOL versus
 * Mihomo NETWORK, or sing-box network values versus sniffed protocols.
 */
export function resolveRuleForExport(
  type: RuleType,
  payload: string,
  format: ExportSubscriptionFormat
): RuleExportResolution {
  const normalizedPayload = payload.trim().toLowerCase();
  if (type === 'PORT' && (format === 'mihomo' || format === 'clash' || format === 'stash')) {
    return {
      level: 'convert',
      type: 'DST-PORT',
      payload,
      reason: 'target-rule-spelling',
    };
  }
  if (type === 'PORT' && format === 'surge') {
    return {
      level: 'convert',
      type: 'DEST-PORT',
      payload,
      reason: 'target-rule-spelling',
    };
  }
  if (type === 'PORT' && format === 'loon') {
    return {
      level: 'convert',
      type: 'DEST-PORT',
      payload,
      reason: 'target-rule-spelling',
    };
  }
  if (type === 'PORT' && format === 'shadowrocket') {
    return {
      level: 'convert',
      type: 'DST-PORT',
      payload,
      reason: 'target-rule-spelling',
    };
  }
  if (type === 'IP-ASN' && format === 'loon') {
    return {
      level: 'convert',
      type: 'IPASN',
      payload,
      reason: 'target-rule-spelling',
    };
  }
  if (format === 'quantumultx') {
    const typeMap: Partial<Record<RuleType, string>> = {
      DOMAIN: 'HOST',
      'DOMAIN-SUFFIX': 'HOST-SUFFIX',
      'DOMAIN-KEYWORD': 'HOST-KEYWORD',
      'IP-CIDR6': 'IP6-CIDR',
      MATCH: 'FINAL',
    };
    const targetType = typeMap[type];
    if (targetType) {
      return {
        level: 'convert',
        type: targetType,
        payload,
        reason: 'target-rule-spelling',
      };
    }
  }
  if (type === 'SRC-IP-CIDR' && format === 'surge') {
    return {
      level: 'convert',
      type: 'SRC-IP',
      payload,
      reason: 'target-rule-spelling',
    };
  }
  if (type === 'NETWORK') {
    if (format === 'singbox') {
      return ['tcp', 'udp', 'icmp'].includes(normalizedPayload)
        ? { level: 'full', type, payload: normalizedPayload }
        : unsupportedRuleValue(type, payload);
    }
    if (format === 'mihomo' || format === 'clash' || format === 'stash') {
      return ['tcp', 'udp'].includes(normalizedPayload)
        ? { level: 'full', type, payload: normalizedPayload }
        : unsupportedRuleValue(type, payload);
    }
    if (format === 'surge' && ['tcp', 'udp'].includes(normalizedPayload)) {
      return {
        level: 'convert',
        type: 'PROTOCOL',
        payload: normalizedPayload.toUpperCase(),
        reason: 'network-to-protocol',
      };
    }
    if (format === 'loon' && LOON_PROTOCOLS.has(normalizedPayload)) {
      return {
        level: 'convert',
        type: 'PROTOCOL',
        payload: normalizedPayload.toUpperCase(),
        reason: 'network-to-protocol',
      };
    }
    if (format === 'egern' && ['tcp', 'udp'].includes(normalizedPayload)) {
      return {
        level: 'convert',
        type: 'PROTOCOL',
        payload: normalizedPayload,
        reason: 'network-to-protocol',
      };
    }
    return unsupportedRuleValue(type, payload);
  }

  if (type === 'PROTOCOL') {
    if (
      (format === 'mihomo' || format === 'clash' || format === 'stash')
      && ['tcp', 'udp'].includes(normalizedPayload)
    ) {
      return {
        level: 'convert',
        type: 'NETWORK',
        payload: normalizedPayload,
        reason: 'protocol-to-network',
      };
    }
    if (format === 'singbox') {
      if (['tcp', 'udp'].includes(normalizedPayload)) {
        return {
          level: 'convert',
          type: 'NETWORK',
          payload: normalizedPayload,
          reason: 'protocol-to-network',
        };
      }
      return SINGBOX_SNIFF_PROTOCOLS.has(normalizedPayload)
        ? { level: 'full', type, payload: normalizedPayload }
        : unsupportedRuleValue(type, payload);
    }
    if (format === 'surge') {
      return SURGE_PROTOCOLS.has(normalizedPayload)
        ? { level: 'full', type, payload: normalizedPayload.toUpperCase() }
        : unsupportedRuleValue(type, payload);
    }
    if (format === 'loon') {
      return LOON_PROTOCOLS.has(normalizedPayload)
        ? { level: 'full', type, payload: normalizedPayload.toUpperCase() }
        : unsupportedRuleValue(type, payload);
    }
    if (format === 'egern') {
      return EGERN_PROTOCOLS.has(normalizedPayload)
        ? { level: 'full', type, payload: normalizedPayload }
        : unsupportedRuleValue(type, payload);
    }
    return unsupportedRuleValue(type, payload);
  }

  return {
    level: getRuleCompatibilityLevel(type, format),
    type,
    payload,
  };
}

export function getRuleCompatibilityForPayload(
  type: RuleType,
  payload: string
): Array<{
  client: ExportSubscriptionFormat;
  level: RuleCompatibilityLevel;
}> {
  return EXPORT_SUBSCRIPTION_FORMATS.map((format) => ({
    client: format,
    level: resolveRuleForExport(type, payload, format).level,
  }));
}

function unsupportedRuleValue(type: RuleType, payload: string): RuleExportResolution {
  return {
    level: 'unsupported',
    type,
    payload,
    reason: 'unsupported-rule-value',
  };
}

export function supportsRuleNoResolve(
  type: RuleType,
  format: ExportSubscriptionFormat
): boolean {
  if (format === 'nodes_base64' || format === 'nodes_raw' || format === 'singbox' || format === 'quantumultx') {
    return false;
  }
  return ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP'].includes(type);
}

export type RulePayloadValidationCode =
  | 'required'
  | 'invalid-domain-regex'
  | 'invalid-ipv4-cidr'
  | 'invalid-ipv6-cidr'
  | 'invalid-ip-cidr'
  | 'invalid-port'
  | 'invalid-asn'
  | 'invalid-network'
  | 'invalid-token';

export type RulePayloadValidationResult =
  | { valid: true; payload: string }
  | { valid: false; code: RulePayloadValidationCode; message: string };

export type RulePortPayload =
  | { kind: 'single'; port: number }
  | { kind: 'range'; range: string };

/**
 * Validates the semantics that UniConf's manual-rule exporters rely on and
 * returns the canonical payload stored in D1. Keep this runtime-neutral so the
 * browser preview and Worker write paths cannot drift.
 */
export function validateAndNormalizeRulePayload(
  type: RuleType,
  value: unknown
): RulePayloadValidationResult {
  if (type === 'MATCH') return { valid: true, payload: '' };
  const payload = typeof value === 'string' ? value.trim() : '';
  if (!payload) {
    return { valid: false, code: 'required', message: 'payload is required unless type is MATCH' };
  }

  if (type === 'DOMAIN-REGEX') {
    try {
      new RegExp(payload);
    } catch {
      return { valid: false, code: 'invalid-domain-regex', message: 'payload must be a valid domain regular expression' };
    }
  }

  if (type === 'IP-CIDR' && !isIpv4Cidr(payload)) {
    return { valid: false, code: 'invalid-ipv4-cidr', message: 'payload must be a valid IPv4 CIDR' };
  }
  if (type === 'IP-CIDR6' && !isIpv6Cidr(payload)) {
    return { valid: false, code: 'invalid-ipv6-cidr', message: 'payload must be a valid IPv6 CIDR' };
  }
  if (type === 'SRC-IP-CIDR' && !isIpv4Cidr(payload) && !isIpv6Cidr(payload)) {
    return { valid: false, code: 'invalid-ip-cidr', message: 'payload must be a valid IPv4 or IPv6 CIDR' };
  }

  if (type === 'PORT' || type === 'SRC-PORT') {
    const parsed = parseRulePortPayload(payload);
    if (!parsed) {
      return {
        valid: false,
        code: 'invalid-port',
        message: 'payload must be a port from 1 to 65535 or an ascending range such as 8000-9000',
      };
    }
    return {
      valid: true,
      payload: parsed.kind === 'single' ? String(parsed.port) : parsed.range.replace(':', '-'),
    };
  }

  if (type === 'IP-ASN') {
    const match = /^(?:AS)?(\d+)$/i.exec(payload);
    const asn = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(asn) || asn < 1 || asn > 4_294_967_295) {
      return { valid: false, code: 'invalid-asn', message: 'payload must be an ASN from 1 to 4294967295' };
    }
    return { valid: true, payload: String(asn) };
  }

  if (type === 'NETWORK') {
    const network = payload.toLowerCase();
    if (!['tcp', 'udp', 'icmp'].includes(network)) {
      return { valid: false, code: 'invalid-network', message: 'payload must be tcp, udp, or icmp' };
    }
    return { valid: true, payload: network };
  }

  if ((type === 'PROTOCOL' || type === 'IN-TYPE') && !/^[a-z0-9][a-z0-9_-]*$/i.test(payload)) {
    return {
      valid: false,
      code: 'invalid-token',
      message: 'payload must contain only letters, numbers, underscores, or hyphens',
    };
  }

  return {
    valid: true,
    payload: type === 'PROTOCOL' || type === 'IN-TYPE' ? payload.toLowerCase() : payload,
  };
}

export function parseRulePortPayload(value: string): RulePortPayload | null {
  const payload = value.trim();
  const single = /^\d+$/.exec(payload);
  if (single) {
    const port = Number(payload);
    return isValidPort(port) ? { kind: 'single', port } : null;
  }
  const range = /^(\d+)\s*[-:]\s*(\d+)$/.exec(payload);
  if (!range) return null;
  const start = Number(range[1]);
  const end = Number(range[2]);
  return isValidPort(start) && isValidPort(end) && start <= end
    ? { kind: 'range', range: `${start}:${end}` }
    : null;
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isIpv4Cidr(value: string): boolean {
  const match = /^([^/]+)\/(\d+)$/.exec(value);
  if (!match) return false;
  const prefix = Number(match[2]);
  const octets = match[1]!.split('.');
  return Number.isInteger(prefix)
    && prefix >= 0
    && prefix <= 32
    && octets.length === 4
    && octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
}

function isIpv6Cidr(value: string): boolean {
  const match = /^([^/]+)\/(\d+)$/.exec(value);
  if (!match) return false;
  const prefix = Number(match[2]);
  return Number.isInteger(prefix)
    && prefix >= 0
    && prefix <= 128
    && isIpv6Address(match[1]!);
}

function isIpv6Address(value: string): boolean {
  if (!value || value.includes('%') || (value.match(/::/g)?.length ?? 0) > 1) return false;
  const hasCompression = value.includes('::');
  const rawParts = value.split(':');
  const parts = rawParts.filter(Boolean);
  let units = 0;
  for (const [index, part] of parts.entries()) {
    if (/^[0-9a-f]{1,4}$/i.test(part)) {
      units++;
      continue;
    }
    if (index === parts.length - 1 && isIpv4Address(part)) {
      units += 2;
      continue;
    }
    return false;
  }
  return hasCompression ? units < 8 : units === 8;
}

function isIpv4Address(value: string): boolean {
  const octets = value.split('.');
  return octets.length === 4
    && octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255);
}

export type DnsEngine =
  | 'enhanced-mode'
  | 'dns-server-graph'
  | 'native-fake-ip'
  | 'none';

export interface ExportDnsCapabilities {
  engine: DnsEngine;
  addressModes: readonly DnsAddressMode[];
  addressModeControl: 'selectable' | 'native' | 'none';
  supportsRealIpExceptions: boolean;
  resolutionModes: readonly DnsResolutionMode[];
}

export interface ExportClientCapabilities {
  outputKind: 'full-config' | 'node-subscription';
  nodeProtocols: readonly ProxyProtocol[];
  ruleSetFormats: readonly RuleSetFormat[];
  dns: ExportDnsCapabilities;
}

export const EXPORT_CAPABILITY_PROFILE_ID = 'uni-conf-exporter';
export const EXPORT_CAPABILITY_PROFILE_REVISION = 18;

const MIHOMO_EXPORT_NODE_PROTOCOLS = [
  'ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2',
  'tuic', 'anytls', 'socks5', 'http', 'https',
] as const satisfies readonly ProxyProtocol[];

const SINGBOX_EXPORT_NODE_PROTOCOLS = [
  'ss', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2',
  'tuic', 'anytls', 'shadowtls', 'ssh', 'socks5', 'http', 'https', 'wireguard',
] as const satisfies readonly ProxyProtocol[];

const TEXT_CLIENT_EXPORT_NODE_PROTOCOLS = [
  'ss', 'vmess', 'trojan', 'anytls', 'socks5', 'http', 'https',
] as const satisfies readonly ProxyProtocol[];

const SURGE_EXPORT_NODE_PROTOCOLS = [
  'ss', 'vmess', 'trojan', 'hysteria2', 'anytls', 'socks5', 'http', 'https',
] as const satisfies readonly ProxyProtocol[];

const LOON_EXPORT_NODE_PROTOCOLS = [
  'ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria2', 'http', 'https',
] as const satisfies readonly ProxyProtocol[];

const QUANTUMULT_X_EXPORT_NODE_PROTOCOLS = [
  'ss', 'ssr', 'vmess', 'vless', 'trojan', 'anytls', 'socks5', 'http', 'https',
] as const satisfies readonly ProxyProtocol[];

const EGERN_EXPORT_NODE_PROTOCOLS = [
  'ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls',
  'socks5', 'http', 'https', 'ssh', 'wireguard',
] as const satisfies readonly ProxyProtocol[];

const NODE_SUBSCRIPTION_PROTOCOLS = [
  'ss', 'ssr', 'vmess', 'vless', 'trojan', 'hysteria', 'hysteria2',
  'tuic', 'anytls', 'shadowtls', 'ssh', 'socks5', 'http', 'https', 'wireguard',
] as const satisfies readonly ProxyProtocol[];

/**
 * Describes what UniConf's current exporters can actually render. This is an
 * implementation capability registry, not a claim about every version of the
 * downstream client. Validation and UI compatibility checks should consume
 * this registry instead of maintaining exporter-specific copies.
 */
export const EXPORT_CLIENT_CAPABILITIES = {
  mihomo: {
    outputKind: 'full-config',
    nodeProtocols: MIHOMO_EXPORT_NODE_PROTOCOLS,
    ruleSetFormats: ['mihomo', 'clash', 'stash', 'text'],
    dns: {
      engine: 'enhanced-mode',
      addressModes: ['fake-ip', 'real-ip'],
      addressModeControl: 'selectable',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  clash: {
    outputKind: 'full-config',
    nodeProtocols: MIHOMO_EXPORT_NODE_PROTOCOLS,
    ruleSetFormats: ['mihomo', 'clash', 'stash', 'text'],
    dns: {
      engine: 'enhanced-mode',
      addressModes: ['fake-ip', 'real-ip'],
      addressModeControl: 'selectable',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  singbox: {
    outputKind: 'full-config',
    nodeProtocols: SINGBOX_EXPORT_NODE_PROTOCOLS,
    ruleSetFormats: ['singbox'],
    dns: {
      engine: 'dns-server-graph',
      addressModes: ['fake-ip', 'real-ip'],
      addressModeControl: 'selectable',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  loon: {
    outputKind: 'full-config',
    nodeProtocols: LOON_EXPORT_NODE_PROTOCOLS,
    ruleSetFormats: ['loon', 'surge', 'shadowrocket', 'text'],
    dns: {
      engine: 'native-fake-ip',
      addressModes: ['fake-ip'],
      addressModeControl: 'native',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  surge: {
    outputKind: 'full-config',
    nodeProtocols: SURGE_EXPORT_NODE_PROTOCOLS,
    ruleSetFormats: ['surge', 'text'],
    dns: {
      engine: 'native-fake-ip',
      addressModes: ['fake-ip'],
      addressModeControl: 'native',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  shadowrocket: {
    outputKind: 'full-config',
    nodeProtocols: TEXT_CLIENT_EXPORT_NODE_PROTOCOLS,
    ruleSetFormats: ['shadowrocket', 'surge', 'text'],
    dns: {
      engine: 'native-fake-ip',
      addressModes: ['fake-ip'],
      addressModeControl: 'native',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  quantumultx: {
    outputKind: 'full-config',
    nodeProtocols: QUANTUMULT_X_EXPORT_NODE_PROTOCOLS,
    ruleSetFormats: ['quantumultx', 'text'],
    dns: {
      engine: 'native-fake-ip',
      addressModes: ['fake-ip'],
      addressModeControl: 'native',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  stash: {
    outputKind: 'full-config',
    nodeProtocols: MIHOMO_EXPORT_NODE_PROTOCOLS,
    ruleSetFormats: ['stash', 'mihomo', 'clash', 'text'],
    dns: {
      engine: 'native-fake-ip',
      addressModes: ['fake-ip'],
      addressModeControl: 'native',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  egern: {
    outputKind: 'full-config',
    nodeProtocols: EGERN_EXPORT_NODE_PROTOCOLS,
    // Egern can consume its native YAML sets and Surge-style source lists.
    ruleSetFormats: ['egern', 'surge', 'text'],
    dns: {
      engine: 'native-fake-ip',
      addressModes: ['fake-ip'],
      addressModeControl: 'native',
      supportsRealIpExceptions: true,
      resolutionModes: ['single', 'split'],
    },
  },
  nodes_base64: {
    outputKind: 'node-subscription',
    nodeProtocols: NODE_SUBSCRIPTION_PROTOCOLS,
    ruleSetFormats: [],
    dns: {
      engine: 'none',
      addressModes: [],
      addressModeControl: 'none',
      supportsRealIpExceptions: false,
      resolutionModes: [],
    },
  },
  nodes_raw: {
    outputKind: 'node-subscription',
    nodeProtocols: NODE_SUBSCRIPTION_PROTOCOLS,
    ruleSetFormats: [],
    dns: {
      engine: 'none',
      addressModes: [],
      addressModeControl: 'none',
      supportsRealIpExceptions: false,
      resolutionModes: [],
    },
  },
} as const satisfies Record<ExportSubscriptionFormat, ExportClientCapabilities>;

export const COMPATIBLE_RULE_SET_FORMATS = Object.fromEntries(
  EXPORT_SUBSCRIPTION_FORMATS.map((format) => [
    format,
    [...EXPORT_CLIENT_CAPABILITIES[format].ruleSetFormats],
  ])
) as Record<ExportSubscriptionFormat, RuleSetFormat[]>;

export function getExportClientCapabilities(
  format: ExportSubscriptionFormat
): ExportClientCapabilities {
  return EXPORT_CLIENT_CAPABILITIES[format];
}

export function getExportCapabilityProfile(format: ExportSubscriptionFormat): {
  id: typeof EXPORT_CAPABILITY_PROFILE_ID;
  revision: number;
  format: ExportSubscriptionFormat;
} {
  return {
    id: EXPORT_CAPABILITY_PROFILE_ID,
    revision: EXPORT_CAPABILITY_PROFILE_REVISION,
    format,
  };
}

export function serializeExportCapabilityProfile(format: ExportSubscriptionFormat): string {
  const profile = getExportCapabilityProfile(format);
  return `${profile.id}/${profile.format}@${profile.revision}`;
}

export function isNodeProtocolSupportedByExport(
  protocol: string,
  format: ExportSubscriptionFormat
): protocol is ProxyProtocol {
  return (EXPORT_CLIENT_CAPABILITIES[format].nodeProtocols as readonly string[]).includes(protocol);
}

export function isLoonTransportSupported(network: unknown): boolean {
  return ['tcp', 'ws', 'http'].includes(String(network ?? 'tcp'));
}

export function isEgernTransportSupported(protocol: string, network: unknown): boolean {
  const transport = String(network ?? 'tcp');
  if (protocol === 'vmess' || protocol === 'vless') {
    return ['tcp', 'ws', 'http', 'h2', 'grpc'].includes(transport);
  }
  if (protocol === 'trojan') return ['tcp', 'ws'].includes(transport);
  return true;
}

export function getDefaultExportDnsPolicy(
  format: ExportSubscriptionFormat
): ExportDnsPolicy | undefined {
  const capabilities = EXPORT_CLIENT_CAPABILITIES[format].dns;
  if (capabilities.engine === 'none') return undefined;
  return {
    address: {
      mode: 'fake-ip',
      realIpExceptions: {
        includeManagedDefaults: true,
        domains: [],
      },
    },
    resolution: {
      mode: (capabilities.resolutionModes as readonly DnsResolutionMode[]).includes('split')
        ? 'split'
        : 'single',
      preset: 'managed',
    },
  };
}

export function getCompatibleRuleSetFormats(format: ExportSubscriptionFormat): RuleSetFormat[] {
  return [...EXPORT_CLIENT_CAPABILITIES[format].ruleSetFormats];
}

export function isRuleSetFormatCompatible(
  exportFormat: ExportSubscriptionFormat,
  ruleSetFormat: string
): boolean {
  return getCompatibleRuleSetFormats(exportFormat).includes(ruleSetFormat as RuleSetFormat);
}

export function getRuleSetConversionTargetFormat(
  sourceFormat: string,
  exportFormat: ExportSubscriptionFormat
): 'mihomo' | 'singbox' | 'surge' | 'loon' | 'shadowrocket' | 'quantumultx' | 'egern' | null {
  const textSourceFormats = ['mihomo', 'clash', 'stash', 'surge', 'loon', 'shadowrocket', 'quantumultx', 'text', 'egern'];
  if (exportFormat === 'singbox' && textSourceFormats.includes(sourceFormat)) {
    return 'singbox';
  }
  if (['mihomo', 'clash', 'stash'].includes(exportFormat) && ['singbox', 'egern'].includes(sourceFormat)) {
    return 'mihomo';
  }
  if (['surge', 'loon', 'shadowrocket', 'quantumultx'].includes(exportFormat)
    && !isRuleSetFormatCompatible(exportFormat, sourceFormat)
    && [...textSourceFormats, 'singbox'].includes(sourceFormat)) {
    return exportFormat as 'surge' | 'loon' | 'shadowrocket' | 'quantumultx';
  }
  if (exportFormat === 'egern'
    && !isRuleSetFormatCompatible(exportFormat, sourceFormat)
    && [...textSourceFormats, 'singbox'].includes(sourceFormat)) {
    return 'egern';
  }
  return null;
}

export interface RemoteRuleSetLike {
  url: string;
  format: string;
  presetSource?: string | null;
  presetId?: string | null;
  sourceOverrides?: Partial<Record<Exclude<ExportSubscriptionFormat, 'nodes_base64' | 'nodes_raw'>, string>> | null;
}

export function isRemoteRuleSetCompatible(
  exportFormat: ExportSubscriptionFormat,
  ruleSet: Pick<RemoteRuleSetLike, 'format' | 'presetSource' | 'presetId' | 'sourceOverrides'>
): boolean {
  if (resolveRemoteRuleSetSourceOverride(ruleSet, exportFormat)) return true;
  if (ruleSet.presetSource === 'quixotic' && ruleSet.presetId) {
    if (!supportsQuixoticRuleSetExport(exportFormat)) return false;
    const resolvedFormat = resolveQuixoticRuleSetForExport(ruleSet.presetId, exportFormat).format;
    return isRuleSetFormatCompatible(exportFormat, resolvedFormat)
      || getRuleSetConversionTargetFormat(resolvedFormat, exportFormat) !== null;
  }
  return isRuleSetFormatCompatible(exportFormat, ruleSet.format)
    || getRuleSetConversionTargetFormat(ruleSet.format, exportFormat) !== null;
}

export function resolveRemoteRuleSetForExport(
  ruleSet: RemoteRuleSetLike,
  exportFormat: ExportSubscriptionFormat
): { url: string; format: RuleSetFormat } | null {
  const override = resolveRemoteRuleSetSourceOverride(ruleSet, exportFormat);
  if (override) return override;
  if (ruleSet.presetSource === 'quixotic' && ruleSet.presetId) {
    if (!supportsQuixoticRuleSetExport(exportFormat)) return null;
    const resolved = resolveQuixoticRuleSetForExport(ruleSet.presetId, exportFormat);
    return { url: resolved.url, format: resolved.format as RuleSetFormat };
  }

  return { url: ruleSet.url, format: ruleSet.format as RuleSetFormat };
}

function resolveRemoteRuleSetSourceOverride(
  ruleSet: Pick<RemoteRuleSetLike, 'sourceOverrides'>,
  exportFormat: ExportSubscriptionFormat
): { url: string; format: RuleSetFormat } | null {
  if (exportFormat === 'nodes_base64' || exportFormat === 'nodes_raw') return null;
  const url = ruleSet.sourceOverrides?.[exportFormat];
  return typeof url === 'string' && url
    ? { url, format: exportFormat as RuleSetFormat }
    : null;
}

export const SUBSCRIPTION_INFO_NODE_PATTERNS: RegExp[] = [
  /官网|官方网站|官方地址|用户中心|客户中心|订阅|更新订阅|订阅地址/,
  /剩余.*流量|流量.*剩余|已用.*流量|流量.*用量|总.*流量|流量.*总量|流量[:：]/,
  /套餐|到期|过期|有效期|重置/,
  /\b(expire|expired|expires|expiry|traffic|remaining|used|total|reset|subscription|sub|package|plan|quota)\b/i,
  /\b(user\s*center|account\s*center|official\s*site|renew)\b/i,
  /倍率.*(说明|规则|提示)|倍数.*(说明|规则|提示)|高倍率.*(说明|规则|提示)/,
  /客服|联系方式|联系邮箱|客服邮箱|(?:^|\b)e-?mail(?:$|\b)/i,
  /^支持\s*(?:AI|流媒体|地区|解锁)\s*[:：]/i,
];

export function isSubscriptionInfoNodeName(name: string): boolean {
  const normalized = name.trim();
  return Boolean(normalized) && SUBSCRIPTION_INFO_NODE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export const COUNTRY_FLAG_MAP: Array<[string, string, string]> = [
  ['🇭🇰', 'Hong Kong', 'HK'],
  ['🇯🇵', 'Japan', 'JP'],
  ['🇺🇸', 'United States', 'US'],
  ['🇸🇬', 'Singapore', 'SG'],
  ['🇹🇼', 'Taiwan', 'TW'],
  ['🇰🇷', 'Korea', 'KR'],
  ['🇬🇧', 'United Kingdom', 'GB'],
  ['🇩🇪', 'Germany', 'DE'],
  ['🇫🇷', 'France', 'FR'],
  ['🇳🇱', 'Netherlands', 'NL'],
  ['🇦🇺', 'Australia', 'AU'],
  ['🇨🇦', 'Canada', 'CA'],
  ['🇮🇳', 'India', 'IN'],
  ['🇧🇷', 'Brazil', 'BR'],
  ['🇷🇺', 'Russia', 'RU'],
  ['🇹🇷', 'Turkey', 'TR'],
  ['🇦🇷', 'Argentina', 'AR'],
  ['🇲🇾', 'Malaysia', 'MY'],
  ['🇹🇭', 'Thailand', 'TH'],
  ['🇻🇳', 'Vietnam', 'VN'],
  ['🇮🇩', 'Indonesia', 'ID'],
  ['🇵🇭', 'Philippines', 'PH'],
  ['🇿🇦', 'South Africa', 'ZA'],
  ['🇮🇱', 'Israel', 'IL'],
  ['🇸🇦', 'Saudi Arabia', 'SA'],
  ['🇦🇪', 'United Arab Emirates', 'AE'],
  ['🇮🇷', 'Iran', 'IR'],
  ['🇵🇱', 'Poland', 'PL'],
  ['🇮🇹', 'Italy', 'IT'],
  ['🇪🇸', 'Spain', 'ES'],
  ['🇵🇹', 'Portugal', 'PT'],
  ['🇨🇿', 'Czech Republic', 'CZ'],
  ['🇸🇪', 'Sweden', 'SE'],
  ['🇳🇴', 'Norway', 'NO'],
  ['🇩🇰', 'Denmark', 'DK'],
  ['🇫🇮', 'Finland', 'FI'],
  ['🇨🇭', 'Switzerland', 'CH'],
  ['🇦🇹', 'Austria', 'AT'],
  ['🇧🇪', 'Belgium', 'BE'],
];

export const COUNTRY_KEYWORD_MAP: Array<[RegExp, string, string]> = [
  [/\b(hong\s*kong|hongkong|hk)\b|香港|港(?!口)/i, 'Hong Kong', 'HK'],
  [/\b(japan|jp|tokyo|osaka)\b|日本|东京|大阪/i, 'Japan', 'JP'],
  [/\b(usa|united\s+states|america|us|la|los\s+angeles|san\s+jose)\b|美国|洛杉矶|圣何塞/i, 'United States', 'US'],
  [/\b(singapore|sg)\b|新加坡|狮城/i, 'Singapore', 'SG'],
  [/\b(taiwan|tw|taipei)\b|台湾|台北/i, 'Taiwan', 'TW'],
  [/\b(korea|kr|seoul)\b|韩国|首尔/i, 'Korea', 'KR'],
  [/\b(uk|gb|britain|england|london)\b|英国|伦敦/i, 'United Kingdom', 'GB'],
  [/\b(germany|german|de|frankfurt)\b|德国|法兰克福/i, 'Germany', 'DE'],
  [/\b(france|fr|paris)\b|法国|巴黎/i, 'France', 'FR'],
  [/\b(netherlands|nl|dutch|amsterdam)\b|荷兰|阿姆斯特丹/i, 'Netherlands', 'NL'],
  [/\b(australia|au|sydney|melbourne)\b|澳大利亚|澳洲|悉尼|墨尔本/i, 'Australia', 'AU'],
  [/\b(canada|ca|toronto|vancouver)\b|加拿大|多伦多|温哥华/i, 'Canada', 'CA'],
];

export const STANDARD_COUNTRY_NAME_MAP: Record<string, string> = {
  HK: '香港',
  JP: '日本',
  US: '美国',
  SG: '新加坡',
  TW: '台湾',
  KR: '韩国',
  GB: '英国',
  DE: '德国',
  FR: '法国',
  NL: '荷兰',
  AU: '澳大利亚',
  CA: '加拿大',
};

export function detectCountry(name: string): CountryInfo | null {
  for (const [flag, country, code] of COUNTRY_FLAG_MAP) {
    if (name.includes(flag)) {
      return { country, countryCode: code };
    }
  }

  for (const [pattern, country, code] of COUNTRY_KEYWORD_MAP) {
    if (pattern.test(name)) {
      return { country, countryCode: code };
    }
  }

  for (const [, country, code] of COUNTRY_FLAG_MAP) {
    if (new RegExp(`\\b${escapeRegExp(country)}\\b`, 'i').test(name)) {
      return { country, countryCode: code };
    }
    if (new RegExp(`(?:^|[\\s|｜_\\-[（(])${code}(?=$|[\\s|｜_\\-)）])`).test(name)) {
      return { country, countryCode: code };
    }
  }

  return null;
}

export function standardizeCountryName(name: string): string {
  let result = name;

  for (const [pattern, country, code] of COUNTRY_KEYWORD_MAP) {
    const flag = countryCodeToFlag(code);
    pattern.lastIndex = 0;
    const hasKeyword = pattern.test(result);
    const hasFlag = flag ? result.includes(flag) : false;
    if (!hasKeyword && !hasFlag) continue;

    if (flag) {
      result = result.split(flag).join(' ');
    }
    result = result.replace(toGlobalRegExp(pattern), ' ');
    result = `${STANDARD_COUNTRY_NAME_MAP[code] ?? country} ${result}`;
  }

  return result.replace(/\s+/g, ' ').trim();
}

export function countryCodeToFlag(countryCode: string): string | undefined {
  const normalizedCode = countryCode.trim().toUpperCase();
  return COUNTRY_FLAG_MAP.find(([, , code]) => code === normalizedCode)?.[0];
}

function toGlobalRegExp(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectTrafficMultiplier(name: string): TrafficMultiplierInfo | null {
  const normalized = name.trim();
  if (!normalized) return null;

  const patterns = [
    /(?:^|[\s|｜_\-[（([])(\d+(?:\.\d+)?)\s*[xX倍](?=$|[\s|｜_\-)）\]])/,
    /(?:^|[\s|｜_\-[（([])[xX]\s*(\d+(?:\.\d+)?)(?=$|[\s|｜_\-)）\]])/,
    /倍率\s*[:：]?\s*(\d+(?:\.\d+)?)/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const rawValue = match?.[1];
    if (!rawValue) continue;

    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) continue;

    return {
      value,
      label: `${trimNumeric(value)}x`,
      high: value > 1,
    };
  }

  return null;
}

export function buildNodeRecognitionTags(name: string): string[] {
  const tags = new Set<string>();
  const multiplier = detectTrafficMultiplier(name);
  if (multiplier) {
    tags.add(`multiplier:${multiplier.label}`);
    if (multiplier.high) tags.add('high-multiplier');
  }

  const normalized = name.toLowerCase();
  if (STREAMING_NODE_PATTERNS.some((pattern) => pattern.test(normalized))) tags.add('streaming');
  if (UNLOCK_NODE_PATTERNS.some((pattern) => pattern.test(normalized))) tags.add('unlock');
  if (RESIDENTIAL_NODE_PATTERNS.some((pattern) => pattern.test(normalized))) tags.add('residential');
  if (NATIVE_NODE_PATTERNS.some((pattern) => pattern.test(normalized))) tags.add('native-ip');

  return [...tags];
}

function trimNumeric(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, '').replace(/\.$/, '');
}

const STREAMING_NODE_PATTERNS: RegExp[] = [
  /流媒体|媒体|影音|奈飞|网飞|迪士尼|油管|动画|动漫|直播/,
  /\b(stream|streaming|media|netflix|nf|disney|disney\+|youtube|yt|hulu|hbo|max|dazn|abema|bahamut|spotify|twitch)\b/i,
];

const UNLOCK_NODE_PATTERNS: RegExp[] = [
  /解锁|解除|原生解锁|流媒解锁/,
  /\b(unlock|unlocked|unblocking)\b/i,
];

const RESIDENTIAL_NODE_PATTERNS: RegExp[] = [
  /家宽|家庭宽带|住宅|住宅宽带|民宽/,
  /\b(residential|home\s*broadband|home\s*isp|home\s*ip|isp)\b/i,
];

const NATIVE_NODE_PATTERNS: RegExp[] = [
  /原生|原生\s*ip|本土|本地/,
  /\b(native|native\s*ip|local\s*ip)\b/i,
];

const QUIXOTIC_RAW_BASE = 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/ruleset';
const QUIXOTIC_MASTER_RAW_BASE = 'https://raw.githubusercontent.com/QuixoticHeart/rule-set/refs/heads/master';

const QUIXOTIC_FORMAT_PATHS: Record<string, { path: string; extension: string; ruleSetFormat: string }> = {
  mihomo: { path: 'meta', extension: 'list', ruleSetFormat: 'mihomo' },
  clash: { path: 'meta', extension: 'list', ruleSetFormat: 'mihomo' },
  stash: { path: 'stash', extension: 'list', ruleSetFormat: 'stash' },
  singbox: { path: 'singbox/version5', extension: 'srs', ruleSetFormat: 'singbox' },
  surge: { path: 'surge', extension: 'list', ruleSetFormat: 'surge' },
  loon: { path: 'loon', extension: 'list', ruleSetFormat: 'loon' },
  shadowrocket: { path: 'shadowrocket', extension: 'list', ruleSetFormat: 'shadowrocket' },
  quantumultx: { path: 'quantumultx', extension: 'list', ruleSetFormat: 'quantumultx' },
  egern: { path: 'egern', extension: 'yaml', ruleSetFormat: 'egern' },
};

const QUIXOTIC_DEFAULT_FORMAT = QUIXOTIC_FORMAT_PATHS.mihomo!;

const QUIXOTIC_CUSTOM_PRESETS: Record<string, { path: string; ruleSetFormat: string; behavior: RuleSetBehavior }> = {
  'fake-ip-filter': { path: 'custom/domain/fake-ip-filter.list', ruleSetFormat: 'text', behavior: 'domain' },
};

export function getSubscriptionUrlName(rawUrl: string | undefined): string | undefined {
  const value = rawUrl?.trim();
  if (!value) return undefined;
  try {
    const name = new URL(value).searchParams.get('name')?.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

export function supportsQuixoticRuleSetExport(format: string): boolean {
  return format in QUIXOTIC_FORMAT_PATHS;
}

export function inferQuixoticRuleSetSourceFromUrl(rawUrl: string): { id: string; format: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const hostname = url.hostname.toLowerCase();
  const pathname = decodeUrlPathname(url.pathname);
  let repositoryPath: string | null = null;
  if (hostname === 'github.com') {
    const prefix = '/QuixoticHeart/rule-set/raw/refs/heads/ruleset/';
    if (pathname.toLowerCase().startsWith(prefix.toLowerCase())) repositoryPath = pathname.slice(prefix.length);
  } else if (hostname === 'raw.githubusercontent.com') {
    const prefix = '/QuixoticHeart/rule-set/refs/heads/ruleset/';
    if (pathname.toLowerCase().startsWith(prefix.toLowerCase())) repositoryPath = pathname.slice(prefix.length);
  }
  if (!repositoryPath) return null;

  for (const target of Object.values(QUIXOTIC_FORMAT_PATHS)) {
    const prefix = `${target.path}/`;
    if (!repositoryPath.startsWith(prefix)) continue;
    const filename = repositoryPath.slice(prefix.length);
    const suffix = `.${target.extension}`;
    if (!filename.endsWith(suffix)) continue;
    const id = filename.slice(0, -suffix.length);
    if (/^[a-z0-9][a-z0-9-]*$/.test(id)) return { id, format: target.ruleSetFormat };
  }
  return null;
}

export function buildQuixoticRuleSetUrl(id: string, format: string): string {
  const custom = QUIXOTIC_CUSTOM_PRESETS[id];
  if (custom) return `${QUIXOTIC_MASTER_RAW_BASE}/${custom.path}`;

  const target = QUIXOTIC_FORMAT_PATHS[format] ?? QUIXOTIC_DEFAULT_FORMAT;
  return `${QUIXOTIC_RAW_BASE}/${target.path}/${id}.${target.extension}`;
}

function decodeUrlPathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function resolveQuixoticRuleSetForExport(id: string, format: string): { url: string; format: string } {
  const custom = QUIXOTIC_CUSTOM_PRESETS[id];
  if (custom) {
    return {
      url: buildQuixoticRuleSetUrl(id, format),
      format: custom.ruleSetFormat,
    };
  }

  const target = QUIXOTIC_FORMAT_PATHS[format] ?? QUIXOTIC_DEFAULT_FORMAT;
  return {
    url: buildQuixoticRuleSetUrl(id, format),
    format: target.ruleSetFormat,
  };
}

export function resolveQuixoticRuleSetBehavior(id: string): RuleSetBehavior {
  return QUIXOTIC_CUSTOM_PRESETS[id]?.behavior ?? 'classical';
}

export interface RoutingPolicyScenario {
  id: RoutingPolicyScenarioId;
  groupNames: string[];
}

export const RULE_TARGET_FOUNDATION_GROUP_NAMES = [
  'PROXY',
  'DIRECT',
  'REJECT',
] as const;

export const GLOBAL_NODE_OUTLET_GROUP_NAMES = [
  '全部节点',
  '节点选择',
  '自动选择',
  '故障切换',
] as const;

export const FOUNDATION_POLICY_GROUP_NAMES = [
  ...RULE_TARGET_FOUNDATION_GROUP_NAMES,
  ...GLOBAL_NODE_OUTLET_GROUP_NAMES,
] as const;

export function buildRoutingPolicyScenarioGroupNames(scenarioIds: RoutingPolicyScenarioId[]): string[] {
  const enabledScenarioIds = new Set(scenarioIds);
  return Array.from(new Set([
    ...FOUNDATION_POLICY_GROUP_NAMES,
    ...ROUTING_POLICY_SCENARIOS
      .filter((scenario) => enabledScenarioIds.has(scenario.id))
      .flatMap((scenario) => scenario.groupNames),
  ]));
}

export const ROUTING_POLICY_SCENARIOS: RoutingPolicyScenario[] = [
  {
    id: 'ai-development',
    groupNames: ['AI', 'GitHub', 'Google', 'Microsoft', 'Developer'],
  },
  {
    id: 'streaming',
    groupNames: ['Streaming'],
  },
  {
    id: 'communication',
    groupNames: ['Social'],
  },
  {
    id: 'gaming',
    groupNames: ['Gaming'],
  },
  {
    id: 'finance',
    groupNames: ['Crypto'],
  },
  {
    id: 'brokerage',
    groupNames: ['Broker'],
  },
  {
    id: 'diagnostics',
    groupNames: ['Speedtest'],
  },
  {
    id: 'platform',
    groupNames: ['Apple', 'Microsoft', 'Google'],
  },
];

export const DEFAULT_ROUTING_POLICY_SCENARIOS: RoutingPolicyScenarioId[] = [
  'ai-development',
  'streaming',
  'diagnostics',
];

export const ALL_ROUTING_POLICY_SCENARIO_IDS: RoutingPolicyScenarioId[] =
  ROUTING_POLICY_SCENARIOS.map((scenario) => scenario.id);
