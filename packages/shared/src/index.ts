import { URI_SCHEME_TO_PROTOCOL } from '@uni-conf/types';
import type { SourceFormat } from '@uni-conf/types';

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

export const DEFAULT_HEALTH_CHECK = {
  testUrl: 'http://www.gstatic.com/generate_204',
  interval: 300,
  tolerance: 150,
  lazy: true,
} as const;

export const DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES = 24 * 60;

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

export type ExportSubscriptionFormat =
  | 'mihomo'
  | 'clash'
  | 'singbox'
  | 'loon'
  | 'surge'
  | 'shadowrocket'
  | 'quantumultx'
  | 'stash'
  | 'egern'
  | 'nodes_base64'
  | 'nodes_raw';

export type RuleSetFormat =
  | 'mihomo'
  | 'clash'
  | 'singbox'
  | 'surge'
  | 'loon'
  | 'shadowrocket'
  | 'quantumultx'
  | 'egern'
  | 'stash'
  | 'text';

type RuleCompatibilityType =
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

type RuleCompatibilityLevel = 'full' | 'partial' | 'convert' | 'unsupported';

export const EXPORT_SUBSCRIPTION_FORMATS: ExportSubscriptionFormat[] = [
  'mihomo',
  'clash',
  'singbox',
  'loon',
  'surge',
  'shadowrocket',
  'quantumultx',
  'stash',
  'egern',
  'nodes_base64',
  'nodes_raw',
];

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
  'DOMAIN-REGEX': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'partial', shadowrocket: 'partial', quantumultx: 'unsupported', stash: 'full', egern: 'partial' },
  'IP-CIDR': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'IP-CIDR6': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'IP-ASN': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'full', shadowrocket: 'partial', quantumultx: 'unsupported', stash: 'full', egern: 'partial' },
  'GEOIP': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'GEOSITE': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'partial', surge: 'partial', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'partial' },
  'PROCESS-NAME': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'partial', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'partial' },
  'PROCESS-PATH': { mihomo: 'full', clash: 'full', singbox: 'unsupported', loon: 'unsupported', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'partial', egern: 'unsupported' },
  'PORT': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'full', quantumultx: 'full', stash: 'full', egern: 'full' },
  'SRC-PORT': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported' },
  'SRC-IP-CIDR': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported' },
  'PROTOCOL': { mihomo: 'full', clash: 'full', singbox: 'partial', loon: 'unsupported', surge: 'full', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported' },
  'NETWORK': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'unsupported', surge: 'partial', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'full', egern: 'unsupported' },
  'IN-TYPE': { mihomo: 'full', clash: 'full', singbox: 'unsupported', loon: 'unsupported', surge: 'unsupported', shadowrocket: 'unsupported', quantumultx: 'unsupported', stash: 'unsupported', egern: 'unsupported' },
  'RULE-SET': { mihomo: 'full', clash: 'full', singbox: 'full', loon: 'full', surge: 'full', shadowrocket: 'partial', quantumultx: 'full', stash: 'full', egern: 'full' },
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

export const COMPATIBLE_RULE_SET_FORMATS: Partial<Record<ExportSubscriptionFormat, RuleSetFormat[]>> = {
  mihomo: ['mihomo', 'clash', 'stash', 'text'],
  clash: ['mihomo', 'clash', 'stash', 'text'],
  singbox: ['singbox'],
  loon: ['loon', 'surge', 'shadowrocket', 'text'],
  surge: ['surge', 'text'],
  shadowrocket: ['shadowrocket', 'surge', 'text'],
  quantumultx: ['quantumultx', 'text'],
  stash: ['stash', 'mihomo', 'clash', 'text'],
  egern: ['egern', 'text'],
};

export function getCompatibleRuleSetFormats(format: ExportSubscriptionFormat): RuleSetFormat[] {
  return COMPATIBLE_RULE_SET_FORMATS[format] ?? [];
}

export function isRuleSetFormatCompatible(
  exportFormat: ExportSubscriptionFormat,
  ruleSetFormat: string
): boolean {
  return getCompatibleRuleSetFormats(exportFormat).includes(ruleSetFormat as RuleSetFormat);
}

export interface RemoteRuleSetLike {
  url: string;
  format: string;
  presetSource?: string | null;
  presetId?: string | null;
}

export function isRemoteRuleSetCompatible(
  exportFormat: ExportSubscriptionFormat,
  ruleSet: Pick<RemoteRuleSetLike, 'format' | 'presetSource' | 'presetId'>
): boolean {
  if (ruleSet.presetSource === 'quixotic' && ruleSet.presetId) {
    return supportsQuixoticRuleSetExport(exportFormat);
  }
  return isRuleSetFormatCompatible(exportFormat, ruleSet.format);
}

export function resolveRemoteRuleSetForExport(
  ruleSet: RemoteRuleSetLike,
  exportFormat: ExportSubscriptionFormat
): { url: string; format: RuleSetFormat } | null {
  if (ruleSet.presetSource === 'quixotic' && ruleSet.presetId) {
    if (!supportsQuixoticRuleSetExport(exportFormat)) return null;
    const resolved = resolveQuixoticRuleSetForExport(ruleSet.presetId, exportFormat);
    return { url: resolved.url, format: resolved.format as RuleSetFormat };
  }

  return { url: ruleSet.url, format: ruleSet.format as RuleSetFormat };
}

export const SUBSCRIPTION_INFO_NODE_PATTERNS: RegExp[] = [
  /官网|官方网站|官方地址|用户中心|客户中心|订阅|更新订阅|订阅地址/,
  /剩余.*流量|流量.*剩余|已用.*流量|流量.*用量|总.*流量|流量.*总量|流量[:：]/,
  /套餐|到期|过期|有效期|重置/,
  /\b(expire|expired|expires|expiry|traffic|remaining|used|total|reset|subscription|sub|package|plan|quota)\b/i,
  /\b(user\s*center|account\s*center|official\s*site|renew)\b/i,
  /倍率.*(说明|规则|提示)|倍数.*(说明|规则|提示)|高倍率.*(说明|规则|提示)/,
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

const QUIXOTIC_RAW_BASE = 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset';

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

export function supportsQuixoticRuleSetExport(format: string): boolean {
  return format in QUIXOTIC_FORMAT_PATHS;
}

export function buildQuixoticRuleSetUrl(id: string, format: string): string {
  const target = QUIXOTIC_FORMAT_PATHS[format] ?? QUIXOTIC_DEFAULT_FORMAT;
  return `${QUIXOTIC_RAW_BASE}/${target.path}/${id}.${target.extension}`;
}

export function resolveQuixoticRuleSetForExport(id: string, format: string): { url: string; format: string } {
  const target = QUIXOTIC_FORMAT_PATHS[format] ?? QUIXOTIC_DEFAULT_FORMAT;
  return {
    url: buildQuixoticRuleSetUrl(id, format),
    format: target.ruleSetFormat,
  };
}

export interface QuixoticRuleSetPreset {
  id: string;
  name: string;
  description: string;
  category: 'ai' | 'streaming' | 'social' | 'china' | 'apple' | 'microsoft' | 'google' | 'privacy' | 'gaming' | 'developer' | 'general';
}

export type InferredRuleSetTargetGroup =
  | 'PROXY'
  | 'AI'
  | 'Streaming'
  | 'Telegram'
  | 'Social'
  | 'GitHub'
  | 'Google'
  | 'Apple'
  | 'Microsoft'
  | 'Crypto'
  | 'Gaming'
  | 'Developer'
  | '漏网之鱼'
  | 'DIRECT'
  | 'REJECT';

export type RoutingPolicyTemplateId =
  | 'empty'
  | 'minimal'
  | 'common'
  | 'ai'
  | 'streaming'
  | 'router'
  | 'extended';

export interface RoutingPolicyTemplate {
  id: RoutingPolicyTemplateId;
  name: string;
  description: string;
  recommendedDnsMode: DnsMode;
  groupNames: string[];
}

export type DnsMode = 'compatible' | 'smart' | 'fake-ip';

export interface DnsModePreset {
  id: DnsMode;
  name: string;
  description: string;
}

export const DNS_MODE_PRESETS: DnsModePreset[] = [
  {
    id: 'compatible',
    name: '兼容优先',
    description: '使用传统 redir-host 解析，适合路由器或对 fake-ip 兼容性不确定的客户端。',
  },
  {
    id: 'smart',
    name: '智能防污染',
    description: '默认模式，国内域名优先使用国内 DNS，其他请求使用可信 DNS 并启用污染过滤。',
  },
  {
    id: 'fake-ip',
    name: '高级 fake-ip',
    description: '启用 fake-ip 和兼容过滤，适合熟悉 Mihomo 或 sing-box 高级 DNS 行为的用户。',
  },
];

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

export function buildRoutingPolicyTemplateGroupNames(template: RoutingPolicyTemplate): string[] {
  return Array.from(new Set([...FOUNDATION_POLICY_GROUP_NAMES, ...template.groupNames]));
}

export const ROUTING_POLICY_TEMPLATES: RoutingPolicyTemplate[] = [
  {
    id: 'empty',
    name: '空组合',
    description: '只保留基础出口，所有业务分流策略由用户自己添加。',
    recommendedDnsMode: 'smart',
    groupNames: [],
  },
  {
    id: 'minimal',
    name: '极简模式',
    description: '适合新手，只启用代理兜底和基础出口，国内直连、广告拦截由预置规则直接命中。',
    recommendedDnsMode: 'smart',
    groupNames: ['漏网之鱼'],
  },
  {
    id: 'common',
    name: '默认智能组合',
    description: '适合大多数用户，包含 AI、流媒体、Telegram、社交、GitHub、Google、Apple、Microsoft 和兜底分流。',
    recommendedDnsMode: 'smart',
    groupNames: ['AI', 'Streaming', 'Telegram', 'Social', 'GitHub', 'Google', 'Apple', 'Microsoft', '漏网之鱼'],
  },
  {
    id: 'ai',
    name: 'AI 优先模式',
    description: '优先启用 AI、开发和代码服务分流，适合主要使用 OpenAI、Claude、Gemini、Cursor 或 Copilot 的场景。',
    recommendedDnsMode: 'smart',
    groupNames: ['AI', 'GitHub', 'Google', 'Developer', 'Apple', 'Microsoft', '漏网之鱼'],
  },
  {
    id: 'streaming',
    name: '流媒体模式',
    description: '优先启用流媒体、社交和 Telegram 分流，适合 Netflix、YouTube、Disney+ 等服务。',
    recommendedDnsMode: 'smart',
    groupNames: ['Streaming', 'Telegram', 'Social', 'Apple', 'Microsoft', '漏网之鱼'],
  },
  {
    id: 'router',
    name: '路由器模式',
    description: '适合 OpenClash、软路由和网关场景，保留常用分流并避免过多业务组。',
    recommendedDnsMode: 'compatible',
    groupNames: ['Streaming', 'Telegram', 'GitHub', 'Google', 'Apple', 'Microsoft', '漏网之鱼'],
  },
  {
    id: 'extended',
    name: '扩展组合',
    description: '在常用组合基础上增加加密货币、游戏和开发服务。',
    recommendedDnsMode: 'smart',
    groupNames: ['AI', 'Streaming', 'Telegram', 'Social', 'GitHub', 'Google', 'Apple', 'Microsoft', '漏网之鱼', 'Crypto', 'Gaming', 'Developer'],
  },
];

export const QUIXOTIC_RULE_SET_PRESETS: QuixoticRuleSetPreset[] = [
  { id: 'abema', name: 'Abema', description: 'abema 视频流媒体平台', category: 'streaming' },
  { id: 'adrules', name: 'Advertising', description: '广告、追踪和恶意域名屏蔽规则', category: 'privacy' },
  { id: 'ai', name: 'AI', description: 'AI 规则集合，包含 OpenAI、Gemini、Copilot、Claude 等', category: 'ai' },
  { id: 'apns', name: 'APNs', description: 'Apple Push Notification Service 苹果推送服务', category: 'apple' },
  { id: 'apple-cn', name: 'Apple CN', description: 'Apple 在中国大陆备案的规则列表', category: 'apple' },
  { id: 'apple-proxy', name: 'Apple Proxy', description: 'Apple 在中国大陆需要代理的规则列表', category: 'apple' },
  { id: 'apple-tv', name: 'Apple TV', description: 'Apple TV 流媒体平台', category: 'streaming' },
  { id: 'apple', name: 'Apple', description: 'Apple 服务', category: 'apple' },
  { id: 'bahamut', name: 'Bahamut', description: '巴哈姆特动漫', category: 'streaming' },
  { id: 'bilibili', name: 'Bilibili', description: '哔哩哔哩动漫', category: 'streaming' },
  { id: 'cdn', name: 'CDN', description: '常见静态资源 CDN、软件更新、系统大文件下载规则', category: 'general' },
  { id: 'cn', name: 'China Domain', description: '中国大陆域名', category: 'china' },
  { id: 'cncidr', name: 'China IP', description: '中国大陆 IP 地址', category: 'china' },
  { id: 'cncidr-resolve', name: 'China IP Resolve', description: '中国大陆 IP 地址去除 no-resolve 参数', category: 'china' },
  { id: 'crypto', name: 'Crypto', description: '加密货币相关规则，包含 Binance、OKX、Bybit、Bitget 等', category: 'general' },
  { id: 'dazn', name: 'DAZN', description: 'DAZN 体育流媒体平台', category: 'streaming' },
  { id: 'disney', name: 'Disney+', description: '迪士尼视频流媒体平台', category: 'streaming' },
  { id: 'dmca', name: 'DMCA', description: 'DMCA 敏感域名，包含审计、Tracker、PT、下载等规则', category: 'privacy' },
  { id: 'dmm', name: 'DMM', description: 'DMM 在线内容提供商', category: 'streaming' },
  { id: 'douyin', name: 'Douyin', description: '抖音短视频平台', category: 'china' },
  { id: 'ecommerce', name: 'Ecommerce', description: '电子商务平台，包含 Amazon、eBay、Shopee、Shopify 等', category: 'general' },
  { id: 'fake-ip-filter', name: 'Fake IP Filter', description: 'fake-ip 过滤黑名单', category: 'general' },
  { id: 'forum', name: 'Forum', description: '国外常见论坛平台，包括 Reddit、V2EX、Quora、PTT 等', category: 'social' },
  { id: 'games-cn', name: 'Games CN', description: '游戏平台、游戏下载在中国大陆可直连的规则列表', category: 'gaming' },
  { id: 'games', name: 'Games', description: '游戏平台、游戏下载规则列表', category: 'gaming' },
  { id: 'gfw', name: 'GFW', description: '被 GFW 屏蔽的域名列表', category: 'general' },
  { id: 'gits', name: 'Git Services', description: 'Git 仓库规则集合，包含 GitHub、GitLab、Gitee、GitBook', category: 'developer' },
  { id: 'google', name: 'Google', description: 'Google 谷歌服务', category: 'google' },
  { id: 'googlefcm', name: 'Google FCM', description: 'Google Firebase Cloud Messaging 谷歌推送服务', category: 'google' },
  { id: 'hbo', name: 'HBO', description: 'HBO 视频流媒体平台', category: 'streaming' },
  { id: 'httpdns', name: 'HTTPDNS', description: '需要屏蔽的 HTTPDNS 列表', category: 'privacy' },
  { id: 'hulu', name: 'Hulu', description: 'Hulu 视频流媒体平台', category: 'streaming' },
  { id: 'microsoft-cn', name: 'Microsoft CN', description: 'Microsoft 在中国大陆可直连的规则列表', category: 'microsoft' },
  { id: 'microsoft', name: 'Microsoft', description: 'Microsoft 微软服务', category: 'microsoft' },
  { id: 'mytvsuper', name: 'MyTV Super', description: 'MyTV SUPER 在线视频点播服务平台', category: 'streaming' },
  { id: 'netflix', name: 'Netflix', description: 'Netflix 视频流媒体平台', category: 'streaming' },
  { id: 'niconico', name: 'Niconico', description: 'Niconico 视频网站', category: 'streaming' },
  { id: 'onedrive', name: 'OneDrive', description: 'OneDrive 网盘', category: 'microsoft' },
  { id: 'paypal', name: 'PayPal', description: 'PayPal 在线支付与转账平台', category: 'general' },
  { id: 'primevideo', name: 'Prime Video', description: 'Prime Video 视频流媒体平台', category: 'streaming' },
  { id: 'private', name: 'Private Network', description: '私有网络地址', category: 'general' },
  { id: 'proxy', name: 'Proxy', description: '国外需要代理的域名', category: 'general' },
  { id: 'socialmedia-cn', name: 'Social Media CN', description: '国内社交媒体规则集合，包含小红书、微博、知乎、豆瓣等', category: 'social' },
  { id: 'socialmedia', name: 'Social Media', description: '国外社交媒体规则集合，包含 Discord、WhatsApp、Instagram、Telegram、X 等', category: 'social' },
  { id: 'speedtest', name: 'Speedtest', description: 'Ookla SpeedTest 服务器规则', category: 'general' },
  { id: 'spotify', name: 'Spotify', description: 'Spotify 音乐流媒体平台', category: 'streaming' },
  { id: 'steam', name: 'Steam', description: 'Steam 商店、社区和游戏下载规则', category: 'gaming' },
  { id: 'talkatone', name: 'Talkatone', description: 'Talkatone 互联网语音通话和短信服务', category: 'social' },
  { id: 'tiktok', name: 'TikTok', description: 'TikTok 短视频平台', category: 'social' },
  { id: 'tld-proxy', name: 'TLD Proxy', description: '国外需要代理的顶级域名', category: 'general' },
  { id: 'twitch', name: 'Twitch', description: 'Twitch 直播平台', category: 'streaming' },
  { id: 'youtube', name: 'YouTube', description: 'YouTube 视频网站', category: 'streaming' },
  { id: 'iplocation-direct', name: 'IP Location Direct', description: '修改国内软件 IP 归属地的直连规则', category: 'china' },
  { id: 'iplocation-proxy', name: 'IP Location Proxy', description: '修改国内软件 IP 归属地的代理规则', category: 'china' },
];

const DIRECT_PRESET_IDS = new Set([
  'apns',
  'apple-cn',
  'bilibili',
  'cdn',
  'cn',
  'cncidr',
  'cncidr-resolve',
  'dmca',
  'douyin',
  'fake-ip-filter',
  'games-cn',
  'iplocation-direct',
  'microsoft-cn',
  'private',
  'socialmedia-cn',
]);

const REJECT_PRESET_IDS = new Set(['adrules', 'httpdns']);

const PROXY_PRESET_IDS = new Set([
  'games',
  'iplocation-proxy',
  'talkatone',
]);

const CRYPTO_PRESET_IDS = new Set(['crypto']);
const GITHUB_PRESET_IDS = new Set(['gits']);
const APPLE_PRESET_IDS = new Set(['apple', 'apple-proxy']);
const MICROSOFT_PRESET_IDS = new Set(['microsoft', 'onedrive']);
const GOOGLE_PRESET_IDS = new Set(['google', 'googlefcm']);
const TELEGRAM_PRESET_IDS = new Set(['telegram']);

export function inferQuixoticTargetGroup(preset: QuixoticRuleSetPreset): InferredRuleSetTargetGroup {
  if (REJECT_PRESET_IDS.has(preset.id)) return 'REJECT';
  if (DIRECT_PRESET_IDS.has(preset.id)) return 'DIRECT';
  if (GITHUB_PRESET_IDS.has(preset.id)) return 'GitHub';
  if (APPLE_PRESET_IDS.has(preset.id)) return 'Apple';
  if (MICROSOFT_PRESET_IDS.has(preset.id)) return 'Microsoft';
  if (GOOGLE_PRESET_IDS.has(preset.id)) return 'Google';
  if (TELEGRAM_PRESET_IDS.has(preset.id)) return 'Telegram';
  if (CRYPTO_PRESET_IDS.has(preset.id)) return 'Crypto';
  if (PROXY_PRESET_IDS.has(preset.id)) return 'PROXY';

  switch (preset.category) {
    case 'ai':
      return 'AI';
    case 'streaming':
      return 'Streaming';
    case 'social':
      return 'Social';
    case 'apple':
      return 'Apple';
    case 'microsoft':
      return 'Microsoft';
    case 'gaming':
      return 'Gaming';
    case 'developer':
      return 'Developer';
    case 'china':
      return 'DIRECT';
    case 'privacy':
      return 'DIRECT';
    default:
      return 'PROXY';
  }
}

export function resolveQuixoticRuleSetSortOrder(presetId: string): number {
  if (['private'].includes(presetId)) return 10;
  if (['adrules', 'httpdns'].includes(presetId)) return 20;
  if (['cn', 'cncidr', 'cncidr-resolve', 'apple-cn', 'microsoft-cn', 'games-cn', 'socialmedia-cn', 'iplocation-direct', 'apns', 'cdn', 'douyin', 'fake-ip-filter', 'bilibili'].includes(presetId)) return 30;
  if (presetId === 'ai') return 40;
  if (presetId === 'telegram') return 50;
  if (['netflix', 'youtube', 'disney', 'apple-tv', 'primevideo', 'hbo', 'hulu', 'dazn', 'abema', 'bahamut', 'dmm', 'mytvsuper', 'niconico', 'spotify', 'twitch'].includes(presetId)) return 60;
  if (presetId === 'gits') return 70;
  if (['apple', 'apple-proxy'].includes(presetId)) return 80;
  if (['microsoft', 'onedrive'].includes(presetId)) return 90;
  if (['google', 'googlefcm'].includes(presetId)) return 100;
  if (['games', 'steam'].includes(presetId)) return 110;
  if (presetId === 'crypto') return 120;
  if (['forum', 'socialmedia', 'talkatone', 'tiktok'].includes(presetId)) return 130;
  if (['gfw', 'proxy', 'tld-proxy', 'iplocation-proxy'].includes(presetId)) return 140;
  if (['ecommerce', 'paypal', 'speedtest', 'dmca'].includes(presetId)) return 150;
  return 900;
}
