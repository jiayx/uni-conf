import { AUTO_NODE_GROUP_PREFIX, countryCodeToFlag } from '@uni-conf/shared';
import { jsonStringify, newId } from '../db/helpers';

const AUTO_GROUP_TYPE = 'url-test';
const TEST_URL = 'http://www.gstatic.com/generate_204';

interface AutoNodeGroupMarker {
  countryCode: string;
  type: string;
  key: string;
}

interface CountrySummary {
  countryCode: string;
  country: string;
}

export async function syncAutoNodeGroups(db: D1Database, ts: string): Promise<void> {
  const countries = await listCountriesWithNodes(db);
  const countryCodes = new Set(countries.map((country) => country.countryCode));
  const autoCollections = await listAutoCollections(db);

  for (const item of autoCollections) {
    if (item.marker.type === AUTO_GROUP_TYPE && countryCodes.has(item.marker.countryCode)) continue;
    await deleteCollectionAndLinkedGroups(db, item.id);
  }

  const existingByKey = new Map(
    autoCollections
      .filter((item) => item.marker.type === AUTO_GROUP_TYPE)
      .map((item) => [item.marker.key, item])
  );

  for (const country of countries) {
    const marker = makeAutoNodeGroupMarker(country.countryCode);
    const name = makeAutoGroupName(country.countryCode);
    const existing = existingByKey.get(marker.key);

    if (existing) {
      await updateAutoCollection(db, existing.id, name, country.countryCode, marker.text, ts);
      await ensureLinkedGroup(db, existing.id, name, ts);
    } else {
      const collectionId = newId();
      await createAutoCollection(db, collectionId, name, country.countryCode, marker.text, ts);
      await createLinkedGroup(db, collectionId, name, ts);
    }
  }
}

async function listCountriesWithNodes(db: D1Database): Promise<CountrySummary[]> {
  const { results } = await db
    .prepare(
      `SELECT country_code, MAX(country) AS country, COUNT(*) AS node_count
       FROM nodes
       WHERE enabled = 1 AND country_code IS NOT NULL AND country_code != ''
       GROUP BY country_code
       ORDER BY node_count DESC, country_code ASC`
    )
    .all<{ country_code: string; country: string | null; node_count: number }>();

  return results.map((row) => ({
    countryCode: row.country_code.trim().toUpperCase(),
    country: row.country ?? row.country_code,
  }));
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
  countryCode: string,
  marker: string,
  ts: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO collections
        (id, name, source_ids, node_ids, filters, renames, dedup, sort, sort_country_order, enabled, notes, created_at, updated_at)
       VALUES (?, ?, '[]', '[]', ?, '[]', 'full_config', 'name', '[]', 1, ?, ?, ?)`
    )
    .bind(id, name, jsonStringify([makeCountryFilter(countryCode)]), marker, ts, ts)
    .run();
}

async function updateAutoCollection(
  db: D1Database,
  id: string,
  name: string,
  countryCode: string,
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
    .bind(name, jsonStringify([makeCountryFilter(countryCode)]), marker, ts, id)
    .run();
}

async function createLinkedGroup(
  db: D1Database,
  collectionId: string,
  name: string,
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
       VALUES (?, ?, ?, ?, '[]', '[]', ?, 300, 150, 1, 1, ?, 0, ?, ?)`
    )
    .bind(newId(), name, AUTO_GROUP_TYPE, jsonStringify([collectionId]), TEST_URL, sortOrder, ts, ts)
    .run();
}

async function ensureLinkedGroup(
  db: D1Database,
  collectionId: string,
  name: string,
  ts: string
): Promise<void> {
  const row = await db
    .prepare(`SELECT id FROM groups WHERE is_builtin = 0 AND collection_ids = ? ORDER BY sort_order ASC LIMIT 1`)
    .bind(jsonStringify([collectionId]))
    .first<{ id: string }>();

  if (!row) {
    await createLinkedGroup(db, collectionId, name, ts);
    return;
  }

  await db
    .prepare(
      `UPDATE groups SET
        name = ?, type = ?, collection_ids = ?, group_ids = '[]', builtins = '[]',
        test_url = ?, interval = 300, tolerance = 150, lazy = 1, enabled = 1, updated_at = ?
       WHERE id = ?`
    )
    .bind(name, AUTO_GROUP_TYPE, jsonStringify([collectionId]), TEST_URL, ts, row.id)
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

function makeAutoNodeGroupKey(countryCode: string): string {
  return `${countryCode.trim().toUpperCase()}:${AUTO_GROUP_TYPE}`;
}

function makeAutoNodeGroupMarker(countryCode: string): { key: string; text: string } {
  const key = makeAutoNodeGroupKey(countryCode);
  return { key, text: `${AUTO_NODE_GROUP_PREFIX} ${key}` };
}

function parseAutoNodeGroupMarker(notes?: string | null): AutoNodeGroupMarker | null {
  if (!notes?.startsWith(AUTO_NODE_GROUP_PREFIX)) return null;
  const [countryCode, type] = notes.slice(AUTO_NODE_GROUP_PREFIX.length).trim().split(':');
  if (!countryCode || !type) return null;
  const normalizedCode = countryCode.trim().toUpperCase();
  return { countryCode: normalizedCode, type, key: `${normalizedCode}:${type}` };
}

function makeAutoGroupName(countryCode: string): string {
  const normalizedCode = countryCode.trim().toUpperCase();
  const flag = countryCodeToFlag(normalizedCode);
  return [flag, normalizedCode, 'Auto'].filter(Boolean).join(' ');
}
