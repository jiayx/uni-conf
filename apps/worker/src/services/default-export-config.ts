import type { ExportConfig } from '@uni-conf/types';
import { mapExportConfig } from '../db/helpers';

export const DEFAULT_EXPORT_CONFIG_ID = 'default-mihomo';

export function generateExportToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function ensureDefaultExportConfig(db: D1Database, ts: string): Promise<ExportConfig> {
  await db.prepare('INSERT OR IGNORE INTO app_settings (id, updated_at) VALUES (?, ?)')
    .bind('singleton', ts)
    .run();

  const settings = await db
    .prepare("SELECT default_export_token FROM app_settings WHERE id = 'singleton'")
    .first<{ default_export_token: string | null }>();

  if (settings?.default_export_token) {
    const byToken = await db
      .prepare('SELECT * FROM export_configs WHERE token = ? AND enabled = 1')
      .bind(settings.default_export_token)
      .first<Record<string, unknown>>();
    if (byToken) return mapExportConfig(byToken);
  }

  const existing = await db
    .prepare('SELECT * FROM export_configs WHERE id = ?')
    .bind(DEFAULT_EXPORT_CONFIG_ID)
    .first<Record<string, unknown>>();

  if (existing) {
    const config = mapExportConfig(existing);
    await setDefaultExportToken(db, config.token, ts);
    return config;
  }

  const token = generateExportToken();
  await db
    .prepare(
      `INSERT INTO export_configs
        (id, name, format, dns_policy, token, enabled, include_collection_ids, include_group_ids, include_rule_ids, include_remote_set_ids, extra_config, created_at, updated_at)
       VALUES (?, '默认 Mihomo 配置', 'mihomo', NULL, ?, 1, '[]', '[]', '[]', '[]', NULL, ?, ?)`
    )
    .bind(DEFAULT_EXPORT_CONFIG_ID, token, ts, ts)
    .run();
  await setDefaultExportToken(db, token, ts);

  const row = await db
    .prepare('SELECT * FROM export_configs WHERE id = ?')
    .bind(DEFAULT_EXPORT_CONFIG_ID)
    .first<Record<string, unknown>>();
  if (!row) throw new Error('Failed to create default export config');
  return mapExportConfig(row);
}

async function setDefaultExportToken(db: D1Database, token: string, ts: string): Promise<void> {
  await db
    .prepare("UPDATE app_settings SET default_export_token = ?, updated_at = ? WHERE id = 'singleton'")
    .bind(token, ts)
    .run();
}
