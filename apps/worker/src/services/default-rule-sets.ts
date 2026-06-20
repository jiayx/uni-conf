import {
  buildQuixoticRuleSetUrl,
  inferQuixoticTargetGroup,
  QUIXOTIC_RULE_SET_PRESETS,
} from '@uni-conf/shared';
import { newId } from '../db/helpers';

export async function ensureDefaultRemoteRuleSets(db: D1Database, ts: string): Promise<void> {
  const groups = await listGroupsByName(db);
  const existingPresets = await listExistingPresetRows(db);
  const statements = QUIXOTIC_RULE_SET_PRESETS
    .map((preset) => {
      const targetGroupId = resolveTargetGroupId(groups, inferQuixoticTargetGroup(preset));
      if (!targetGroupId) return null;
      const existing = existingPresets.get(preset.id);
      if (existing) {
        if (existing.target_group_id === targetGroupId) return null;
        return db
          .prepare('UPDATE remote_rule_sets SET target_group_id = ?, updated_at = ? WHERE id = ?')
          .bind(targetGroupId, ts, existing.id);
      }
      return db
        .prepare(
          `INSERT INTO remote_rule_sets
            (id, name, url, format, preset_source, preset_id, target_group_id, update_interval, enabled, last_updated, notes, created_at, updated_at)
           VALUES (?, ?, ?, 'mihomo', 'quixotic', ?, ?, 24, 1, NULL, ?, ?, ?)`
        )
        .bind(
          newId(),
          preset.name,
          buildQuixoticRuleSetUrl(preset.id, 'mihomo'),
          preset.id,
          targetGroupId,
          `QuixoticHeart/rule-set:${preset.id} ${preset.description}`,
          ts,
          ts
        );
    })
    .filter((statement): statement is D1PreparedStatement => Boolean(statement));

  if (statements.length > 0) await db.batch(statements);
}

async function listGroupsByName(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare('SELECT id, name FROM groups WHERE enabled = 1')
    .all<{ id: string; name: string }>();

  return new Map(results.map((group) => [group.name.toUpperCase(), group.id]));
}

async function listExistingPresetRows(db: D1Database): Promise<Map<string, { id: string; target_group_id: string }>> {
  const { results } = await db
    .prepare("SELECT id, preset_id, target_group_id FROM remote_rule_sets WHERE preset_source = 'quixotic' AND preset_id IS NOT NULL")
    .all<{ id: string; preset_id: string; target_group_id: string }>();

  return new Map(results.map((row) => [row.preset_id, { id: row.id, target_group_id: row.target_group_id }]));
}

function resolveTargetGroupId(groups: Map<string, string>, groupName: string): string | undefined {
  return groups.get(groupName.toUpperCase()) ?? groups.get('PROXY') ?? [...groups.values()][0];
}
