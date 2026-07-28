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

export interface NodeCollectionSummary extends NodeCollection {
  nodeCount: number;
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
  | 'mrs'
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

export type RemoteRuleSetSourceOverrideTarget = Exclude<ExportFormat, 'nodes_base64' | 'nodes_raw'>;
export type RemoteRuleSetSourceOverrides = Partial<Record<RemoteRuleSetSourceOverrideTarget, string>>;

export interface SourceRemoteRuleSetCandidate {
  key: string;
  name: string;
  url: string;
  format: RuleSetFormat;
  behavior: RuleSetBehavior;
  updateInterval: number;
  upstreamTarget?: string;
  referenced: boolean;
}

export interface RuleSetCatalogItemSource {
  sourceId: string;
  url: string;
  format: RuleSetFormat;
  behavior: RuleSetBehavior;
  default: boolean;
  nativeFor: RemoteRuleSetSourceOverrideTarget[];
}

export interface RuleSetCatalogItem {
  id: string;
  name: string;
  category?: string;
  suggestedTarget?: string;
  provisioning?: 'foundation' | 'scenario' | 'optional';
  sortOrder?: number;
  activeForUnmatchedPolicies?: UnmatchedTrafficPolicy[];
  sources: RuleSetCatalogItemSource[];
}

export interface RuleSetCatalog {
  id: string;
  name: string;
  repositoryUrl: string;
  branch: string;
  items: RuleSetCatalogItem[];
  commitSha?: string;
  syncedAt: string;
}

export interface RuleSetCatalogSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  catalogs: RuleSetCatalog[];
}

export interface RemoteRuleSet {
  id: string;
  name: string;
  url: string;
  format: RuleSetFormat;
  behavior: RuleSetBehavior;
  presetSource?: string;
  presetId?: string;
  sourceOverrides: RemoteRuleSetSourceOverrides;
  sourceId?: string;
  sourceRuleSetKey?: string;
  sourceMissing?: boolean;
  sourceHealth?: RemoteRuleSetSourceHealthSnapshot;
  defaultTargetGroupId?: string;
  targetOverrideGroupId?: string | null;
  targetGroupId: string;
  updateInterval: number; // hours
  enabled: boolean;
  sortOrder: number;
  lastUpdated?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type RemoteRuleSetValidationStatus = 'valid' | 'warning' | 'invalid';
export type RemoteRuleSetInspectionMode = 'text' | 'structured';

export interface RemoteRuleSetValidationIssue {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  messageEn: string;
  line?: number;
}

export interface RemoteRuleSetValidationResult {
  status: RemoteRuleSetValidationStatus;
  checkedAt: string;
  url: string;
  format: RuleSetFormat;
  behavior: RuleSetBehavior;
  inspectionMode: RemoteRuleSetInspectionMode;
  httpStatus?: number;
  contentType?: string;
  byteLength: number;
  ruleCount?: number;
  invalidRuleCount: number;
  issues: RemoteRuleSetValidationIssue[];
}

export interface RemoteRuleSetSourceValidationInput {
  url: string;
  targetFormat: RemoteRuleSetSourceOverrideTarget;
  behavior: RuleSetBehavior;
}

export interface RemoteRuleSetSourceValidationItem {
  targetFormat: RemoteRuleSetSourceOverrideTarget;
  result: RemoteRuleSetValidationResult;
}

export interface RemoteRuleSetSourceValidationBatchResult {
  results: RemoteRuleSetSourceValidationItem[];
}

export interface RemoteRuleSetSourceHealthSummary {
  total: number;
  valid: number;
  warning: number;
  invalid: number;
}

export interface RemoteRuleSetSourceHealthResult {
  status: RemoteRuleSetValidationStatus;
  checkedAt: string;
  defaultSource: RemoteRuleSetValidationResult;
  sourceOverrides: RemoteRuleSetSourceValidationItem[];
  summary: RemoteRuleSetSourceHealthSummary;
}

export interface RemoteRuleSetSourceHealthSnapshot extends RemoteRuleSetSourceHealthResult {
  expiresAt: string;
  stale: boolean;
}

export type RemoteRuleSetConversionMode = 'direct' | 'converted' | 'unsupported';

export type RuleSetConversionIssueReason =
  | 'invalid-rule'
  | 'compound-condition'
  | 'unsupported-directive'
  | 'unsupported-option';

export type RuleSetConversionIssueResolution =
  | 'repair-source-rule'
  | 'use-native-source'
  | 'remove-unsupported-option';

export interface RuleSetConversionIssue {
  type: string;
  count: number;
  reason: RuleSetConversionIssueReason;
  resolution: RuleSetConversionIssueResolution;
  examples: string[];
}

export interface RuleSetConversionMapping {
  source: string;
  target: string;
}

export interface RemoteRuleSetConversionPreview {
  checkedAt?: string;
  targetFormat: ExportFormat;
  sourceFormat: RuleSetFormat;
  outputFormat?: RuleSetFormat;
  mode: RemoteRuleSetConversionMode;
  convertedRuleCount: number;
  skippedRuleCount: number;
  skippedRuleTypes: Record<string, number>;
  issues: RuleSetConversionIssue[];
  convertedExamples: RuleSetConversionMapping[];
  convertedExamplesTruncated: boolean;
  contentType?: string;
  preview?: string;
  truncated: boolean;
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
  // Null/undefined inherits the global app setting.
  ruleSetConversionPolicy?: RuleSetConversionPolicy | null;
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
export type UnmatchedTrafficPolicy = 'proxy' | 'direct';
export type RoutingPolicyScenarioId =
  | 'ai-development'
  | 'streaming'
  | 'communication'
  | 'gaming'
  | 'finance'
  | 'brokerage'
  | 'diagnostics'
  | 'platform';
export type DnsResolutionMode = 'single' | 'split';

export interface ExportDnsPolicy {
  additionalRealIpDomains: string[];
  resolutionMode: DnsResolutionMode;
}
export type ExportNodeNamingMode = 'original' | 'region_sequence' | 'source_region_sequence' | 'smart';
export type RuleSetConversionPolicy = 'compatible' | 'strict';
export type AutoNodeGroupType = 'select' | 'url-test' | 'fallback';

export interface AppSettings {
  language: Language;
  theme: ThemePreference;
  unmatchedTrafficPolicy: UnmatchedTrafficPolicy;
  routingPolicyScenarios: RoutingPolicyScenarioId[];
  routingOutletPreferences?: Record<string, string>;
  exportNodeNamingMode: ExportNodeNamingMode;
  dnsResolutionMode: DnsResolutionMode;
  dnsRealIpDomains: string[];
  defaultExportToken?: string;
  // Feature flags
  showCompatibilityWarnings: boolean;
  ruleSetConversionPolicy: RuleSetConversionPolicy;
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
  skippedExistingCount?: number;
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
  /** Import safely convertible Clash/Mihomo rules and rule providers after preview. */
  importStructured?: boolean;
  /** Import every parsed node, or only nodes that do not duplicate/conflict with the current global node inventory. */
  nodeImportMode?: 'all' | 'new-only';
  structuredConflictResolutions?: Record<string, SourceImportConflictResolution>;
}

export type SourceImportConflictResolution = 'keep-existing' | 'use-imported';

export interface SourceStructuredImportSummary {
  rules: number;
  remoteRuleSets: number;
  skippedRules: number;
  duplicateRules: number;
  duplicateRemoteRuleSets: number;
  conflictingRules: number;
  conflictingRemoteRuleSets: number;
  unmappedTargets: string[];
  hasDns: boolean;
  clientSettingKeys: string[];
}

export type SourceImportDiffStatus = 'new' | 'duplicate' | 'conflict' | 'unmapped';

export interface SourceImportFieldChange {
  field: string;
  before?: string;
  after?: string;
}

export interface SourceImportDiffItem {
  key: string;
  label: string;
  status: SourceImportDiffStatus;
  target?: string;
  changes: SourceImportFieldChange[];
  resolvable?: boolean;
}

export interface SourceImportDiffSection {
  total: number;
  items: SourceImportDiffItem[];
  truncated: boolean;
  counts: Record<SourceImportDiffStatus, number>;
}

export interface SourceImportDiff {
  nodes: SourceImportDiffSection;
  rules: SourceImportDiffSection;
  remoteRuleSets: SourceImportDiffSection;
}

export interface SourceImportPreview {
  detectedFormat: SourceFormat;
  nodeCount: number;
  excludedCount: number;
  sourceGroupCount: number;
  groups: SourceNodeGroup[];
  nodes: Array<Pick<ProxyNode, 'name' | 'protocol' | 'server' | 'port' | 'country' | 'countryCode' | 'tags'>>;
  importedObjects: Array<'nodes' | 'source-groups' | 'rules' | 'remote-rule-sets'>;
  preservedOnly: Array<'rules' | 'remote-rule-sets' | 'dns' | 'client-settings'>;
  structured: SourceStructuredImportSummary;
  diff: SourceImportDiff;
}

export interface SourceCreateResult {
  source: ProxySource;
  refresh?: SourceRefreshResult;
  refreshError?: string;
  structuredImport?: Omit<SourceStructuredImportSummary, 'hasDns' | 'clientSettingKeys'>;
  structuredImportError?: string;
  importRun?: SourceImportRun;
}

export type SourceImportRunStatus = 'running' | 'success' | 'partial' | 'undone';

export interface SourceImportRun {
  id: string;
  sourceId?: string;
  sourceName: string;
  format: SourceFormat;
  nodeImportMode: 'all' | 'new-only';
  status: SourceImportRunStatus;
  nodeCount: number;
  addedCount: number;
  updatedCount: number;
  skippedExistingCount: number;
  ruleCount: number;
  remoteRuleSetCount: number;
  skippedRuleCount: number;
  conflictCount: number;
  refreshError?: string;
  structuredError?: string;
  createdAt: string;
  completedAt?: string;
  undoneAt?: string;
  canUndo: boolean;
}

export interface SourceStructuredRetryResult {
  importRun: SourceImportRun;
  structuredImport: Omit<SourceStructuredImportSummary, 'hasDns' | 'clientSettingKeys'>;
}

export interface SourceNodeRetryResult {
  importRun: SourceImportRun;
  refresh: SourceRefreshResult;
}

export interface ExportResult {
  format: ExportFormat;
  capabilityProfile: ExportCapabilityProfile;
  content: string;
  contentType: string;
  warnings: CompatibilityWarning[];
  artifactValidation: ExportArtifactValidationResult;
  readiness: ExportDownloadReadiness;
}

export interface ExportCapabilityProfile {
  id: 'uni-conf-exporter';
  revision: number;
  format: ExportFormat;
}

export interface ExportDownloadReadiness {
  ready: boolean;
  blockingWarnings: CompatibilityWarning[];
}

export interface ExportArtifactValidationIssue {
  code: string;
  path?: string;
  message: string;
  messageEn: string;
}

export interface ExportArtifactValidationResult {
  format: ExportFormat;
  kind: 'yaml' | 'json' | 'ini' | 'subscription';
  valid: boolean;
  issues: ExportArtifactValidationIssue[];
}

export interface CompatibilityWarning {
  /** Stable diagnostic identifier for filtering, analytics, and support. */
  code?: string;
  ruleId?: string;
  groupId?: string;
  nodeId?: string;
  client: ExportFormat;
  level: CompatibilityLevel;
  message: string;
  messageEn: string;
  remediation?: CompatibilityWarningRemediation;
  transformation?: CompatibilityTransformation;
}

export interface CompatibilityTransformation {
  resource: 'rule' | 'remote-rule-set';
  action: 'convert' | 'skip' | 'degrade' | 'omit-option' | 'reorder' | 'block';
  source: string;
  target?: string;
  convertedCount?: number;
  skippedCount?: number;
  reason?: string;
}

export type CompatibilityWarningRemediation =
  | { target: 'sources'; id?: string }
  | { target: 'nodes'; id?: string }
  | { target: 'collections'; id?: string }
  | { target: 'groups'; id?: string }
  | { target: 'rules'; id?: string }
  | {
      target: 'remote-rule-sets';
      id?: string;
      /** Open the native-source editor for this exact export target. */
      sourceOverrideTarget?: RemoteRuleSetSourceOverrideTarget;
    }
  | { target: 'export'; id?: string }
  | { target: 'settings'; section: 'dns' | 'rule-set-conversion' };

export type ResourceDependencyType =
  | 'policy-group'
  | 'rule'
  | 'remote-rule-set'
  | 'export-profile'
  | 'routing-outlet-preference';

export interface ResourceDependency {
  type: ResourceDependencyType;
  id?: string;
  name?: string;
}

export interface ResourceDependencyDetail extends ResourceDependency {
  remediation?: CompatibilityWarningRemediation;
}

export interface ApiErrorDetails {
  dependencies?: ResourceDependencyDetail[];
}

// ============================================================
// Dashboard Stats
// ============================================================

export interface DashboardStats {
  sourceCount: number;
  sourceRefreshFailureCount?: number;
  nodeCount: number;
  enabledNodeCount: number;
  collectionCount: number;
  groupCount: number;
  ruleCount: number;
  exportConfigCount: number;
  defaultExportToken?: string;
  defaultExportFormat?: ExportFormat;
  defaultExportEnabled?: boolean;
  lastRefreshedAt?: string;
  ruleSetHealth?: {
    total: number;
    valid: number;
    warning: number;
    invalid: number;
    stale: number;
    pending: number;
    lastCheckedAt?: string;
  };
}
