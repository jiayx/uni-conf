import { AUTO_NODE_GROUP_TYPE_ORDER, isAutoNodeGroupType, ROUTING_POLICY_TEMPLATES } from '@uni-conf/shared';
import type { AppSettings, AutoNodeGroupType, DnsMode, ExportNodeNamingMode, Language, ThemePreference } from '@uni-conf/types';
import { now } from '../db/helpers';

const LANGUAGES = new Set<Language>(['zh', 'en']);
const THEMES = new Set<ThemePreference>(['system', 'light', 'dark']);
const DNS_MODES = new Set<DnsMode>(['compatible', 'smart', 'fake-ip']);
const ROUTING_POLICY_TEMPLATE_IDS = new Set<AppSettings['routingPolicyTemplate']>(
  ROUTING_POLICY_TEMPLATES.map((template) => template.id as AppSettings['routingPolicyTemplate'])
);
const EXPORT_NODE_NAMING_MODES = new Set<ExportNodeNamingMode>([
  'original',
  'region_sequence',
  'source_region_sequence',
  'smart',
]);
const DEFAULT_AUTO_NODE_GROUP_TYPES: AutoNodeGroupType[] = ['url-test'];

export async function getAppSettings(db: D1Database): Promise<AppSettings> {
  const row = await db.prepare('SELECT * FROM app_settings WHERE id = ?')
    .bind('singleton')
    .first<Record<string, unknown>>();

  if (!row) {
    const ts = now();
    await db.prepare('INSERT INTO app_settings (id, updated_at) VALUES (?, ?)')
      .bind('singleton', ts)
      .run();
    return getAppSettings(db);
  }

  return {
    language: normalizeLanguage(row.language),
    theme: normalizeTheme(row.theme),
    routingPolicyTemplate: normalizeRoutingPolicyTemplate(row.routing_policy_template),
    routingOutletPreferences: normalizeOptionalStringMap(row.routing_outlet_preferences),
    dnsMode: normalizeDnsMode(row.dns_mode),
    exportNodeNamingMode: normalizeExportNodeNamingMode(row.export_node_naming_mode),
    defaultExportToken: (row.default_export_token as string | null) ?? undefined,
    showCompatibilityWarnings: normalizeBooleanDefault(row.show_compatibility_warnings, true),
    enableAutoRefresh: normalizeBooleanDefault(row.enable_auto_refresh, true),
    autoRefreshInterval: normalizePositiveInteger(row.auto_refresh_interval, 1440),
    autoNodeGroupsEnabled: normalizeBooleanDefault(row.auto_node_groups_enabled, true),
    autoNodeGroupTypes: normalizeAutoNodeGroupTypes(row.auto_node_group_types),
    autoNodeGroupKeys: normalizeOptionalStringList(row.auto_node_group_keys),
    autoNodeGroupIncludeFlag: normalizeBooleanDefault(row.auto_node_group_include_flag, true),
  };
}

export function normalizeDnsMode(value: unknown): DnsMode {
  return typeof value === 'string' && DNS_MODES.has(value as DnsMode) ? value as DnsMode : 'smart';
}

export function normalizeLanguage(value: unknown): Language {
  return typeof value === 'string' && LANGUAGES.has(value as Language) ? value as Language : 'zh';
}

export function normalizeTheme(value: unknown): ThemePreference {
  return typeof value === 'string' && THEMES.has(value as ThemePreference) ? value as ThemePreference : 'system';
}

export function normalizeRoutingPolicyTemplate(value: unknown): AppSettings['routingPolicyTemplate'] {
  return typeof value === 'string' && ROUTING_POLICY_TEMPLATE_IDS.has(value as AppSettings['routingPolicyTemplate'])
    ? value as AppSettings['routingPolicyTemplate']
    : 'common';
}

export function normalizeExportNodeNamingMode(value: unknown): ExportNodeNamingMode {
  return typeof value === 'string' && EXPORT_NODE_NAMING_MODES.has(value as ExportNodeNamingMode)
    ? value as ExportNodeNamingMode
    : 'smart';
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
