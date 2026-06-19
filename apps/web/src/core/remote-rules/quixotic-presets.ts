import type { RuleSetFormat } from '@uni-conf/types'

export interface QuixoticRuleSetPreset {
  id: string
  name: string
  description: string
  category: 'ai' | 'streaming' | 'social' | 'china' | 'apple' | 'microsoft' | 'google' | 'privacy' | 'gaming' | 'developer' | 'general'
  suggestedGroup: 'PROXY' | 'AI' | 'Streaming' | 'Social' | 'DIRECT' | 'REJECT'
}

const RAW_BASE = 'https://github.com/QuixoticHeart/rule-set/raw/refs/heads/ruleset'

export const RULE_SET_FORMAT_OPTIONS: Array<{ value: RuleSetFormat; label: string; exportTargets: string }> = [
  { value: 'mihomo', label: 'Mihomo / Clash Meta', exportTargets: 'Mihomo / Clash / Stash' },
  { value: 'clash', label: 'Clash Classical', exportTargets: 'Mihomo / Clash' },
  { value: 'singbox', label: 'sing-box SRS', exportTargets: 'sing-box' },
  { value: 'surge', label: 'Surge', exportTargets: 'Surge' },
  { value: 'loon', label: 'Loon', exportTargets: 'Loon' },
  { value: 'shadowrocket', label: 'Shadowrocket', exportTargets: 'Shadowrocket' },
  { value: 'quantumultx', label: 'Quantumult X', exportTargets: 'Quantumult X' },
  { value: 'egern', label: 'Egern', exportTargets: 'Egern' },
  { value: 'stash', label: 'Stash', exportTargets: 'Stash / Mihomo-compatible clients' },
  { value: 'text', label: 'Text', exportTargets: 'Domain list fallback' },
]

export const QUIXOTIC_RULE_SET_PRESETS: QuixoticRuleSetPreset[] = [
  { id: 'abema', name: 'Abema', description: 'abema 视频流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'adrules', name: 'Advertising', description: '广告屏蔽规则 + HTTPDNS', category: 'privacy', suggestedGroup: 'REJECT' },
  { id: 'ai', name: 'AI', description: 'AI 规则集合，包含 OpenAI、Gemini、Copilot、Claude 等', category: 'ai', suggestedGroup: 'AI' },
  { id: 'apns', name: 'APNs', description: 'Apple Push Notification Service 苹果推送服务', category: 'apple', suggestedGroup: 'DIRECT' },
  { id: 'apple-cn', name: 'Apple CN', description: 'Apple 在中国大陆备案的规则列表', category: 'apple', suggestedGroup: 'DIRECT' },
  { id: 'apple-proxy', name: 'Apple Proxy', description: 'Apple 在中国大陆需要代理的规则列表', category: 'apple', suggestedGroup: 'PROXY' },
  { id: 'apple-tv', name: 'Apple TV', description: 'Apple TV 流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'apple', name: 'Apple', description: 'Apple 服务', category: 'apple', suggestedGroup: 'PROXY' },
  { id: 'bahamut', name: 'Bahamut', description: '巴哈姆特动漫', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'bilibili', name: 'Bilibili', description: '哔哩哔哩动漫', category: 'streaming', suggestedGroup: 'DIRECT' },
  { id: 'cdn', name: 'CDN', description: '常见静态资源 CDN、软件更新、系统大文件下载规则', category: 'general', suggestedGroup: 'DIRECT' },
  { id: 'cn', name: 'China Domain', description: '中国大陆域名', category: 'china', suggestedGroup: 'DIRECT' },
  { id: 'cncidr', name: 'China IP', description: '中国大陆 IP 地址', category: 'china', suggestedGroup: 'DIRECT' },
  { id: 'cncidr-resolve', name: 'China IP Resolve', description: '中国大陆 IP 地址去除 no-resolve 参数', category: 'china', suggestedGroup: 'DIRECT' },
  { id: 'crypto', name: 'Crypto', description: '加密货币相关规则，包含 Binance、OKX、Bybit、Bitget 等', category: 'general', suggestedGroup: 'PROXY' },
  { id: 'dazn', name: 'DAZN', description: 'DAZN 体育流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'disney', name: 'Disney+', description: '迪士尼视频流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'dmca', name: 'DMCA', description: 'DMCA 敏感域名，包含审计、Tracker、PT、下载等规则', category: 'privacy', suggestedGroup: 'DIRECT' },
  { id: 'dmm', name: 'DMM', description: 'DMM 在线内容提供商', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'douyin', name: 'Douyin', description: '抖音短视频平台', category: 'china', suggestedGroup: 'DIRECT' },
  { id: 'ecommerce', name: 'Ecommerce', description: '电子商务平台，包含 Amazon、eBay、Shopee、Shopify 等', category: 'general', suggestedGroup: 'PROXY' },
  { id: 'fake-ip-filter', name: 'Fake IP Filter', description: 'fake-ip 过滤黑名单', category: 'general', suggestedGroup: 'DIRECT' },
  { id: 'forum', name: 'Forum', description: '国外常见论坛平台，包括 Reddit、V2EX、Quora、PTT 等', category: 'social', suggestedGroup: 'Social' },
  { id: 'games-cn', name: 'Games CN', description: '游戏平台、游戏下载在中国大陆可直连的规则列表', category: 'gaming', suggestedGroup: 'DIRECT' },
  { id: 'games', name: 'Games', description: '游戏平台、游戏下载规则列表', category: 'gaming', suggestedGroup: 'PROXY' },
  { id: 'gfw', name: 'GFW', description: '被 GFW 屏蔽的域名列表', category: 'general', suggestedGroup: 'PROXY' },
  { id: 'gits', name: 'Git Services', description: 'Git 仓库规则集合，包含 GitHub、GitLab、Gitee、GitBook', category: 'developer', suggestedGroup: 'PROXY' },
  { id: 'google', name: 'Google', description: 'Google 谷歌服务', category: 'google', suggestedGroup: 'PROXY' },
  { id: 'googlefcm', name: 'Google FCM', description: 'Google Firebase Cloud Messaging 谷歌推送服务', category: 'google', suggestedGroup: 'PROXY' },
  { id: 'hbo', name: 'HBO', description: 'HBO 视频流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'httpdns', name: 'HTTPDNS', description: '需要屏蔽的 HTTPDNS 列表', category: 'privacy', suggestedGroup: 'REJECT' },
  { id: 'hulu', name: 'Hulu', description: 'Hulu 视频流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'microsoft-cn', name: 'Microsoft CN', description: 'Microsoft 在中国大陆可直连的规则列表', category: 'microsoft', suggestedGroup: 'DIRECT' },
  { id: 'microsoft', name: 'Microsoft', description: 'Microsoft 微软服务', category: 'microsoft', suggestedGroup: 'PROXY' },
  { id: 'mytvsuper', name: 'MyTV Super', description: 'MyTV SUPER 在线视频点播服务平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'netflix', name: 'Netflix', description: 'Netflix 视频流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'niconico', name: 'Niconico', description: 'Niconico 视频网站', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'onedrive', name: 'OneDrive', description: 'OneDrive 网盘', category: 'microsoft', suggestedGroup: 'PROXY' },
  { id: 'paypal', name: 'PayPal', description: 'PayPal 在线支付与转账平台', category: 'general', suggestedGroup: 'PROXY' },
  { id: 'primevideo', name: 'Prime Video', description: 'Prime Video 视频流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'private', name: 'Private Network', description: '私有网络地址', category: 'general', suggestedGroup: 'DIRECT' },
  { id: 'proxy', name: 'Proxy', description: '国外需要代理的域名', category: 'general', suggestedGroup: 'PROXY' },
  { id: 'socialmedia-cn', name: 'Social Media CN', description: '国内社交媒体规则集合，包含小红书、微博、知乎、豆瓣等', category: 'social', suggestedGroup: 'DIRECT' },
  { id: 'socialmedia', name: 'Social Media', description: '国外社交媒体规则集合，包含 Discord、WhatsApp、Instagram、Telegram、X 等', category: 'social', suggestedGroup: 'Social' },
  { id: 'speedtest', name: 'Speedtest', description: 'Ookla SpeedTest 服务器规则', category: 'general', suggestedGroup: 'PROXY' },
  { id: 'spotify', name: 'Spotify', description: 'Spotify 音乐流媒体平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'talkatone', name: 'Talkatone', description: 'Talkatone 互联网语音通话和短信服务', category: 'social', suggestedGroup: 'PROXY' },
  { id: 'tiktok', name: 'TikTok', description: 'TikTok 短视频平台', category: 'social', suggestedGroup: 'Social' },
  { id: 'tld-proxy', name: 'TLD Proxy', description: '国外需要代理的顶级域名', category: 'general', suggestedGroup: 'PROXY' },
  { id: 'twitch', name: 'Twitch', description: 'Twitch 直播平台', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'youtube', name: 'YouTube', description: 'YouTube 视频网站', category: 'streaming', suggestedGroup: 'Streaming' },
  { id: 'iplocation-direct', name: 'IP Location Direct', description: '修改国内软件 IP 归属地的直连规则', category: 'china', suggestedGroup: 'DIRECT' },
  { id: 'iplocation-proxy', name: 'IP Location Proxy', description: '修改国内软件 IP 归属地的代理规则', category: 'china', suggestedGroup: 'PROXY' },
]

export function buildQuixoticRuleSetUrl(id: string, format: RuleSetFormat): string {
  switch (format) {
    case 'singbox':
      return `${RAW_BASE}/singbox/version5/${id}.srs`
    case 'surge':
      return `${RAW_BASE}/surge/${id}.list`
    case 'loon':
      return `${RAW_BASE}/loon/${id}.list`
    case 'shadowrocket':
      return `${RAW_BASE}/shadowrocket/${id}.list`
    case 'quantumultx':
      return `${RAW_BASE}/quantumultx/${id}.list`
    case 'egern':
      return `${RAW_BASE}/egern/${id}.yaml`
    case 'stash':
      return `${RAW_BASE}/stash/${id}.list`
    case 'mihomo':
    case 'clash':
    case 'text':
    default:
      return `${RAW_BASE}/meta/${id}.list`
  }
}
