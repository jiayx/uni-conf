import {
  buildQuixoticRuleSetUrl,
  inferQuixoticTargetGroup,
  isManagedRuleSetActiveForUnmatchedPolicy,
  QUIXOTIC_RULE_SET_PRESETS,
  resolveQuixoticRuleSetBehavior,
  resolveQuixoticRuleSetSortOrder,
} from '@uni-conf/shared';
import { newId } from '../db/helpers';
import type { RemoteRuleSet } from '@uni-conf/types';
import type { UnmatchedTrafficPolicy } from '@uni-conf/types';

type PresetSource = NonNullable<RemoteRuleSet['presetSource']>;
type TargetGroupInfo = { id: string; enabled: boolean };
const QUIXOTIC_DEFAULT_FORMAT: RemoteRuleSet['format'] = 'mihomo';
const SYSTEM_DISABLED_MISSING_TARGET_NOTE = '[uni-conf:auto-disabled:missing-target]';

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

export async function ensureDefaultRemoteRuleSets(
  db: D1Database,
  ts: string,
  unmatchedTrafficPolicy: UnmatchedTrafficPolicy = 'proxy'
): Promise<void> {
  const groups = await listGroupsByName(db);
  const existingPresets = await listExistingPresetRows(db);
  const healthInvalidationIds = new Set<string>();
  const quixoticStatements = QUIXOTIC_RULE_SET_PRESETS
    .map((preset) => {
      const existing = existingPresets.get(presetKey('quixotic', preset.id));
      const targetGroup = resolveTargetGroup(groups, inferQuixoticTargetGroup(preset));
      const sortOrder = resolveQuixoticRuleSetSortOrder(preset.id);
      const url = buildQuixoticRuleSetUrl(preset.id, QUIXOTIC_DEFAULT_FORMAT);
      const behavior = resolveQuixoticRuleSetBehavior(preset.id);
      const notes = `QuixoticHeart/rule-set:${preset.id} ${preset.description}`;
      if (!targetGroup) return disableExistingPreset(db, existing, notes, ts);
      const state = resolveManagedPresetState(
        existing,
        targetGroup.enabled && isManagedRuleSetActiveForUnmatchedPolicy(preset.id, unmatchedTrafficPolicy),
        notes
      );
      if (existing) {
        if (
          existing.url === url
          && existing.format === QUIXOTIC_DEFAULT_FORMAT
          && existing.behavior === behavior
          && existing.target_group_id === targetGroup.id
          && existing.enabled === state.enabled
          && existing.sort_order === sortOrder
          && existing.notes === state.notes
        ) return null;
        if (existing.url !== url || existing.format !== QUIXOTIC_DEFAULT_FORMAT || existing.behavior !== behavior) {
          healthInvalidationIds.add(existing.id);
        }
        return db
          .prepare('UPDATE remote_rule_sets SET url = ?, format = ?, behavior = ?, target_group_id = ?, enabled = ?, sort_order = ?, notes = ?, updated_at = ? WHERE id = ?')
          .bind(url, QUIXOTIC_DEFAULT_FORMAT, behavior, targetGroup.id, state.enabled, sortOrder, state.notes, ts, existing.id);
      }
      return db
        .prepare(
          `INSERT INTO remote_rule_sets
            (id, name, url, format, behavior, preset_source, preset_id, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at)
           VALUES (?, ?, ?, 'mihomo', ?, 'quixotic', ?, ?, 24, ?, ?, NULL, ?, ?, ?)`
        )
        .bind(
          newId(),
          preset.name,
          url,
          behavior,
          preset.id,
          targetGroup.id,
          state.enabled,
          sortOrder,
          state.notes,
          ts,
          ts
        );
    })
    .filter((statement): statement is D1PreparedStatement => Boolean(statement));

  const uniConfStatements = UNI_CONF_REMOTE_RULE_SET_PRESETS
    .map((preset) => {
      const existing = existingPresets.get(presetKey(preset.presetSource, preset.presetId));
      const targetGroup = resolveTargetGroup(groups, preset.targetGroupName);
      if (!targetGroup) return disableExistingPreset(db, existing, preset.notes, ts);
      const state = resolveManagedPresetState(existing, targetGroup.enabled, preset.notes);
      if (existing) {
        if (
          existing.target_group_id === targetGroup.id
          && existing.enabled === state.enabled
          && existing.sort_order === preset.sortOrder
          && existing.url === preset.url
          && existing.format === preset.format
          && existing.behavior === preset.behavior
          && existing.notes === state.notes
        ) return null;
        if (existing.url !== preset.url || existing.format !== preset.format || existing.behavior !== preset.behavior) {
          healthInvalidationIds.add(existing.id);
        }
        return db
          .prepare('UPDATE remote_rule_sets SET url = ?, format = ?, behavior = ?, target_group_id = ?, enabled = ?, sort_order = ?, notes = ?, updated_at = ? WHERE id = ?')
          .bind(preset.url, preset.format, preset.behavior, targetGroup.id, state.enabled, preset.sortOrder, state.notes, ts, existing.id);
      }
      return db
        .prepare(
          `INSERT INTO remote_rule_sets
            (id, name, url, format, behavior, preset_source, preset_id, target_group_id, update_interval, enabled, sort_order, last_updated, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 24, ?, ?, NULL, ?, ?, ?)`
        )
        .bind(
          newId(),
          preset.name,
          preset.url,
          preset.format,
          preset.behavior,
          preset.presetSource,
          preset.presetId,
          targetGroup.id,
          state.enabled,
          preset.sortOrder,
          state.notes,
          ts,
          ts
        );
    })
    .filter((statement): statement is D1PreparedStatement => Boolean(statement));

  const healthInvalidations = Array.from(healthInvalidationIds, (id) => db
    .prepare('DELETE FROM remote_rule_set_source_health WHERE remote_rule_set_id = ?')
    .bind(id));
  const statements = [...quixoticStatements, ...uniConfStatements, ...healthInvalidations];

  if (statements.length > 0) await db.batch(statements);
}

async function listGroupsByName(db: D1Database): Promise<Map<string, TargetGroupInfo>> {
  const { results } = await db
    .prepare('SELECT id, name, enabled FROM groups')
    .all<{ id: string; name: string; enabled: number | boolean | null }>();

  return new Map(results.map((group) => [
    group.name.toUpperCase(),
    { id: group.id, enabled: group.enabled !== 0 && group.enabled !== false },
  ]));
}

async function listExistingPresetRows(db: D1Database): Promise<Map<string, {
  id: string;
  url: string;
  format: RemoteRuleSet['format'];
  behavior: RemoteRuleSet['behavior'];
  target_group_id: string;
  enabled: number;
  sort_order: number;
  notes: string;
}>> {
  const { results } = await db
    .prepare("SELECT id, url, format, behavior, preset_source, preset_id, target_group_id, enabled, sort_order, notes FROM remote_rule_sets WHERE preset_source IN ('quixotic', 'uni-conf') AND preset_id IS NOT NULL")
    .all<{
      id: string;
      url: string;
      format: RemoteRuleSet['format'];
      behavior: RemoteRuleSet['behavior'];
      preset_source: PresetSource;
      preset_id: string;
      target_group_id: string;
      enabled: number;
      sort_order: number;
      notes: string | null;
    }>();

  return new Map(results.map((row) => [
    presetKey(row.preset_source, row.preset_id),
    {
      id: row.id,
      url: row.url,
      format: row.format,
      behavior: row.behavior,
      target_group_id: row.target_group_id,
      enabled: row.enabled ?? 1,
      sort_order: row.sort_order ?? 0,
      notes: row.notes ?? '',
    },
  ]));
}

function resolveTargetGroup(groups: Map<string, TargetGroupInfo>, groupName: string): TargetGroupInfo | undefined {
  return groups.get(groupName.toUpperCase());
}

function disableExistingPreset(
  db: D1Database,
  existing: { id: string; enabled: number; notes: string } | undefined,
  canonicalNotes: string,
  ts: string
): D1PreparedStatement | null {
  if (!existing || (existing.enabled === 0 && !isSystemDisabledForMissingTarget(existing))) return null;
  if (existing.enabled === 0 && existing.notes === withSystemDisabledNote(canonicalNotes)) return null;
  return db
    .prepare('UPDATE remote_rule_sets SET enabled = 0, notes = ?, updated_at = ? WHERE id = ?')
    .bind(withSystemDisabledNote(canonicalNotes), ts, existing.id);
}

function resolveManagedPresetState(
  existing: { enabled: number; notes: string } | undefined,
  targetEnabled: boolean,
  canonicalNotes: string
): { enabled: number; notes: string } {
  if (!targetEnabled) {
    if (existing && existing.enabled === 0 && !isSystemDisabledForMissingTarget(existing)) {
      return { enabled: 0, notes: existing.notes };
    }
    return { enabled: 0, notes: withSystemDisabledNote(canonicalNotes) };
  }
  if (existing && !isSystemDisabledForMissingTarget(existing)) {
    return { enabled: existing.enabled, notes: canonicalNotes };
  }
  return { enabled: 1, notes: canonicalNotes };
}

function isSystemDisabledForMissingTarget(existing: { enabled: number; notes: string }): boolean {
  return existing.enabled === 0 && existing.notes.includes(SYSTEM_DISABLED_MISSING_TARGET_NOTE);
}

function withSystemDisabledNote(notes: string): string {
  if (notes.includes(SYSTEM_DISABLED_MISSING_TARGET_NOTE)) return notes;
  return `${notes}\n${SYSTEM_DISABLED_MISSING_TARGET_NOTE}`;
}

function presetKey(source: PresetSource, id: string): string {
  return `${source}:${id}`;
}
