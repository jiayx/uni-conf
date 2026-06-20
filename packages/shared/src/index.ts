export interface CountryInfo {
  country: string;
  countryCode: string;
}

export const AUTO_NODE_GROUP_PREFIX = '[uni-conf:auto-node-group]';

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
  [/\b(hong\s*kong|hongkong|hk)\b/i, 'Hong Kong', 'HK'],
  [/\b(japan|jp|tokyo)\b/i, 'Japan', 'JP'],
  [/\b(usa|united\s+states|america)\b/i, 'United States', 'US'],
  [/\b(singapore|sg)\b/i, 'Singapore', 'SG'],
  [/\b(taiwan|tw)\b/i, 'Taiwan', 'TW'],
  [/\b(korea|kr)\b/i, 'Korea', 'KR'],
  [/\b(uk|britain|england|london)\b/i, 'United Kingdom', 'GB'],
  [/\b(germany|german|de)\b/i, 'Germany', 'DE'],
  [/\b(france|fr)\b/i, 'France', 'FR'],
  [/\b(netherlands|nl|dutch)\b/i, 'Netherlands', 'NL'],
  [/\b(australia|au)\b/i, 'Australia', 'AU'],
  [/\b(canada|ca)\b/i, 'Canada', 'CA'],
];

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

export function countryCodeToFlag(countryCode: string): string | undefined {
  const normalizedCode = countryCode.trim().toUpperCase();
  return COUNTRY_FLAG_MAP.find(([, , code]) => code === normalizedCode)?.[0];
}

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
  | 'Social'
  | 'GitHub'
  | 'Apple'
  | 'Microsoft'
  | 'Crypto'
  | 'Gaming'
  | 'Developer'
  | 'DIRECT'
  | 'REJECT';

export type RoutingPolicyTemplateId = 'empty' | 'common' | 'extended';

export interface RoutingPolicyTemplate {
  id: RoutingPolicyTemplateId;
  name: string;
  description: string;
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

export const FOUNDATION_POLICY_GROUP_NAMES = ['PROXY', 'DIRECT', 'REJECT'] as const;

export function buildRoutingPolicyTemplateGroupNames(template: RoutingPolicyTemplate): string[] {
  return Array.from(new Set([...FOUNDATION_POLICY_GROUP_NAMES, ...template.groupNames]));
}

export const ROUTING_POLICY_TEMPLATES: RoutingPolicyTemplate[] = [
  {
    id: 'empty',
    name: '空组合',
    description: '只保留基础出口，所有业务分流策略由用户自己添加。',
    groupNames: ['PROXY'],
  },
  {
    id: 'common',
    name: '默认智能模板',
    description: '适合大多数用户，包含 AI、流媒体、社交、GitHub、Apple 和 Microsoft 分流。',
    groupNames: ['PROXY', 'AI', 'Streaming', 'Social', 'GitHub', 'Apple', 'Microsoft'],
  },
  {
    id: 'extended',
    name: '扩展组合',
    description: '在常用组合基础上增加加密货币、游戏和开发服务。',
    groupNames: ['PROXY', 'AI', 'Streaming', 'Social', 'GitHub', 'Apple', 'Microsoft', 'Crypto', 'Gaming', 'Developer'],
  },
];

export const QUIXOTIC_RULE_SET_PRESETS: QuixoticRuleSetPreset[] = [
  { id: 'abema', name: 'Abema', description: 'abema 视频流媒体平台', category: 'streaming' },
  { id: 'adrules', name: 'Advertising', description: '广告屏蔽规则 + HTTPDNS', category: 'privacy' },
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

export function inferQuixoticTargetGroup(preset: QuixoticRuleSetPreset): InferredRuleSetTargetGroup {
  if (REJECT_PRESET_IDS.has(preset.id)) return 'REJECT';
  if (DIRECT_PRESET_IDS.has(preset.id)) return 'DIRECT';
  if (GITHUB_PRESET_IDS.has(preset.id)) return 'GitHub';
  if (APPLE_PRESET_IDS.has(preset.id)) return 'Apple';
  if (MICROSOFT_PRESET_IDS.has(preset.id)) return 'Microsoft';
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
