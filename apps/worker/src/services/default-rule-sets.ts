import {
  buildQuixoticRuleSetUrl,
  inferQuixoticTargetGroup,
  QUIXOTIC_RULE_SET_PRESETS,
} from '@uni-conf/shared';
import { newId } from '../db/helpers';

export async function ensureDefaultRemoteRuleSets(db: D1Database, ts: string): Promise<void> {
  const existing = await db
    .prepare('SELECT COUNT(*) AS count FROM remote_rule_sets')
    .first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;

  const groups = await listGroupsByName(db);
  const statements = QUIXOTIC_RULE_SET_PRESETS
    .map((preset) => {
      const targetGroupId = resolveTargetGroupId(groups, inferQuixoticTargetGroup(preset));
      if (!targetGroupId) return null;
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

function resolveTargetGroupId(groups: Map<string, string>, groupName: string): string | undefined {
  return groups.get(groupName.toUpperCase()) ?? groups.get('PROXY') ?? [...groups.values()][0];
}
