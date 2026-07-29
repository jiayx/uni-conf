/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url).toString())
const initialSchema = readFileSync(join(migrationsDir, '0001_initial_schema.sql'), 'utf8')

describe('database migrations', () => {
  it('ships one canonical current schema without historical upgrade migrations', () => {
    expect(readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort()).toEqual([
      '0001_initial_schema.sql',
    ])
    expect(initialSchema).not.toMatch(/\bALTER\s+TABLE\b/i)
  })

  it('contains every current table and recently added field', () => {
    for (const table of [
      'workspaces',
      'sources',
      'source_import_runs',
      'nodes',
      'collections',
      'groups',
      'rules',
      'remote_rule_sets',
      'remote_rule_set_source_health',
      'export_configs',
      'app_settings',
    ]) {
      expect(initialSchema).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`))
    }

    for (const column of ['upload_bytes', 'download_bytes', 'total_bytes', 'expire_time']) {
      expect(tableDefinition('sources')).toMatch(new RegExp(`\\b${column}\\b`))
    }
    expect(tableDefinition('remote_rule_sets')).toContain('source_overrides TEXT NOT NULL DEFAULT')
    expect(tableDefinition('export_configs')).toContain('rule_set_conversion_policy TEXT')
    expect(tableDefinition('app_settings')).toContain('rule_set_conversion_policy TEXT NOT NULL')

    for (const table of [
      'sources',
      'source_import_runs',
      'nodes',
      'collections',
      'groups',
      'rules',
      'remote_rule_sets',
      'export_configs',
    ]) {
      const definition = tableDefinition(table)
      expect(definition).toContain('workspace_id TEXT NOT NULL')
      expect(definition).toContain('FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE')
    }

    const settings = tableDefinition('app_settings')
    expect(settings).toContain('FOREIGN KEY (id) REFERENCES workspaces(id) ON DELETE CASCADE')
  })

  it('keeps the managed zero-setup graph in the canonical schema', () => {
    expect(initialSchema).toContain('builtin-default-node-pool')
    expect(initialSchema).toContain('[uni-conf:default-node-pool]')
    expect(initialSchema).toContain('"operator":"not_in"')
    expect(initialSchema).toContain('"high-multiplier"')
    expect(initialSchema).toContain("'builtin-google',    'Google'")
    for (const id of [
      'builtin-all-nodes',
      'builtin-node-select',
      'builtin-auto-select',
      'builtin-fallback-select',
    ]) {
      const line = initialSchema.split('\n').find(item => item.includes(`('${id}'`))
      expect(line).toContain("'[\"builtin-default-node-pool\"]'")
    }
  })

  it('keeps audit and health data free of raw credentials', () => {
    const history = tableDefinition('source_import_runs')
    expect(history).toContain('FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL')
    expect(history).not.toMatch(/raw_content|parsed_config|raw_config|password/i)

    const health = tableDefinition('remote_rule_set_source_health')
    expect(health).toContain('FOREIGN KEY (remote_rule_set_id) REFERENCES remote_rule_sets(id) ON DELETE CASCADE')
    expect(health).toContain('expires_at TEXT NOT NULL')
    expect(health).toContain('result TEXT NOT NULL')
  })
})

function tableDefinition(table: string): string {
  const definition = initialSchema.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\([\\s\\S]*?\\n\\);`)
  )?.[0]
  expect(definition).toBeTruthy()
  return definition!
}
