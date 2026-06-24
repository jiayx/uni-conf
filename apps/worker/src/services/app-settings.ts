import type { AppSettings, DnsMode, ExportNodeNamingMode } from '@uni-conf/types';
import { now } from '../db/helpers';

const DNS_MODES = new Set<DnsMode>(['compatible', 'smart', 'fake-ip']);
const EXPORT_NODE_NAMING_MODES = new Set<ExportNodeNamingMode>([
  'original',
  'region_sequence',
  'source_region_sequence',
  'smart',
]);

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
    language: row.language as AppSettings['language'],
    theme: row.theme as AppSettings['theme'],
    routingPolicyTemplate: (row.routing_policy_template as AppSettings['routingPolicyTemplate'] | null) ?? 'common',
    dnsMode: normalizeDnsMode(row.dns_mode),
    exportNodeNamingMode: normalizeExportNodeNamingMode(row.export_node_naming_mode),
    defaultExportToken: (row.default_export_token as string | null) ?? undefined,
    showCompatibilityWarnings: normalizeBooleanDefault(row.show_compatibility_warnings, true),
    enableAutoRefresh: normalizeBooleanDefault(row.enable_auto_refresh, true),
    autoRefreshInterval: normalizePositiveInteger(row.auto_refresh_interval, 1440),
  };
}

export function normalizeDnsMode(value: unknown): DnsMode {
  return typeof value === 'string' && DNS_MODES.has(value as DnsMode) ? value as DnsMode : 'smart';
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
