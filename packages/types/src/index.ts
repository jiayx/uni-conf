// ============================================================
// Proxy Protocol Types
// ============================================================

export {
  GENERATED_PROTOCOL_SCHEMA_METADATA,
  MAINSTREAM_PROXY_PROTOCOLS,
  MIHOMO_TYPE_TO_PROTOCOL,
  PROXY_PROTOCOL_REGISTRY,
  PROTOCOL_FORM_FIELDS,
  SINGBOX_TYPE_TO_PROTOCOL,
  URI_SCHEME_TO_PROTOCOL,
} from './protocols';
export type {
  MainstreamProxyProtocol,
  MihomoNativeProxy,
  NativeProxyConfig,
  NodeConfigSourceFormat,
  ProtocolFieldDefinition,
  ProtocolFieldOption,
  ProtocolFieldType,
  ProxyProtocol,
  SingboxNativeOutbound,
} from './protocols';
import type { NativeProxyConfig, ProxyProtocol } from './protocols';

export type SourceFormat =
  | 'clash'
  | 'mihomo'
  | 'singbox'
  | 'base64'
  | 'surge'
  | 'loon'
  | 'quantumultx'
  | 'shadowrocket'
  | 'raw'
  | 'auto';

export type SourceType = 'url' | 'manual' | 'file' | 'clipboard';

export type ExportFormat =
  | 'mihomo'
  | 'singbox'
  | 'loon'
  | 'surge'
  | 'shadowrocket'
  | 'quantumultx'
  | 'stash'
  | 'egern'
  | 'nodes_base64'
  | 'nodes_raw';

export type GroupType =
  | 'select'
  | 'url-test'
  | 'fallback'
  | 'load-balance'
  | 'direct'
  | 'reject';

export type RuleType =
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

export type CompatibilityLevel = 'full' | 'partial' | 'convert' | 'unsupported';

// ============================================================
// Core Data Models
// ============================================================

export interface ProxySource {
  id: string;
  name: string;
  type: SourceType;
  url?: string;
  format: SourceFormat;
  enabled: boolean;
  nodeCount: number;
  lastUpdated?: string; // ISO string
  lastRefreshError?: string;
  updateInterval?: number; // minutes, 0 = use global auto-refresh interval
  userAgent?: string;
  notes?: string;
  tags: string[];
  groups: SourceNodeGroup[];
  rawContent?: string;
  // Subscription info (from subscription-userinfo header)
  uploadBytes?: number;
  downloadBytes?: number;
  totalBytes?: number;
  expireTime?: number; // Unix timestamp
  createdAt: string;
  updatedAt: string;
}

export interface SourceNodeGroup {
  name: string;
  type?: string;
  memberNames: string[];
}

export interface NormalizedProxyConfig {
  protocol: ProxyProtocol;
  server: string;
  port: number;
  // Common fields
  password?: string;
  uuid?: string;
  // TLS
  tls?: boolean;
  sni?: string;
  skipCertVerify?: boolean;
  // Transport
  network?: 'tcp' | 'ws' | 'http' | 'h2' | 'grpc' | 'quic';
  wsPath?: string;
  wsHeaders?: Record<string, string>;
  // Protocol specific (stored as opaque object)
  extra: Record<string, unknown>;
}

export interface ProxyNode {
  id: string;
  sourceId: string;
  name: string;
  protocol: ProxyProtocol;
  server: string;
  port: number;
  country?: string;
  countryCode?: string; // ISO 3166-1 alpha-2
  enabled: boolean;
  tags: string[];
  notes?: string;
  rawConfig: Record<string, unknown> & Partial<NativeProxyConfig>;
  parsedConfig: NormalizedProxyConfig;
  isManual: boolean;
  createdAt: string;
  updatedAt: string;
}

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'regex'
  | 'not_regex'
  | 'equals'
  | 'not_equals'
  | 'in'
  | 'not_in';

export interface NodeFilter {
  id: string;
  field: 'name' | 'server' | 'protocol' | 'country' | 'countryCode' | 'tag' | 'sourceId';
  operator: FilterOperator;
  value: string | string[];
  enabled: boolean;
}

export interface NodeRename {
  id: string;
  type: 'replace' | 'regex' | 'prefix' | 'suffix' | 'strip_emoji' | 'standardize_country' | 'auto_number';
  pattern?: string;
  replacement?: string;
  enabled: boolean;
  order: number;
}

export type DedupStrategy = 'name' | 'server_port' | 'protocol_server_port' | 'full_config';

export type SortStrategy =
  | 'country'
  | 'name'
  | 'source'
  | 'protocol'
  | 'manual';

export interface NodeCollection {
  id: string;
  name: string;
  sourceIds: string[]; // empty = all sources
  nodeIds: string[]; // explicit node selection (for manual picks)
  filters: NodeFilter[];
  renames: NodeRename[];
  dedup: DedupStrategy;
  sort: SortStrategy;
  sortCountryOrder?: string[]; // custom country order
  enabled: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyGroup {
  id: string;
  name: string;
  type: GroupType;
  collectionIds: string[];
  groupIds: string[]; // nested groups
  builtins: ('DIRECT' | 'REJECT')[];
  testUrl?: string;
  interval?: number; // seconds
  tolerance?: number;
  lazy?: boolean;
  enabled: boolean;
  order: number;
  isBuiltin: boolean; // fixed built-in groups (PROXY, AI, etc.)
  outletRef?: string; // stable reference for routing outlet preferences
  createdAt: string;
  updatedAt: string;
}

export interface ClientCompatibility {
  client: ExportFormat;
  level: CompatibilityLevel;
  note?: string;
}

export interface ProxyRule {
  id: string;
  name?: string;
  type: RuleType;
  payload: string;
  noResolve?: boolean;
  targetGroupId: string;
  enabled: boolean;
  order: number;
  notes?: string;
  compatibility: ClientCompatibility[];
  createdAt: string;
  updatedAt: string;
}

export type RuleSetFormat =
  | 'clash'
  | 'mihomo'
  | 'singbox'
  | 'surge'
  | 'loon'
  | 'shadowrocket'
  | 'quantumultx'
  | 'egern'
  | 'stash'
  | 'text';

export type RuleSetBehavior = 'domain' | 'ipcidr' | 'classical';

export interface RemoteRuleSet {
  id: string;
  name: string;
  url: string;
  format: RuleSetFormat;
  behavior: RuleSetBehavior;
  presetSource?: 'quixotic' | 'uni-conf';
  presetId?: string;
  targetGroupId: string;
  updateInterval: number; // hours
  enabled: boolean;
  sortOrder: number;
  lastUpdated?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Export Config
// ============================================================

export interface ExportConfig {
  id: string;
  name: string;
  format: ExportFormat;
  token: string; // for /sub/:token/:format URLs
  enabled: boolean;
  includeCollectionIds: string[];
  includeGroupIds: string[];
  includeRuleIds: string[];
  includeRemoteSetIds: string[];
  // Format-specific overrides
  extraConfig?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// App Settings
// ============================================================

export type Language = 'zh' | 'en';
export type ThemePreference = 'system' | 'light' | 'dark';
export type RoutingPolicyTemplateId =
  | 'empty'
  | 'minimal'
  | 'common'
  | 'ai'
  | 'streaming'
  | 'router'
  | 'extended';
export type DnsMode = 'compatible' | 'smart' | 'fake-ip';
export type ExportNodeNamingMode = 'original' | 'region_sequence' | 'source_region_sequence' | 'smart';
export type AutoNodeGroupType = 'select' | 'url-test' | 'fallback';

export interface AppSettings {
  language: Language;
  theme: ThemePreference;
  routingPolicyTemplate: RoutingPolicyTemplateId;
  routingOutletPreferences?: Record<string, string>;
  dnsMode: DnsMode;
  exportNodeNamingMode: ExportNodeNamingMode;
  defaultExportToken?: string;
  // Feature flags
  showCompatibilityWarnings: boolean;
  enableAutoRefresh: boolean;
  autoRefreshInterval: number; // minutes
  autoNodeGroupsEnabled: boolean;
  autoNodeGroupTypes: AutoNodeGroupType[];
  autoNodeGroupKeys?: string[];
  autoNodeGroupIncludeFlag: boolean;
}

export type AppSettingsPatch = Partial<Omit<AppSettings, 'routingOutletPreferences' | 'defaultExportToken' | 'autoNodeGroupKeys'>> & {
  routingOutletPreferences?: Record<string, string> | null;
  defaultExportToken?: string | null;
  autoNodeGroupKeys?: string[] | null;
};

// ============================================================
// API Request/Response Types
// ============================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SourceRefreshResult {
  sourceId: string;
  success: boolean;
  nodeCount: number;
  addedCount: number;
  updatedCount?: number;
  removedCount: number;
  excludedCount?: number;
  sourceGroupCount?: number;
  format?: string;
  error?: string;
}

export type SourceCreateInput = Omit<
  ProxySource,
  'id' | 'name' | 'type' | 'format' | 'enabled' | 'nodeCount' | 'tags' | 'groups' | 'rawContent' | 'createdAt' | 'updatedAt'
> & {
  name?: string;
  type?: SourceType;
  format?: SourceFormat;
  enabled?: boolean;
  tags?: string[];
  refreshAfterCreate?: boolean;
};

export interface SourceImportInput {
  name?: string;
  content: string;
  format?: SourceFormat;
  notes?: string;
  tags?: string[];
}

export interface SourceCreateResult {
  source: ProxySource;
  refresh?: SourceRefreshResult;
  refreshError?: string;
}

export interface ExportResult {
  format: ExportFormat;
  content: string;
  contentType: string;
  warnings: CompatibilityWarning[];
}

export interface CompatibilityWarning {
  ruleId?: string;
  groupId?: string;
  nodeId?: string;
  client: ExportFormat;
  level: CompatibilityLevel;
  message: string;
  messageEn: string;
}

// ============================================================
// Dashboard Stats
// ============================================================

export interface DashboardStats {
  sourceCount: number;
  nodeCount: number;
  enabledNodeCount: number;
  collectionCount: number;
  groupCount: number;
  ruleCount: number;
  exportConfigCount: number;
  defaultExportToken?: string;
  defaultExportFormat?: ExportFormat;
  lastRefreshedAt?: string;
}
