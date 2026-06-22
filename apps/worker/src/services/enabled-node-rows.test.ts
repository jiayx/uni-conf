import { describe, expect, it } from 'vitest';
import { enabledNodeRowsQuery } from './enabled-node-rows';

describe('enabled node row query', () => {
  it('requires both node and source to be enabled', () => {
    expect(normalizeSql(enabledNodeRowsQuery())).toBe(
      'SELECT n.* FROM nodes n INNER JOIN sources s ON s.id = n.source_id WHERE n.enabled = 1 AND s.enabled = 1'
    );
  });

  it('appends extra node conditions after the enabled source gate', () => {
    expect(normalizeSql(enabledNodeRowsQuery('n.source_id IN (?, ?)'))).toBe(
      'SELECT n.* FROM nodes n INNER JOIN sources s ON s.id = n.source_id WHERE n.enabled = 1 AND s.enabled = 1 AND n.source_id IN (?, ?)'
    );
  });
});

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}
