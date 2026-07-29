import {
  AUTO_NODE_TAG_GROUPS,
  type AutoNodeGroupMarker,
  countryCodeToFlag,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_NODE_POOL_PREFIX,
  makeCountryAutoNodeGroupMarker,
  makeTagAutoNodeGroupMarker,
  parseAutoNodeGroupMarker,
} from '@uni-conf/shared';
import { jsonStringify, newId } from '../db/helpers';
import { enabledNodeRowsQuery } from './enabled-node-rows';
import { getAppSettings } from './app-settings';
import type { AutoNodeGroupType } from '@uni-conf/types';
import { DEFAULT_WORKSPACE_ID, defaultNodePoolId } from './workspaces';

interface CountrySummary {
  countryCode: string;
  country: string;
  nodeCount?: number;
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
export async function syncAutoNodeGroups(
  db: D1Database,
  ts: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<void> {
  const settings = await getAppSettings(db, workspaceId);
  await ensureDefaultNodePoolCollection(db, ts, workspaceId);
  const enabledTypes = settings.autoNodeGroupsEnabled ? settings.autoNodeGroupTypes : [];
  const autoCollections = await listAutoCollections(db, workspaceId);

  if (enabledTypes.length === 0) {
    for (const item of autoCollections) {
      await deleteCollectionAndLinkedGroups(db, item.id, workspaceId);
    }
    return;
  }

  const countries = await listCountriesWithNodes(db, workspaceId);
  const tagKeys = await listTagGroupKeysWithNodes(db, workspaceId);
  const selectedKeys = settings.autoNodeGroupKeys !== undefined ? new Set(settings.autoNodeGroupKeys) : null;
  const plans = buildAutoNodeGroupPlans(countries, tagKeys, enabledTypes, settings.autoNodeGroupIncludeFlag)
    .filter((plan) => selectedKeys === null || selectedKeys.has(plan.key));
  const planKeys = new Set(plans.map((plan) => plan.key));

  for (const item of autoCollections) {
    if (planKeys.has(item.marker.key)) continue;
    await deleteCollectionAndLinkedGroups(db, item.id, workspaceId);
  }

  const existingByKey = new Map(
    autoCollections.map((item) => [item.marker.key, item])
  );

  for (const plan of plans) {
    const existing = existingByKey.get(plan.key);

    if (existing) {
      await updateAutoCollection(db, existing.id, plan.name, plan.filters, plan.markerText, ts);
      await ensureLinkedGroup(db, existing.id, plan.name, plan.type, ts, workspaceId);
    } else {
      const collectionId = newId();
      await createAutoCollection(db, collectionId, plan.name, plan.filters, plan.markerText, ts, workspaceId);
      await createLinkedGroup(db, collectionId, plan.name, plan.type, ts, workspaceId);
    }
  }

}

async function ensureDefaultNodePoolCollection(db: D1Database, ts: string, workspaceId: string): Promise<void> {
  const filters = jsonStringify([{ ...EXCLUDE_HIGH_MULTIPLIER_FILTER }]);
  const collectionId = defaultNodePoolId(workspaceId);
  await db
    .prepare(
      `INSERT OR IGNORE INTO collections
        (id, workspace_id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at)
       VALUES (?, ?, '默认节点池', '[]', '[]', ?, '[]', 'full_config', 'name', '[]', 1, ?, ?, ?)`
    )
    .bind(collectionId, workspaceId, filters, DEFAULT_NODE_POOL_PREFIX, ts, ts)
    .run();
  await db
    .prepare(
      `UPDATE collections SET
        name = '默认节点池', source_ids = '[]', node_ids = '[]',
        filters = ?, renames = '[]', dedup = 'full_config', sort = 'name',
        sort_country_order = '[]', enabled = 1, notes = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .bind(filters, DEFAULT_NODE_POOL_PREFIX, ts, collectionId, workspaceId)
    .run();
}

async function listCountriesWithNodes(db: D1Database, workspaceId: string): Promise<CountrySummary[]> {
  const { results } = await db
    .prepare(
      `SELECT country_code, country, tags
       FROM (${enabledNodeRowsQuery(undefined, workspaceId)}) enabled_nodes
       WHERE country_code IS NOT NULL
         AND country_code != ''
       ORDER BY country_code ASC`
    )
    .all<{ country_code: string; country: string | null; tags: string | null }>();

  const byCode = new Map<string, CountrySummary>();
  for (const row of results) {
    const tags = parseNodeTags(row.tags);
    if (tags.includes('high-multiplier')) continue;

    const countryCode = row.country_code.trim().toUpperCase();
    const existing = byCode.get(countryCode);
    if (existing) {
      existing.nodeCount = (existing.nodeCount ?? 0) + 1;
      if (!existing.country && row.country) existing.country = row.country;
    } else {
      byCode.set(countryCode, {
        countryCode,
        country: row.country ?? row.country_code,
        nodeCount: 1,
      });
    }
  }

  return [...byCode.values()].sort((a, b) => (b.nodeCount ?? 0) - (a.nodeCount ?? 0) || a.countryCode.localeCompare(b.countryCode));
}

async function listTagGroupKeysWithNodes(db: D1Database, workspaceId: string): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT tags FROM (${enabledNodeRowsQuery(undefined, workspaceId)}) enabled_nodes`)
    .all<{ tags: string | null }>();
  const seenTags = new Set<string>();
  for (const row of results) {
    const tags = parseNodeTags(row.tags);
    if (tags.includes('high-multiplier')) continue;
    for (const tag of tags) seenTags.add(tag);
  }

  const keys: string[] = [];
  for (const group of AUTO_NODE_TAG_GROUPS) {
    if (group.tags.some((tag) => seenTags.has(tag))) keys.push(group.key);
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
    AUTO_NODE_TAG_GROUPS
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

async function listAutoCollections(db: D1Database, workspaceId: string): Promise<Array<{ id: string; marker: AutoNodeGroupMarker }>> {
  const { results } = await db
    .prepare("SELECT id, notes FROM collections WHERE workspace_id = ? AND notes IS NOT NULL AND notes != ''")
    .bind(workspaceId)
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
  ts: string,
  workspaceId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO collections
        (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at, workspace_id)
       VALUES (?, ?, '[]', '[]', ?, '[]', 'full_config', 'name', '[]', 1, ?, ?, ?, ?)`
    )
    .bind(id, name, jsonStringify(filters), marker, ts, ts, workspaceId)
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
  ts: string,
  workspaceId: string,
): Promise<void> {
  const maxRow = await db
    .prepare('SELECT MAX(sort_order) as max_order FROM groups WHERE workspace_id = ?')
    .bind(workspaceId)
    .first<{ max_order: number | null }>();
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  await db
    .prepare(
      `INSERT INTO groups
        (id, name, type, collection_ids, group_ids, builtins, test_url, interval, tolerance, lazy, enabled, sort_order, is_builtin, created_at, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, 1, ?, 0, ?, ?, ?)`
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
      ts,
      workspaceId
    )
    .run();
}

async function ensureLinkedGroup(
  db: D1Database,
  collectionId: string,
  name: string,
  type: AutoNodeGroupType,
  ts: string,
  workspaceId: string,
): Promise<void> {
  const row = await db
    .prepare(`SELECT id FROM groups WHERE workspace_id = ? AND is_builtin = 0 AND collection_ids = ? ORDER BY sort_order ASC LIMIT 1`)
    .bind(workspaceId, jsonStringify([collectionId]))
    .first<{ id: string }>();

  if (!row) {
    await createLinkedGroup(db, collectionId, name, type, ts, workspaceId);
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

async function deleteCollectionAndLinkedGroups(
  db: D1Database,
  collectionId: string,
  workspaceId: string,
): Promise<void> {
  const collectionIds = jsonStringify([collectionId]);
  await db.prepare('DELETE FROM groups WHERE workspace_id = ? AND is_builtin = 0 AND collection_ids = ?')
    .bind(workspaceId, collectionIds).run();
  await db.prepare('DELETE FROM collections WHERE id = ? AND workspace_id = ?').bind(collectionId, workspaceId).run();
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

function parseNodeTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
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
