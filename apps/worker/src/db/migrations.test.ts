/// <reference types="node" />

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url).toString())

describe('database migrations', () => {
  it('does not re-add columns already present in the fresh install schema', () => {
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()
    const initialSchemaFile = files.find((file) => file.startsWith('0001_'))
    expect(initialSchemaFile).toBeTruthy()

    const initialSchema = readFileSync(join(migrationsDir, initialSchemaFile!), 'utf8')
    const initialColumnsByTable = parseCreateTableColumns(initialSchema)
    const duplicateAdds: string[] = []

    for (const file of files.filter((item) => item !== initialSchemaFile)) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      for (const add of parseAlterTableAddColumns(sql)) {
        if (!initialColumnsByTable.get(add.table)?.has(add.column)) continue
        duplicateAdds.push(`${basename(file)}: ${add.table}.${add.column}`)
      }
    }

    expect(duplicateAdds).toEqual([])
  })

  it('keeps the final zero-setup foundation migration in sync with managed built-ins', () => {
    const migration = readFileSync(
      join(migrationsDir, '0019_normalize_zero_setup_foundations.sql'),
      'utf8'
    )

    expect(migration).toContain('builtin-default-node-pool')
    expect(migration).toContain('[uni-conf:default-node-pool]')
    expect(migration).toContain('"field":"tag"')
    expect(migration).toContain('"operator":"not_in"')
    expect(migration).toContain('"high-multiplier"')
    expect(migration).toContain('builtin-google')
    for (const id of [
      'builtin-all-nodes',
      'builtin-node-select',
      'builtin-auto-select',
      'builtin-fallback-select',
    ]) {
      expect(migration).toContain(`WHEN '${id}' THEN '["builtin-default-node-pool"]'`)
    }
  })
})

function parseCreateTableColumns(sql: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  const createTablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s*\(([\s\S]*?)\);/gi
  let match: RegExpExecArray | null
  while ((match = createTablePattern.exec(sql)) !== null) {
    const table = normalizeIdentifier(match[1]!)
    const body = match[2]!
    const columns = new Set<string>()
    for (const part of splitSqlList(body)) {
      const firstToken = part.trim().match(/^["`']?([A-Za-z_][\w]*)["`']?\b/)
      if (!firstToken) continue
      const column = normalizeIdentifier(firstToken[1]!)
      if (['constraint', 'foreign', 'primary', 'unique', 'check'].includes(column)) continue
      columns.add(column)
    }
    result.set(table, columns)
  }
  return result
}

function parseAlterTableAddColumns(sql: string): Array<{ table: string; column: string }> {
  const result: Array<{ table: string; column: string }> = []
  const alterPattern = /ALTER\s+TABLE\s+["`']?([A-Za-z_][\w]*)["`']?\s+ADD\s+COLUMN\s+["`']?([A-Za-z_][\w]*)["`']?/gi
  let match: RegExpExecArray | null
  while ((match = alterPattern.exec(sql)) !== null) {
    result.push({
      table: normalizeIdentifier(match[1]!),
      column: normalizeIdentifier(match[2]!),
    })
  }
  return result
}

function splitSqlList(body: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const char of body) {
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current)
  return parts
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase()
}
