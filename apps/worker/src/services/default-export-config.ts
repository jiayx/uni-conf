import type { ExportConfig } from '@uni-conf/types';
import { mapExportConfig } from '../db/helpers';
import { DEFAULT_WORKSPACE_ID, defaultExportConfigId } from './workspaces';

export const DEFAULT_EXPORT_CONFIG_ID = 'default-mihomo';
export const DEFAULT_EXPORT_CONFIG_NAME = 'UniConf';

export function generateExportToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function ensureDefaultExportConfig(
  db: D1Database,
  ts: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<ExportConfig> {
  await db.prepare('INSERT OR IGNORE INTO app_settings (id, updated_at) VALUES (?, ?)')
    .bind(workspaceId, ts)
    .run();

  const settings = await db
    .prepare('SELECT default_export_token FROM app_settings WHERE id = ?')
    .bind(workspaceId)
    .first<{ default_export_token: string | null }>();

  if (settings?.default_export_token) {
    const byToken = await db
      .prepare('SELECT * FROM export_configs WHERE token = ? AND workspace_id = ? AND enabled = 1')
      .bind(settings.default_export_token, workspaceId)
      .first<Record<string, unknown>>();
    if (byToken) {
      const config = mapExportConfig(byToken);
      await ensureDefaultExportConfigName(db, config, ts, workspaceId);
      return config;
    }
  }

  const configId = defaultExportConfigId(workspaceId);
  const existing = await db
    .prepare('SELECT * FROM export_configs WHERE id = ? AND workspace_id = ?')
    .bind(configId, workspaceId)
    .first<Record<string, unknown>>();

  if (existing) {
    const config = mapExportConfig(existing);
    await ensureDefaultExportConfigName(db, config, ts, workspaceId);
    await setDefaultExportToken(db, config.token, ts, workspaceId);
    return config;
  }

  const token = generateExportToken();
  await db
    .prepare(
      `INSERT INTO export_configs
        (id, name, format, token, enabled, include_collection_ids, include_group_ids, include_rule_ids, include_remote_set_ids, created_at, updated_at, workspace_id)
       VALUES (?, 'UniConf', 'mihomo', ?, 1, '[]', '[]', '[]', '[]', ?, ?, ?)`
    )
    .bind(configId, token, ts, ts, workspaceId)
    .run();
  await setDefaultExportToken(db, token, ts, workspaceId);

  const row = await db
    .prepare('SELECT * FROM export_configs WHERE id = ? AND workspace_id = ?')
    .bind(configId, workspaceId)
    .first<Record<string, unknown>>();
  if (!row) throw new Error('Failed to create default export config');
  return mapExportConfig(row);
}

async function ensureDefaultExportConfigName(
  db: D1Database,
  config: ExportConfig,
  ts: string,
  workspaceId: string,
): Promise<void> {
  if (config.name === DEFAULT_EXPORT_CONFIG_NAME) return;
  await db.prepare('UPDATE export_configs SET name = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .bind(DEFAULT_EXPORT_CONFIG_NAME, ts, config.id, workspaceId)
    .run();
  config.name = DEFAULT_EXPORT_CONFIG_NAME;
}

async function setDefaultExportToken(
  db: D1Database,
  token: string,
  ts: string,
  workspaceId: string,
): Promise<void> {
  await db
    .prepare('UPDATE app_settings SET default_export_token = ?, updated_at = ? WHERE id = ?')
    .bind(token, ts, workspaceId)
    .run();
}
