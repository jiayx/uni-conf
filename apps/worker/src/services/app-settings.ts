import { ALL_ROUTING_POLICY_SCENARIO_IDS, AUTO_NODE_GROUP_TYPE_ORDER, DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES, DEFAULT_ROUTING_POLICY_SCENARIOS, isAutoNodeGroupType, normalizeDnsRealIpDomainList } from '@uni-conf/shared';
import type { AppSettings, AutoNodeGroupType, DnsResolutionMode, ExportNodeNamingMode, Language, RoutingPolicyScenarioId, RuleSetConversionPolicy, ThemePreference, UnmatchedTrafficPolicy } from '@uni-conf/types';

const LANGUAGES = new Set<Language>(['zh', 'en']);
const THEMES = new Set<ThemePreference>(['system', 'light', 'dark']);
const UNMATCHED_TRAFFIC_POLICIES = new Set<UnmatchedTrafficPolicy>(['proxy', 'direct']);
const ROUTING_POLICY_SCENARIO_IDS = new Set<RoutingPolicyScenarioId>(ALL_ROUTING_POLICY_SCENARIO_IDS);
const EXPORT_NODE_NAMING_MODES = new Set<ExportNodeNamingMode>([
  'original',
  'region_sequence',
  'source_region_sequence',
  'smart',
]);
const RULE_SET_CONVERSION_POLICIES = new Set<RuleSetConversionPolicy>(['compatible', 'strict']);
const DNS_RESOLUTION_MODES = new Set<DnsResolutionMode>(['single', 'split']);
const DEFAULT_AUTO_NODE_GROUP_TYPES: AutoNodeGroupType[] = ['url-test'];

export async function getAppSettings(db: D1Database): Promise<AppSettings> {
  const row = await db.prepare('SELECT * FROM app_settings WHERE id = ?')
    .bind('singleton')
    .first<Record<string, unknown>>();

  if (!row) {
    throw new Error('Application settings are not initialized');
  }

  return {
    language: normalizeLanguage(row.language),
    theme: normalizeTheme(row.theme),
    unmatchedTrafficPolicy: normalizeUnmatchedTrafficPolicy(row.unmatched_traffic_policy),
    routingPolicyScenarios: normalizeRoutingPolicyScenarios(row.routing_policy_scenarios),
    routingOutletPreferences: normalizeOptionalStringMap(row.routing_outlet_preferences),
    exportNodeNamingMode: normalizeExportNodeNamingMode(row.export_node_naming_mode),
    dnsResolutionMode: normalizeDnsResolutionMode(row.dns_resolution_mode),
    dnsRealIpDomains: normalizeDnsRealIpDomains(row.dns_real_ip_domains),
    defaultExportToken: normalizeOptionalString(row.default_export_token),
    showCompatibilityWarnings: normalizeBooleanDefault(row.show_compatibility_warnings, true),
    ruleSetConversionPolicy: normalizeRuleSetConversionPolicy(row.rule_set_conversion_policy),
    enableAutoRefresh: normalizeBooleanDefault(row.enable_auto_refresh, true),
    autoRefreshInterval: normalizePositiveInteger(
      row.auto_refresh_interval,
      DEFAULT_AUTO_REFRESH_INTERVAL_MINUTES,
    ),
    autoNodeGroupsEnabled: normalizeBooleanDefault(row.auto_node_groups_enabled, true),
    autoNodeGroupTypes: normalizeAutoNodeGroupTypes(row.auto_node_group_types),
    autoNodeGroupKeys: normalizeOptionalStringList(row.auto_node_group_keys),
    autoNodeGroupIncludeFlag: normalizeBooleanDefault(row.auto_node_group_include_flag, true),
  };
}

export function normalizeLanguage(value: unknown): Language {
  return typeof value === 'string' && LANGUAGES.has(value as Language) ? value as Language : 'zh';
}

export function normalizeTheme(value: unknown): ThemePreference {
  return typeof value === 'string' && THEMES.has(value as ThemePreference) ? value as ThemePreference : 'system';
}

export function normalizeUnmatchedTrafficPolicy(value: unknown): UnmatchedTrafficPolicy {
  return typeof value === 'string' && UNMATCHED_TRAFFIC_POLICIES.has(value as UnmatchedTrafficPolicy)
    ? value as UnmatchedTrafficPolicy
    : 'proxy';
}

export function normalizeRoutingPolicyScenarios(value: unknown): RoutingPolicyScenarioId[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? parseJsonArrayOrUndefined(value)
      : undefined;
  if (!rawItems) return [...DEFAULT_ROUTING_POLICY_SCENARIOS];
  const selected = new Set(
    rawItems.filter((item): item is RoutingPolicyScenarioId =>
      typeof item === 'string' && ROUTING_POLICY_SCENARIO_IDS.has(item as RoutingPolicyScenarioId)),
  );
  return ALL_ROUTING_POLICY_SCENARIO_IDS.filter((id) => selected.has(id));
}

export function normalizeExportNodeNamingMode(value: unknown): ExportNodeNamingMode {
  return typeof value === 'string' && EXPORT_NODE_NAMING_MODES.has(value as ExportNodeNamingMode)
    ? value as ExportNodeNamingMode
    : 'smart';
}

export function normalizeRuleSetConversionPolicy(value: unknown): RuleSetConversionPolicy {
  return typeof value === 'string' && RULE_SET_CONVERSION_POLICIES.has(value as RuleSetConversionPolicy)
    ? value as RuleSetConversionPolicy
    : 'compatible';
}

export function normalizeDnsResolutionMode(value: unknown): DnsResolutionMode {
  return typeof value === 'string' && DNS_RESOLUTION_MODES.has(value as DnsResolutionMode)
    ? value as DnsResolutionMode
    : 'split';
}

export function normalizeDnsRealIpDomains(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? parseJsonArray(value)
      : [];
  return normalizeDnsRealIpDomainList(rawItems) ?? [];
}

export function normalizeBooleanDefault(value: unknown, defaultValue: boolean): boolean {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
}

export function normalizePositiveInteger(value: unknown, defaultValue: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : defaultValue;
}

export function normalizeAutoNodeGroupTypes(value: unknown): AutoNodeGroupType[] {
  if (value === null || value === undefined) return DEFAULT_AUTO_NODE_GROUP_TYPES;
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? parseJsonArrayOrUndefined(value)
      : undefined;
  if (!rawItems) return DEFAULT_AUTO_NODE_GROUP_TYPES;
  if (rawItems.length === 0) return [];
  const types = rawItems
    .map((item) => typeof item === 'string' ? item : '')
    .filter(isAutoNodeGroupType);
  const uniqueTypes = [...new Set(types)];
  return uniqueTypes.length > 0
    ? AUTO_NODE_GROUP_TYPE_ORDER.filter((type) => uniqueTypes.includes(type))
    : DEFAULT_AUTO_NODE_GROUP_TYPES;
}

export function normalizeOptionalStringList(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? parseJsonArray(value)
      : [];
  return rawItems
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
}

export function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeOptionalStringMap(value: unknown): Record<string, string> | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === 'string' ? parseJsonObject(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const entries = Object.entries(parsed)
    .map(([key, item]) => [
      key.trim(),
      typeof item === 'string' ? item.trim() : '',
    ])
    .filter(([key, item]) => key && item);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonArrayOrUndefined(value: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
