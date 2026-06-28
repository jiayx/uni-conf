import {
  buildQuixoticRuleSetUrl,
  inferQuixoticTargetGroup,
  QUIXOTIC_RULE_SET_PRESETS,
  resolveQuixoticRuleSetSortOrder,
} from '@uni-conf/shared';
import { newId } from '../db/helpers';
import type { RemoteRuleSet } from '@uni-conf/types';

type PresetSource = NonNullable<RemoteRuleSet['presetSource']>;
const QUIXOTIC_DEFAULT_FORMAT: RemoteRuleSet['format'] = 'mihomo';
const QUIXOTIC_DEFAULT_BEHAVIOR: RemoteRuleSet['behavior'] = 'classical';

const UNI_CONF_REMOTE_RULE_SET_PRESETS: Array<{
  presetSource: PresetSource;
  presetId: string;
  name: string;
  url: string;
  format: RemoteRuleSet['format'];
  behavior: RemoteRuleSet['behavior'];
  targetGroupName: string;
  sortOrder: number;
  notes: string;
}> = [
  {
    presetSource: 'uni-conf',
    presetId: 'telegram',
    name: 'Telegram',
    url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.list',
    format: 'text',
    behavior: 'domain',
    targetGroupName: 'Telegram',
    sortOrder: 50,
    notes: 'UniConf built-in: MetaCubeX/meta-rules-dat geosite telegram domain list',
  },
];

export async function ensureDefaultRemoteRuleSets(db: D1Database, ts: string): Promise<void> {
  const groups = await listGroupsByName(db);
  const existingPresets = await listExistingPresetRows(db);
  const quixoticStatements = QUIXOTIC_RULE_SET_PRESETS
    .map((preset) => {
      const targetGroupId = resolveTargetGroupId(groups, inferQuixoticTargetGroup(preset));
      const sortOrder = resolveQuixoticRuleSetSortOrder(preset.id);
      const url = buildQuixoticRuleSetUrl(preset.id, QUIXOTIC_DEFAULT_FORMAT);
      if (!targetGroupId) return null;
      const existing = existingPresets.get(presetKey('quixotic', preset.id));
      if (existing) {
        if (
          existing.url === url
          && existing.format === QUIXOTIC_DEFAULT_FORMAT
          && existing.behavior === QUIXOTIC_DEFAULT_BEHAVIOR
          && existing.target_group_id === targetGroupId
          && existing.sort_order === sortOrder
        ) return null;
        return db
          .prepare('UPDATE remote_rule_sets SET url = ?, format = ?, behavior = ?, target_group_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
          .bind(url, QUIXOTIC_DEFAULT_FORMAT, QUIXOTIC_DEFAULT_BEHAVIOR, targetGroupId, sortOrder, ts, existing.id);
      }
      return db
        .prepare(
          `INSERT INTO remote_rule_sets
            (id, name, url, format, behavior, preset_source, preset_id, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at)
           VALUES (?, ?, ?, 'mihomo', 'classical', 'quixotic', ?, ?, 24, 1, ?, NULL, ?, ?, ?)`
        )
        .bind(
          newId(),
          preset.name,
          url,
          preset.id,
          targetGroupId,
          sortOrder,
          `QuixoticHeart/rule-set:${preset.id} ${preset.description}`,
          ts,
          ts
        );
    })
    .filter((statement): statement is D1PreparedStatement => Boolean(statement));

  const uniConfStatements = UNI_CONF_REMOTE_RULE_SET_PRESETS
    .map((preset) => {
      const targetGroupId = resolveTargetGroupId(groups, preset.targetGroupName);
      if (!targetGroupId) return null;
      const existing = existingPresets.get(presetKey(preset.presetSource, preset.presetId));
      if (existing) {
        if (
          existing.target_group_id === targetGroupId
          && existing.sort_order === preset.sortOrder
          && existing.url === preset.url
          && existing.format === preset.format
          && existing.behavior === preset.behavior
        ) return null;
        return db
          .prepare('UPDATE remote_rule_sets SET url = ?, format = ?, behavior = ?, target_group_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
          .bind(preset.url, preset.format, preset.behavior, targetGroupId, preset.sortOrder, ts, existing.id);
      }
      return db
        .prepare(
          `INSERT INTO remote_rule_sets
            (id, name, url, format, behavior, preset_source, preset_id, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 24, 1, ?, NULL, ?, ?, ?)`
        )
        .bind(
          newId(),
          preset.name,
          preset.url,
          preset.format,
          preset.behavior,
          preset.presetSource,
          preset.presetId,
          targetGroupId,
          preset.sortOrder,
          preset.notes,
          ts,
          ts
        );
    })
    .filter((statement): statement is D1PreparedStatement => Boolean(statement));

  const statements = [...quixoticStatements, ...uniConfStatements];

  if (statements.length > 0) await db.batch(statements);
}

async function listGroupsByName(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare('SELECT id, name FROM groups WHERE enabled = 1')
    .all<{ id: string; name: string }>();

  return new Map(results.map((group) => [group.name.toUpperCase(), group.id]));
}

async function listExistingPresetRows(db: D1Database): Promise<Map<string, {
  id: string;
  url: string;
  format: RemoteRuleSet['format'];
  behavior: RemoteRuleSet['behavior'];
  target_group_id: string;
  sort_order: number;
}>> {
  const { results } = await db
    .prepare("SELECT id, url, format, behavior, preset_source, preset_id, target_group_id, sort_order FROM remote_rule_sets WHERE preset_source IN ('quixotic', 'uni-conf') AND preset_id IS NOT NULL")
    .all<{
      id: string;
      url: string;
      format: RemoteRuleSet['format'];
      behavior: RemoteRuleSet['behavior'];
      preset_source: PresetSource;
      preset_id: string;
      target_group_id: string;
      sort_order: number;
    }>();

  return new Map(results.map((row) => [
    presetKey(row.preset_source, row.preset_id),
    {
      id: row.id,
      url: row.url,
      format: row.format,
      behavior: row.behavior,
      target_group_id: row.target_group_id,
      sort_order: row.sort_order ?? 0,
    },
  ]));
}

function resolveTargetGroupId(groups: Map<string, string>, groupName: string): string | undefined {
  return groups.get(groupName.toUpperCase()) ?? groups.get('PROXY') ?? [...groups.values()][0];
}

function presetKey(source: PresetSource, id: string): string {
  return `${source}:${id}`;
}
