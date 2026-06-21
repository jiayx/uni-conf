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
    showCompatibilityWarnings: Boolean(row.show_compatibility_warnings),
    enableAutoRefresh: Boolean(row.enable_auto_refresh),
    autoRefreshInterval: row.auto_refresh_interval as number,
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
