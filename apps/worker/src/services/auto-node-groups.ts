import {
  AUTO_NODE_GROUP_PREFIX,
  countryCodeToFlag,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_NODE_POOL_COLLECTION_ID,
  DEFAULT_NODE_POOL_PREFIX,
} from '@uni-conf/shared';
import { jsonStringify, newId } from '../db/helpers';
import { enabledNodeRowsQuery } from './enabled-node-rows';
import { getAppSettings } from './app-settings';
import type { AutoNodeGroupType } from '@uni-conf/types';

interface AutoNodeGroupMarker {
  key: string;
  scope: 'country' | 'tag';
  countryCode?: string;
  tagKey?: string;
  type: AutoNodeGroupType;
}

interface CountrySummary {
  countryCode: string;
  country: string;
}

interface AutoNodeGroupPlan {
  key: string;
  name: string;
  type: AutoNodeGroupType;
  filters: Array<Record<string, unknown>>;
  markerText: string;
}

const EXCLUDE_HIGH_MULTIPLIER_FILTER = {
  id: 'auto-exclude-high-multiplier',
  field: 'tag',
  operator: 'not_in',
  value: ['high-multiplier'],
  enabled: true,
} as const;
const HIGH_MULTIPLIER_TAG_PATTERN = '%"high-multiplier"%';

const TAG_GROUPS = [
  {
    key: 'streaming',
    name: 'Streaming Auto',
    tags: ['streaming', 'unlock'],
  },
  {
    key: 'native',
    name: 'Native Auto',
    tags: ['residential', 'native-ip'],
  },
] as const;

export async function syncAutoNodeGroups(db: D1Database, ts: string): Promise<void> {
  const settings = await getAppSettings(db);
  await ensureDefaultNodePoolCollection(db, ts);
  const enabledTypes = settings.autoNodeGroupsEnabled ? settings.autoNodeGroupTypes : [];
  const autoCollections = await listAutoCollections(db);

  if (enabledTypes.length === 0) {
    for (const item of autoCollections) {
      await deleteCollectionAndLinkedGroups(db, item.id);
    }
    return;
  }

  const countries = await listCountriesWithNodes(db);
  const tagKeys = await listTagGroupKeysWithNodes(db);
  const selectedKeys = settings.autoNodeGroupKeys !== undefined ? new Set(settings.autoNodeGroupKeys) : null;
  const plans = buildAutoNodeGroupPlans(countries, tagKeys, enabledTypes, settings.autoNodeGroupIncludeFlag)
    .filter((plan) => selectedKeys === null || selectedKeys.has(plan.key));
  const planKeys = new Set(plans.map((plan) => plan.key));

  for (const item of autoCollections) {
    if (planKeys.has(item.marker.key)) continue;
    await deleteCollectionAndLinkedGroups(db, item.id);
  }

  const existingByKey = new Map(
    autoCollections.map((item) => [item.marker.key, item])
  );

  for (const plan of plans) {
    const existing = existingByKey.get(plan.key);

    if (existing) {
      await updateAutoCollection(db, existing.id, plan.name, plan.filters, plan.markerText, ts);
      await ensureLinkedGroup(db, existing.id, plan.name, plan.type, ts);
    } else {
      const collectionId = newId();
      await createAutoCollection(db, collectionId, plan.name, plan.filters, plan.markerText, ts);
      await createLinkedGroup(db, collectionId, plan.name, plan.type, ts);
    }
  }

}

async function ensureDefaultNodePoolCollection(db: D1Database, ts: string): Promise<void> {
  const filters = jsonStringify([{ ...EXCLUDE_HIGH_MULTIPLIER_FILTER }]);
  await db
    .prepare(
      `INSERT OR IGNORE INTO collections
        (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at)
       VALUES (?, '默认可用节点', '[]', '[]', ?, '[]', 'full_config', 'name', '[]', 1, ?, ?, ?)`
    )
    .bind(DEFAULT_NODE_POOL_COLLECTION_ID, filters, DEFAULT_NODE_POOL_PREFIX, ts, ts)
    .run();
  await db
    .prepare(
      `UPDATE collections SET
        name = '默认可用节点', source_ids = '[]', node_ids = '[]',
        filters = ?, renames = '[]', dedup = 'full_config', sort = 'name',
        sort_country_order = '[]', enabled = 1, notes = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(filters, DEFAULT_NODE_POOL_PREFIX, ts, DEFAULT_NODE_POOL_COLLECTION_ID)
    .run();
}

async function listCountriesWithNodes(db: D1Database): Promise<CountrySummary[]> {
  const { results } = await db
    .prepare(
      `SELECT country_code, MAX(country) AS country, COUNT(*) AS node_count
       FROM (${enabledNodeRowsQuery()}) enabled_nodes
       WHERE tags NOT LIKE ?
         AND country_code IS NOT NULL
         AND country_code != ''
       GROUP BY country_code
       ORDER BY node_count DESC, country_code ASC`
    )
    .bind(HIGH_MULTIPLIER_TAG_PATTERN)
    .all<{ country_code: string; country: string | null; node_count: number }>();

  return results.map((row) => ({
    countryCode: row.country_code.trim().toUpperCase(),
    country: row.country ?? row.country_code,
  }));
}

async function listTagGroupKeysWithNodes(db: D1Database): Promise<string[]> {
  const keys: string[] = [];
  for (const group of TAG_GROUPS) {
    const conditions = group.tags.map(() => 'tags LIKE ?').join(' OR ');
    const row = await db
      .prepare(`SELECT COUNT(*) AS node_count FROM (${enabledNodeRowsQuery()}) enabled_nodes WHERE tags NOT LIKE ? AND (${conditions})`)
      .bind(HIGH_MULTIPLIER_TAG_PATTERN, ...group.tags.map((tag) => `%"${tag}"%`))
      .first<{ node_count: number }>();
    if ((row?.node_count ?? 0) > 0) keys.push(group.key);
  }
  return keys;
}

export function buildAutoNodeGroupPlans(
  countries: CountrySummary[],
  tagKeys: string[],
  groupTypes: AutoNodeGroupType[] = ['url-test'],
  includeFlag = true
): AutoNodeGroupPlan[] {
  const countryPlans = groupTypes.flatMap((type) =>
    countries.map((country) => {
      const marker = makeCountryAutoNodeGroupMarker(country.countryCode, type);
      return {
        key: marker.key,
        name: makeAutoGroupName(country.countryCode, type, includeFlag),
        type,
        filters: withDefaultAutoFilters([makeCountryFilter(country.countryCode)]),
        markerText: marker.text,
      };
    })
  );

  const tagKeySet = new Set(tagKeys);
  const tagPlans = groupTypes.flatMap((type) =>
    TAG_GROUPS
      .filter((group) => tagKeySet.has(group.key))
      .map((group) => {
        const marker = makeTagAutoNodeGroupMarker(group.key, type);
        return {
          key: marker.key,
          name: makeTagAutoGroupName(group.name, type),
          type,
          filters: withDefaultAutoFilters([makeTagFilter(group.key, group.tags)]),
          markerText: marker.text,
        };
      })
  );

  return [...countryPlans, ...tagPlans];
}

async function listAutoCollections(db: D1Database): Promise<Array<{ id: string; marker: AutoNodeGroupMarker }>> {
  const { results } = await db
    .prepare(`SELECT id, notes FROM collections WHERE notes LIKE ?`)
    .bind(`${AUTO_NODE_GROUP_PREFIX}%`)
    .all<{ id: string; notes: string | null }>();

  return results
    .map((row) => ({ id: row.id, marker: parseAutoNodeGroupMarker(row.notes) }))
    .filter((item): item is { id: string; marker: AutoNodeGroupMarker } => Boolean(item.marker));
}

async function createAutoCollection(
  db: D1Database,
  id: string,
  name: string,
  filters: Array<Record<string, unknown>>,
  marker: string,
  ts: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO collections
        (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at)
       VALUES (?, ?, '[]', '[]', ?, '[]', 'full_config', 'name', '[]', 1, ?, ?, ?)`
    )
    .bind(id, name, jsonStringify(filters), marker, ts, ts)
    .run();
}

async function updateAutoCollection(
  db: D1Database,
  id: string,
  name: string,
  filters: Array<Record<string, unknown>>,
  marker: string,
  ts: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE collections SET
        name = ?, source_ids = '[]', node_ids = '[]', filters = ?, renames = '[]',
        dedup = 'full_config', sort = 'name', sort_country_order = '[]',
        enabled = 1, notes = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(name, jsonStringify(filters), marker, ts, id)
    .run();
}

async function createLinkedGroup(
  db: D1Database,
  collectionId: string,
  name: string,
  type: AutoNodeGroupType,
  ts: string
): Promise<void> {
  const maxRow = await db
    .prepare('SELECT MAX(sort_order) as max_order FROM groups')
    .first<{ max_order: number | null }>();
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  await db
    .prepare(
      `INSERT INTO groups
        (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, 1, ?, 0, ?, ?)`
    )
    .bind(
      newId(),
      name,
      type,
      jsonStringify([collectionId]),
      DEFAULT_HEALTH_CHECK.testUrl,
      DEFAULT_HEALTH_CHECK.interval,
      DEFAULT_HEALTH_CHECK.tolerance,
      DEFAULT_HEALTH_CHECK.lazy ? 1 : 0,
      sortOrder,
      ts,
      ts
    )
    .run();
}

async function ensureLinkedGroup(
  db: D1Database,
  collectionId: string,
  name: string,
  type: AutoNodeGroupType,
  ts: string
): Promise<void> {
  const row = await db
    .prepare(`SELECT id FROM groups WHERE is_builtin = 0 AND collection_ids = ? ORDER BY sort_order ASC LIMIT 1`)
    .bind(jsonStringify([collectionId]))
    .first<{ id: string }>();

  if (!row) {
    await createLinkedGroup(db, collectionId, name, type, ts);
    return;
  }

  await db
    .prepare(
      `UPDATE groups SET
        name = ?, type = ?, collection_ids = ?, group_ids = '[]', builtins = '[]',
        test_url = ?, interval = ?, tolerance = ?, lazy = ?, enabled = 1, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      name,
      type,
      jsonStringify([collectionId]),
      DEFAULT_HEALTH_CHECK.testUrl,
      DEFAULT_HEALTH_CHECK.interval,
      DEFAULT_HEALTH_CHECK.tolerance,
      DEFAULT_HEALTH_CHECK.lazy ? 1 : 0,
      ts,
      row.id
    )
    .run();
}

async function deleteCollectionAndLinkedGroups(db: D1Database, collectionId: string): Promise<void> {
  const collectionIds = jsonStringify([collectionId]);
  await db.prepare('DELETE FROM groups WHERE is_builtin = 0 AND collection_ids = ?').bind(collectionIds).run();
  await db.prepare('DELETE FROM collections WHERE id = ?').bind(collectionId).run();
}

function makeCountryFilter(countryCode: string) {
  return {
    id: `auto-country-${countryCode.toLowerCase()}`,
    field: 'countryCode',
    operator: 'equals',
    value: countryCode,
    enabled: true,
  };
}

function makeTagFilter(tagKey: string, tags: readonly string[]) {
  return {
    id: `auto-tag-${tagKey}`,
    field: 'tag',
    operator: 'in',
    value: [...tags],
    enabled: true,
  };
}

function withDefaultAutoFilters(filters: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...filters, { ...EXCLUDE_HIGH_MULTIPLIER_FILTER }];
}

function makeCountryAutoNodeGroupKey(countryCode: string, type: AutoNodeGroupType): string {
  return `country:${countryCode.trim().toUpperCase()}:${type}`;
}

function makeTagAutoNodeGroupKey(tagKey: string, type: AutoNodeGroupType): string {
  return `tag:${tagKey}:${type}`;
}

function makeCountryAutoNodeGroupMarker(countryCode: string, type: AutoNodeGroupType): { key: string; text: string } {
  const key = makeCountryAutoNodeGroupKey(countryCode, type);
  return { key, text: `${AUTO_NODE_GROUP_PREFIX} ${key}` };
}

function makeTagAutoNodeGroupMarker(tagKey: string, type: AutoNodeGroupType): { key: string; text: string } {
  const key = makeTagAutoNodeGroupKey(tagKey, type);
  return { key, text: `${AUTO_NODE_GROUP_PREFIX} ${key}` };
}

function parseAutoNodeGroupMarker(notes?: string | null): AutoNodeGroupMarker | null {
  if (!notes?.startsWith(AUTO_NODE_GROUP_PREFIX)) return null;
  const rawKey = notes.slice(AUTO_NODE_GROUP_PREFIX.length).trim();
  const parts = rawKey.split(':');
  if (parts.length !== 3) return null;

  const [scope, value, type] = parts;
  if (!isAutoNodeGroupType(type)) return null;
  if (scope === 'country' && value) {
    const normalizedCode = value.trim().toUpperCase();
    return {
      scope,
      countryCode: normalizedCode,
      type,
      key: makeCountryAutoNodeGroupKey(normalizedCode, type),
    };
  }
  if (scope === 'tag' && value) {
    return {
      scope,
      tagKey: value,
      type,
      key: makeTagAutoNodeGroupKey(value, type),
    };
  }
  return null;
}

function makeAutoGroupName(countryCode: string, type: AutoNodeGroupType, includeFlag: boolean): string {
  const normalizedCode = countryCode.trim().toUpperCase();
  const flag = includeFlag ? countryCodeToFlag(normalizedCode) : undefined;
  return [flag, normalizedCode, autoGroupTypeSuffix(type)].filter(Boolean).join(' ');
}

function makeTagAutoGroupName(baseName: string, type: AutoNodeGroupType): string {
  if (type === 'url-test') return baseName;
  return `${baseName.replace(/\s+Auto$/, '')} ${autoGroupTypeSuffix(type)}`;
}

function autoGroupTypeSuffix(type: AutoNodeGroupType): string {
  if (type === 'select') return 'Select';
  if (type === 'fallback') return 'Fallback';
  return 'Auto';
}

function isAutoNodeGroupType(value: string | undefined): value is AutoNodeGroupType {
  return value === 'select' || value === 'url-test' || value === 'fallback';
}
