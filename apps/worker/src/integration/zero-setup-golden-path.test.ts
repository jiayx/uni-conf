/// <reference types="node" />

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { load as parseYAML } from 'js-yaml'
import Ajv2020 from 'ajv/dist/2020'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker from '../index'
import type { Env } from '../types'
import type { ExportConfig } from '@uni-conf/types'
import { DEFAULT_NODE_POOL_COLLECTION_ID, EXPORT_FORMAT_FILENAMES, type ExportSubscriptionFormat } from '@uni-conf/shared'

const require = createRequire(import.meta.url)
const singboxSchema = JSON.parse(readFileSync(require.resolve('@black-duty/sing-box-schema/schema.json'), 'utf8')) as Record<string, unknown>
// The published 2020-12 document carries legacy nested `id` metadata keys.
// Remove only those string metadata values so local refs continue to resolve
// against the root document.
removeLegacySchemaIds(singboxSchema)
const validateSingbox = new Ajv2020({ strict: false }).compile(singboxSchema)

function removeLegacySchemaIds(value: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) removeLegacySchemaIds(item)
    return
  }
  const record = value as Record<string, unknown>
  if (typeof record.id === 'string') delete record.id
  for (const child of Object.values(record)) removeLegacySchemaIds(child)
}

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url).toString())

// D1's exec() treats each line as its own statement candidate, so multi-line
// CREATE TABLE statements and comment-only lines both break it. Strip full-line
// comments, then collapse the file onto one line so exec() only splits on `;`.
function toSingleLineStatements(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join(' ')
}

/**
 * Exercises the real Hono app against a real D1 (SQLite via Miniflare) database
 * with all migrations applied, instead of the hand-rolled per-test mocks used
 * elsewhere. This is the one place that verifies the zero-setup chain actually
 * produces a coherent, parseable config end to end - no mocked collaborators.
 */
describe('zero-setup golden path (real D1 via Miniflare)', () => {
  let mf: Miniflare
  let env: Env

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("unused"); } };',
      d1Databases: ['DB'],
    })
    const db = await mf.getD1Database('DB')

    const files = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      await db.exec(toSingleLineStatements(sql))
    }

    env = { DB: db, ENVIRONMENT: 'test' } as Env
  }, 30000)

  afterAll(async () => {
    await mf.dispose()
  })

  // Importing `miniflare` pulls in `@cloudflare/workers-types/experimental`, which declares an
  // incompatible `Request` generic default alongside the plain `@cloudflare/workers-types` used
  // by the rest of the worker. `worker.fetch`'s real behavior doesn't care about the mismatch,
  // so it's cast away here rather than fighting ambient type resolution across the two packages.
  async function request(path: string, init?: RequestInit): Promise<Response> {
    const req = new Request(`https://uni-conf.example.com${path}`, init)
    return worker.fetch(req as Parameters<typeof worker.fetch>[0], env, {} as ExecutionContext)
  }

  async function assertEveryAdvertisedFormatDownloads(token: string): Promise<void> {
    for (const [format, filename] of Object.entries(EXPORT_FORMAT_FILENAMES) as Array<[ExportSubscriptionFormat, string]>) {
      const response = await request(`/sub/${token}/${filename}`)
      const content = await response.text()
      expect(response.status, `${format} download status: ${content.slice(0, 240)}`).toBe(200)
      expect(content.length, `${format} content length`).toBeGreaterThan(20)
      assertExportShape(format, content)
    }
  }

  it('turns a single pasted config import into coherent downloads for every advertised format', async () => {
    // Miniflare/D1 startup and the full zero-setup chain can be slow under CI load.
    const importedConfig = `
proxies:
  - { name: '🇺🇸 US 01', type: trojan, server: us.golden-path.example.com, port: 443, password: pwd }
  - { name: '🇯🇵 JP 01', type: trojan, server: jp.golden-path.example.com, port: 443, password: pwd }
rules:
  - DOMAIN-SUFFIX,golden-path.example.com,PROXY
  - DOMAIN,unmapped.golden-path.example.com,MISSING-TARGET
  - RULE-SET,golden-block,REJECT
rule-providers:
  golden-block: { type: http, behavior: domain, url: https://rules.golden-path.example.com/block.yaml, interval: 86400 }
`
    const previewRes = await request('/api/sources/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: importedConfig }),
    })
    expect(previewRes.status).toBe(200)
    const previewPayload = (await previewRes.json()) as {
      data: { structured: { rules: number; remoteRuleSets: number; skippedRules: number; unmappedTargets: string[] } }
    }
    expect(previewPayload.data.structured).toMatchObject({
      rules: 1,
      remoteRuleSets: 1,
      skippedRules: 1,
      unmappedTargets: ['MISSING-TARGET'],
    })

    const importRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Golden Path Source',
        content: importedConfig,
        importStructured: true,
      }),
    })
    expect(importRes.status).toBe(201)
    const importPayload = (await importRes.json()) as {
      success: boolean
      data: {
        source: { id: string }
        importRun?: { id: string; status: string; canUndo: boolean }
        refresh?: { nodeCount: number }
        refreshError?: string
        structuredImport?: {
          rules: number
          remoteRuleSets: number
          skippedRules: number
          duplicateRules: number
          duplicateRemoteRuleSets: number
          conflictingRules: number
          conflictingRemoteRuleSets: number
          unmappedTargets: string[]
        }
      }
    }
    expect(importPayload.success).toBe(true)
    expect(importPayload.data.refreshError).toBeUndefined()
    expect(importPayload.data.importRun).toMatchObject({ status: 'success', canUndo: true })
    expect(importPayload.data.refresh?.nodeCount).toBe(2)
    expect(importPayload.data.structuredImport).toEqual({
      rules: 1,
      remoteRuleSets: 1,
      skippedRules: 1,
      duplicateRules: 0,
      duplicateRemoteRuleSets: 0,
      conflictingRules: 0,
      conflictingRemoteRuleSets: 0,
      unmappedTargets: ['MISSING-TARGET'],
    })

    const importedNodesPayload = await (await request('/api/nodes?pageSize=200')).json() as {
      data: { items: Array<{ id: string; enabled: boolean }> }
    }
    const importedNodeIds = importedNodesPayload.data.items.map(node => node.id)
    expect(importedNodeIds).toHaveLength(2)
    const disableNodesRes = await request('/api/nodes/batch-enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: importedNodeIds, enabled: false }),
    })
    expect(disableNodesRes.status).toBe(200)
    await expect(disableNodesRes.json()).resolves.toMatchObject({
      data: { ids: importedNodeIds, enabled: false, updatedCount: 2 },
    })
    const disabledNodesPayload = await (await request('/api/nodes?enabled=false&pageSize=200')).json() as {
      data: { items: Array<{ id: string }> }
    }
    expect(disabledNodesPayload.data.items.map(node => node.id).sort()).toEqual([...importedNodeIds].sort())
    expect((await request('/api/nodes/batch-enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: importedNodeIds, enabled: true }),
    })).status).toBe(200)

    const rulesRes = await request('/api/rules')
    const rulesPayload = (await rulesRes.json()) as { data: Array<{ id: string; payload: string; enabled: boolean }> }
    const importedRule = rulesPayload.data.find((rule) => rule.payload === 'golden-path.example.com')
    expect(importedRule).toBeTruthy()

    const rejectedRuleBatchRes = await request('/api/rules/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rules: [
          { type: 'DOMAIN-SUFFIX', payload: 'must-not-be-partially-created.example', targetGroupId: 'builtin-proxy' },
          { type: 'DOMAIN-SUFFIX', payload: '', targetGroupId: 'builtin-direct' },
        ],
      }),
    })
    expect(rejectedRuleBatchRes.status).toBe(400)
    const afterRejectedBatch = (await (await request('/api/rules')).json()) as {
      data: Array<{ payload: string }>
    }
    expect(afterRejectedBatch.data.some(rule => rule.payload === 'must-not-be-partially-created.example')).toBe(false)

    const createdRuleBatchRes = await request('/api/rules/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rules: [
          { type: 'DOMAIN-SUFFIX', payload: 'atomic-one.golden-path.example', targetGroupId: 'builtin-proxy' },
          { type: 'DOMAIN', payload: 'atomic-two.golden-path.example', targetGroupId: 'builtin-direct' },
        ],
      }),
    })
    expect(createdRuleBatchRes.status).toBe(201)
    const createdRuleBatch = (await createdRuleBatchRes.json()) as {
      data: Array<{ payload: string; order: number }>
    }
    expect(createdRuleBatch.data.map(rule => rule.payload)).toEqual([
      'atomic-one.golden-path.example',
      'atomic-two.golden-path.example',
    ])
    expect(createdRuleBatch.data[1]!.order).toBe(createdRuleBatch.data[0]!.order + 1)

    const beforeReorderPayload = (await (await request('/api/rules')).json()) as {
      data: Array<{ id: string }>
    }
    const reversedRuleIds = beforeReorderPayload.data.map(rule => rule.id).reverse()
    const reorderRulesRes = await request('/api/rules/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: reversedRuleIds }),
    })
    expect(reorderRulesRes.status).toBe(200)
    const reorderedRulesPayload = (await reorderRulesRes.json()) as {
      data: Array<{ id: string; order: number }>
    }
    expect(reorderedRulesPayload.data.map(rule => rule.id)).toEqual(reversedRuleIds)
    expect(reorderedRulesPayload.data.map(rule => rule.order)).toEqual(
      reversedRuleIds.map((_, index) => index),
    )

    const staleReorderRes = await request('/api/rules/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: reversedRuleIds.slice(1) }),
    })
    expect(staleReorderRes.status).toBe(409)
    const afterStaleReorderPayload = (await (await request('/api/rules')).json()) as {
      data: Array<{ id: string }>
    }
    expect(afterStaleReorderPayload.data.map(rule => rule.id)).toEqual(reversedRuleIds)

    const disableRulesRes = await request('/api/rules/batch-enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [importedRule!.id], enabled: false }),
    })
    expect(disableRulesRes.status).toBe(200)
    await expect(disableRulesRes.json()).resolves.toMatchObject({
      data: { ids: [importedRule!.id], enabled: false, updatedCount: 1 },
    })
    const disabledRulesPayload = (await (await request('/api/rules')).json()) as {
      data: Array<{ id: string; enabled: boolean }>
    }
    expect(disabledRulesPayload.data.find(rule => rule.id === importedRule!.id)?.enabled).toBe(false)
    expect((await request('/api/rules/batch-enabled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [importedRule!.id], enabled: true }),
    })).status).toBe(200)

    const ruleSetsRes = await request('/api/remote-rule-sets')
    const ruleSetsPayload = (await ruleSetsRes.json()) as { data: Array<{ id: string; url: string }> }
    const importedRuleSet = ruleSetsPayload.data.find((set) => set.url === 'https://rules.golden-path.example.com/block.yaml')
    expect(importedRuleSet).toBeTruthy()
    const nativeEgernRuleSetUrl = 'https://rules.golden-path.example.com/block-egern.yaml'
    const overrideRes = await request(`/api/remote-rule-sets/${importedRuleSet!.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceOverrides: { egern: nativeEgernRuleSetUrl } }),
    })
    expect(overrideRes.status).toBe(200)
    await expect(overrideRes.json()).resolves.toMatchObject({
      data: { sourceOverrides: { egern: nativeEgernRuleSetUrl } },
    })

    const rulesOnlyConfig = `
rules:
  - DOMAIN-SUFFIX,rules-only.golden-path.example.com,PROXY
  - RULE-SET,rules-only-block,REJECT
rule-providers:
  rules-only-block: { type: http, behavior: domain, url: https://rules-only.golden-path.example.com/block.yaml, interval: 86400 }
`
    const rulesOnlyPreviewRes = await request('/api/sources/import/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: rulesOnlyConfig }),
    })
    expect(rulesOnlyPreviewRes.status).toBe(200)
    await expect(rulesOnlyPreviewRes.json()).resolves.toMatchObject({
      data: {
        nodeCount: 0,
        importedObjects: ['rules', 'remote-rule-sets'],
        structured: { rules: 1, remoteRuleSets: 1 },
        diff: { nodes: { total: 0 } },
      },
    })
    const rulesOnlyImportRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rules Only', content: rulesOnlyConfig, importStructured: true }),
    })
    expect(rulesOnlyImportRes.status).toBe(201)
    const rulesOnlyImportPayload = await rulesOnlyImportRes.json() as {
      data: {
        source: { id: string; rawContent?: string }
        refresh: { nodeCount: number; addedCount: number }
        refreshError?: string
        structuredImport: { rules: number; remoteRuleSets: number }
        importRun: { id: string; status: string }
      }
    }
    expect(rulesOnlyImportPayload.data).toMatchObject({
      refresh: { nodeCount: 0, addedCount: 0 },
      structuredImport: { rules: 1, remoteRuleSets: 1 },
      importRun: { status: 'success' },
    })
    expect(rulesOnlyImportPayload.data.refreshError).toBeUndefined()
    expect(rulesOnlyImportPayload.data.source.rawContent).toContain('rules-only.golden-path.example.com')
    const rulesAfterRulesOnlyImport = await (await request('/api/rules')).json() as { data: Array<{ payload: string }> }
    expect(rulesAfterRulesOnlyImport.data.some((rule) => rule.payload === 'rules-only.golden-path.example.com')).toBe(true)
    expect((await request(`/api/sources/imports/${rulesOnlyImportPayload.data.importRun.id}/undo`, { method: 'POST' })).status).toBe(200)
    const rulesAfterRulesOnlyUndo = await (await request('/api/rules')).json() as { data: Array<{ payload: string }> }
    expect(rulesAfterRulesOnlyUndo.data.some((rule) => rule.payload === 'rules-only.golden-path.example.com')).toBe(false)

    const duplicatePreviewRes = await request('/api/sources/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: importedConfig }),
    })
    const duplicatePreviewPayload = (await duplicatePreviewRes.json()) as {
      data: {
        structured: {
          rules: number
          remoteRuleSets: number
          duplicateRules: number
          duplicateRemoteRuleSets: number
        }
      }
    }
    expect(duplicatePreviewPayload.data.structured).toMatchObject({
      rules: 0,
      remoteRuleSets: 0,
      duplicateRules: 1,
      duplicateRemoteRuleSets: 1,
    })

    const rotatedCredential = 'rotated-golden-path-secret'
    const credentialChangedConfig = importedConfig.replace('password: pwd', `password: ${rotatedCredential}`)
    const credentialChangedPreviewRes = await request('/api/sources/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: credentialChangedConfig }),
    })
    expect(credentialChangedPreviewRes.status).toBe(200)
    const credentialChangedPreviewPayload = (await credentialChangedPreviewRes.json()) as {
      data: {
        diff: {
          nodes: {
            counts: { duplicate: number; conflict: number }
            items: Array<{ status: string; changes: Array<{ field: string; before?: string; after?: string }> }>
          }
        }
      }
    }
    expect(credentialChangedPreviewPayload.data.diff.nodes.counts).toMatchObject({ duplicate: 1, conflict: 1 })
    expect(credentialChangedPreviewPayload.data.diff.nodes.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'conflict',
        changes: [expect.objectContaining({ field: 'configuration', before: 'stored', after: 'imported' })],
      }),
    ]))
    expect(JSON.stringify(credentialChangedPreviewPayload)).not.toContain(rotatedCredential)

    const noNewImportRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No New Nodes', content: importedConfig, nodeImportMode: 'new-only' }),
    })
    expect(noNewImportRes.status).toBe(409)
    await expect(noNewImportRes.json()).resolves.toMatchObject({
      success: false,
      error: 'No new nodes remain after applying the import mode',
    })

    const mixedNodeConfig = importedConfig.replace(
      'rules:',
      "  - { name: 'JP New', type: trojan, server: jp-new.example.com, port: 443, password: new-secret }\nrules:"
    )
    const newOnlyImportRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New Nodes Only', content: mixedNodeConfig, nodeImportMode: 'new-only' }),
    })
    expect(newOnlyImportRes.status).toBe(201)
    const newOnlyImportPayload = (await newOnlyImportRes.json()) as {
      data: {
        source: { id: string }
        refresh: { nodeCount: number; addedCount: number; skippedExistingCount: number }
        importRun: { id: string }
      }
    }
    expect(newOnlyImportPayload.data.refresh).toMatchObject({
      nodeCount: 1,
      addedCount: 1,
      skippedExistingCount: 2,
    })
    await env.DB.batch([
      env.DB.prepare('DELETE FROM nodes WHERE source_id = ?').bind(newOnlyImportPayload.data.source.id),
      env.DB.prepare('UPDATE sources SET node_count = 0 WHERE id = ?').bind(newOnlyImportPayload.data.source.id),
      env.DB.prepare(
        `UPDATE source_import_runs SET status = 'partial', refresh_error = ? WHERE id = ?`
      ).bind('Node import failed', newOnlyImportPayload.data.importRun.id),
    ])
    const nodeRetryPreviewRes = await request(
      `/api/sources/imports/${newOnlyImportPayload.data.importRun.id}/nodes/preview`,
      { method: 'POST' }
    )
    expect(nodeRetryPreviewRes.status).toBe(200)
    await expect(nodeRetryPreviewRes.json()).resolves.toMatchObject({
      data: { diff: { nodes: { counts: { new: 1, duplicate: 2 } } } },
    })
    const nodeRetryRes = await request(
      `/api/sources/imports/${newOnlyImportPayload.data.importRun.id}/nodes/retry`,
      { method: 'POST' }
    )
    expect(nodeRetryRes.status).toBe(200)
    const nodeRetryPayload = await nodeRetryRes.json() as {
      data: {
        importRun: { status: string; nodeCount: number; refreshError?: string }
        refresh: { nodeCount: number; addedCount: number; skippedExistingCount: number }
      }
    }
    expect(nodeRetryPayload).toMatchObject({
      data: {
        importRun: { status: 'success', nodeCount: 1 },
        refresh: { nodeCount: 1, addedCount: 1, skippedExistingCount: 2 },
      },
    })
    expect(nodeRetryPayload.data.importRun.refreshError).toBeUndefined()
    expect((await request(`/api/sources/imports/${newOnlyImportPayload.data.importRun.id}/nodes/retry`, { method: 'POST' })).status).toBe(409)
    const undoNewOnlyRes = await request(`/api/sources/imports/${newOnlyImportPayload.data.importRun.id}/undo`, { method: 'POST' })
    expect(undoNewOnlyRes.status).toBe(200)
    await expect(undoNewOnlyRes.json()).resolves.toMatchObject({
      data: { id: newOnlyImportPayload.data.importRun.id, status: 'undone', canUndo: false },
    })
    expect((await request(`/api/sources/imports/${newOnlyImportPayload.data.importRun.id}/undo`, { method: 'POST' })).status).toBe(409)
    expect((await request(`/api/sources/${newOnlyImportPayload.data.source.id}`)).status).toBe(404)

    const conflictingConfig = importedConfig
      .replace('DOMAIN-SUFFIX,golden-path.example.com,PROXY', 'DOMAIN-SUFFIX,golden-path.example.com,DIRECT')
      .replace('RULE-SET,golden-block,REJECT', 'RULE-SET,golden-block,DIRECT')
    const conflictPreviewRes = await request('/api/sources/import/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: conflictingConfig }),
    })
    expect(conflictPreviewRes.status).toBe(200)
    const conflictPreviewPayload = (await conflictPreviewRes.json()) as {
      data: {
        structured: { rules: number; remoteRuleSets: number; conflictingRules: number; conflictingRemoteRuleSets: number }
        diff: {
          nodes: { counts: { duplicate: number } }
          rules: { items: Array<{ key: string; status: string; resolvable?: boolean; changes: Array<{ field: string; before?: string; after?: string }> }> }
          remoteRuleSets: { items: Array<{ key: string; status: string; resolvable?: boolean }> }
        }
      }
    }
    expect(conflictPreviewPayload.data.structured).toMatchObject({
      rules: 0,
      remoteRuleSets: 0,
      conflictingRules: 1,
      conflictingRemoteRuleSets: 1,
    })
    expect(conflictPreviewPayload.data.diff.nodes.counts.duplicate).toBe(2)
    expect(conflictPreviewPayload.data.diff.rules.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'conflict',
        resolvable: true,
        changes: [expect.objectContaining({ field: 'target', before: 'PROXY', after: 'DIRECT' })],
      }),
    ]))
    expect(conflictPreviewPayload.data.diff.remoteRuleSets.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'conflict', resolvable: true }),
    ]))

    const conflictImportRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Conflict Source', content: conflictingConfig, importStructured: true }),
    })
    expect(conflictImportRes.status).toBe(201)
    const conflictImportPayload = (await conflictImportRes.json()) as {
      data: {
        source: { id: string }
        structuredImport: { rules: number; remoteRuleSets: number; conflictingRules: number; conflictingRemoteRuleSets: number }
      }
    }
    expect(conflictImportPayload.data.structuredImport).toMatchObject({
      rules: 0,
      remoteRuleSets: 0,
      conflictingRules: 1,
      conflictingRemoteRuleSets: 1,
    })
    expect((await request(`/api/sources/${conflictImportPayload.data.source.id}`, { method: 'DELETE' })).status).toBe(200)

    const ruleConflict = conflictPreviewPayload.data.diff.rules.items.find((item) => item.status === 'conflict')!
    const remoteSetConflict = conflictPreviewPayload.data.diff.remoteRuleSets.items.find((item) => item.status === 'conflict')!
    const resolvedImportRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Resolved Conflict Source',
        content: conflictingConfig,
        importStructured: true,
        structuredConflictResolutions: {
          [ruleConflict.key]: 'use-imported',
          [remoteSetConflict.key]: 'use-imported',
        },
      }),
    })
    expect(resolvedImportRes.status).toBe(201)
    const resolvedImportPayload = await resolvedImportRes.json() as {
      data: {
        importRun: { id: string }
        structuredImport: { conflictingRules: number; conflictingRemoteRuleSets: number }
      }
    }
    expect(resolvedImportPayload.data.structuredImport).toMatchObject({
      conflictingRules: 0,
      conflictingRemoteRuleSets: 0,
    })

    const rulesAfterResolution = await (await request('/api/rules')).json() as {
      data: Array<{ payload: string; targetGroupId: string }>
    }
    expect(rulesAfterResolution.data.find((rule) => rule.payload === 'golden-path.example.com')?.targetGroupId).toBe('builtin-direct')
    const setsAfterResolution = await (await request('/api/remote-rule-sets')).json() as {
      data: Array<{ url: string; targetGroupId: string }>
    }
    expect(setsAfterResolution.data.find((set) => set.url === 'https://rules.golden-path.example.com/block.yaml')?.targetGroupId).toBe('builtin-direct')

    const undoResolvedRes = await request(`/api/sources/imports/${resolvedImportPayload.data.importRun.id}/undo`, { method: 'POST' })
    expect(undoResolvedRes.status).toBe(200)
    const rulesAfterResolvedUndo = await (await request('/api/rules')).json() as {
      data: Array<{ payload: string; targetGroupId: string }>
    }
    expect(rulesAfterResolvedUndo.data.find((rule) => rule.payload === 'golden-path.example.com')?.targetGroupId).toBe('builtin-proxy')
    const setsAfterResolvedUndo = await (await request('/api/remote-rule-sets')).json() as {
      data: Array<{ url: string; targetGroupId: string }>
    }
    expect(setsAfterResolvedUndo.data.find((set) => set.url === 'https://rules.golden-path.example.com/block.yaml')?.targetGroupId).toBe('builtin-reject')

    const laterEditImportRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Conditional Undo Source',
        content: conflictingConfig,
        importStructured: true,
        structuredConflictResolutions: { [ruleConflict.key]: 'use-imported' },
      }),
    })
    const laterEditImportPayload = await laterEditImportRes.json() as { data: { importRun: { id: string } } }
    const ruleAfterSecondResolution = (await (await request('/api/rules')).json() as {
      data: Array<{ id: string; payload: string; targetGroupId: string }>
    }).data.find((rule) => rule.payload === 'golden-path.example.com')!
    expect(ruleAfterSecondResolution.targetGroupId).toBe('builtin-direct')
    await env.DB.prepare('UPDATE rules SET target_group_id = ? WHERE id = ?')
      .bind('builtin-reject', ruleAfterSecondResolution.id).run()
    expect((await request(`/api/sources/imports/${laterEditImportPayload.data.importRun.id}/undo`, { method: 'POST' })).status).toBe(200)
    const ruleAfterConditionalUndo = (await (await request('/api/rules')).json() as {
      data: Array<{ payload: string; targetGroupId: string }>
    }).data.find((rule) => rule.payload === 'golden-path.example.com')
    expect(ruleAfterConditionalUndo?.targetGroupId).toBe('builtin-reject')

    const retryConfig = importedConfig
      .replaceAll('golden-path.example.com', 'retry.golden-path.example.com')
      .replaceAll('golden-block', 'retry-block')
    const retrySeedRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Retry Source', content: retryConfig }),
    })
    expect(retrySeedRes.status).toBe(201)
    const retrySeedPayload = await retrySeedRes.json() as { data: { importRun: { id: string } } }
    await env.DB.prepare(
      `UPDATE source_import_runs SET status = 'partial', structured_error = ? WHERE id = ?`
    ).bind('Structured rule import failed', retrySeedPayload.data.importRun.id).run()

    const structuredRetryPreviewRes = await request(
      `/api/sources/imports/${retrySeedPayload.data.importRun.id}/structured/preview`,
      { method: 'POST' }
    )
    expect(structuredRetryPreviewRes.status).toBe(200)
    await expect(structuredRetryPreviewRes.json()).resolves.toMatchObject({
      data: { structured: { rules: 1, remoteRuleSets: 1 } },
    })
    const structuredRetryRes = await request(
      `/api/sources/imports/${retrySeedPayload.data.importRun.id}/structured/retry`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
    )
    expect(structuredRetryRes.status).toBe(200)
    const structuredRetryPayload = await structuredRetryRes.json() as {
      data: { importRun: { status: string; structuredError?: string }; structuredImport: { rules: number; remoteRuleSets: number } }
    }
    expect(structuredRetryPayload.data.importRun).toMatchObject({ status: 'success' })
    expect(structuredRetryPayload.data.importRun.structuredError).toBeUndefined()
    expect(structuredRetryPayload.data.structuredImport).toMatchObject({ rules: 1, remoteRuleSets: 1 })
    expect((await request(`/api/sources/imports/${retrySeedPayload.data.importRun.id}/structured/retry`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status).toBe(409)
    expect((await request(`/api/sources/imports/${retrySeedPayload.data.importRun.id}/undo`, { method: 'POST' })).status).toBe(200)
    const rulesAfterRetryUndo = await (await request('/api/rules')).json() as { data: Array<{ payload: string }> }
    expect(rulesAfterRetryUndo.data.some((rule) => rule.payload === 'retry.golden-path.example.com')).toBe(false)

    const staleAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const freshAt = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO source_import_runs
          (id, source_id, source_name, format, node_import_mode, status, created_at)
         VALUES (?, ?, 'Interrupted Import', 'mihomo', 'all', 'running', ?)`
      ).bind('stale-initial-import', importPayload.data.source.id, staleAt),
      env.DB.prepare(
        `INSERT INTO source_import_runs
          (id, source_id, source_name, format, node_import_mode, status, structured_error, created_at, completed_at)
         VALUES (?, ?, 'Interrupted Retry', 'mihomo', 'all', 'running', ?, ?, ?)`
      ).bind('stale-structured-retry', importPayload.data.source.id, 'Structured rule import failed', staleAt, staleAt),
      env.DB.prepare(
        `INSERT INTO source_import_runs
          (id, source_id, source_name, format, node_import_mode, status, created_at)
         VALUES (?, ?, 'Active Import', 'mihomo', 'all', 'running', ?)`
      ).bind('fresh-running-import', importPayload.data.source.id, freshAt),
    ])
    const recoveredRunsRes = await request('/api/sources/imports')
    expect(recoveredRunsRes.status).toBe(200)
    const recoveredRuns = (await recoveredRunsRes.json() as {
      data: Array<{ id: string; status: string; refreshError?: string; structuredError?: string }>
    }).data
    expect(recoveredRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'stale-initial-import', status: 'partial', refreshError: 'Import did not complete' }),
      expect.objectContaining({ id: 'stale-structured-retry', status: 'partial', structuredError: 'Structured rule import failed' }),
      expect.objectContaining({ id: 'fresh-running-import', status: 'running' }),
    ]))

    const configsRes = await request('/api/export/configs')
    expect(configsRes.status).toBe(200)
    const configsPayload = (await configsRes.json()) as { success: boolean; data: ExportConfig[] }
    const defaultConfig = configsPayload.data.find((c) => c.format === 'mihomo')
    expect(defaultConfig).toBeTruthy()

    const clashRes = await request(`/sub/${defaultConfig!.token}/clash.yaml`)
    expect(clashRes.status).toBe(200)
    expect(await clashRes.text()).toContain('mixed-port: 7890')

    const subRes = await request(`/sub/${defaultConfig!.token}/mihomo.yaml`)
    expect(subRes.status).toBe(200)
    const yamlText = await subRes.text()

    const parsed = parseYAML(yamlText) as {
      proxies: Array<{ name: string; server: string }>
      'proxy-groups': Array<{ name: string; proxies: string[] }>
      rules: string[]
    }

    const serverNames = parsed.proxies.map((p) => p.server)
    expect(serverNames).toContain('us.golden-path.example.com')
    expect(serverNames).toContain('jp.golden-path.example.com')

    expect(parsed['proxy-groups'].length).toBeGreaterThan(0)
    const groupNames = new Set(parsed['proxy-groups'].map((g) => g.name))
    // Base outlets from the zero-setup chain must exist regardless of scenario combo.
    expect(groupNames.has('节点选择') || groupNames.has('PROXY')).toBe(true)

    // Every group's member list must resolve to either a known proxy or another known group,
    // catching dangling references across the node/group/policy sync chain.
    const proxyNames = new Set(parsed.proxies.map((p) => p.name))
    for (const group of parsed['proxy-groups']) {
      for (const member of group.proxies ?? []) {
        const resolvable =
          proxyNames.has(member) || groupNames.has(member) || ['DIRECT', 'REJECT'].includes(member)
        expect(resolvable, `group "${group.name}" references unknown member "${member}"`).toBe(true)
      }
    }

    expect(Array.isArray(parsed.rules)).toBe(true)
    expect(parsed.rules.length).toBeGreaterThan(0)
    expect(parsed.rules[parsed.rules.length - 1]).toContain('MATCH')

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('payload:\n  - +.golden-path.example.com\n')) as typeof fetch
    try {
      await assertEveryAdvertisedFormatDownloads(defaultConfig!.token)
      const egernWithOverride = await (await request(`/sub/${defaultConfig!.token}/egern.yaml`)).text()
      expect(egernWithOverride).toContain(nativeEgernRuleSetUrl)

      const backupRes = await request('/api/data/export')
      expect(backupRes.status).toBe(200)
      expect(backupRes.headers.get('cache-control')).toBe('no-store')
      const backup = await backupRes.json() as {
        success: boolean
        data: { version: number; containsSensitiveData: boolean; tables: Record<string, Record<string, unknown>[]> }
      }
      expect(backup).toMatchObject({ success: true, data: { version: 4, containsSensitiveData: true } })
      expect((backup.data.tables.nodes ?? []).length).toBeGreaterThanOrEqual(2)
      expect((backup.data.tables.export_configs ?? []).some(row => row.token === defaultConfig!.token)).toBe(true)
      expect((backup.data.tables.remote_rule_sets ?? []).some(row => (
        row.id === importedRuleSet!.id
        && row.source_overrides === JSON.stringify({ egern: nativeEgernRuleSetUrl })
      ))).toBe(true)

      const validateBackupRes = await request('/api/data/import/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(backup),
      })
      expect(validateBackupRes.status).toBe(200)
      await expect(validateBackupRes.json()).resolves.toMatchObject({
        success: true,
        data: {
          version: backup.data.version,
          containsSensitiveData: true,
          tables: { sources: expect.any(Number), nodes: expect.any(Number), export_configs: expect.any(Number) },
        },
      })

      const clearRes = await request('/api/data', { method: 'DELETE' })
      expect(clearRes.status).toBe(200)
      expect((await request(`/api/sources/${importPayload.data.source.id}`)).status).toBe(404)
      expect((await request(`/sub/${defaultConfig!.token}/mihomo.yaml`)).status).toBe(404)

      const restoreRes = await request('/api/data/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(backup),
      })
      expect(restoreRes.status).toBe(200)
      expect((await request(`/api/sources/${importPayload.data.source.id}`)).status).toBe(200)
      await assertEveryAdvertisedFormatDownloads(defaultConfig!.token)

      const restoredRules = await (await request('/api/rules')).json() as { data: Array<{ payload: string }> }
      const restoredSets = await (await request('/api/remote-rule-sets')).json() as { data: Array<{ url: string; sourceOverrides: Record<string, string> }> }
      expect(restoredRules.data.some(rule => rule.payload === 'golden-path.example.com')).toBe(true)
      expect(restoredSets.data.some(set => set.url === 'https://rules.golden-path.example.com/block.yaml')).toBe(true)
      expect(restoredSets.data.find(set => set.url === 'https://rules.golden-path.example.com/block.yaml')?.sourceOverrides)
        .toEqual({ egern: nativeEgernRuleSetUrl })
    } finally {
      globalThis.fetch = originalFetch
    }

    const deleteRes = await request(`/api/sources/${importPayload.data.source.id}`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(200)
    const importRunsRes = await request('/api/sources/imports')
    expect(importRunsRes.status).toBe(200)
    const importRunsPayload = await importRunsRes.json() as { data: Array<{ id: string; status: string; canUndo: boolean }> }
    expect(importRunsPayload.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: importPayload.data.importRun!.id, status: 'undone', canUndo: false }),
      expect.objectContaining({ id: newOnlyImportPayload.data.importRun.id, status: 'undone', canUndo: false }),
    ]))
    expect(JSON.stringify(importRunsPayload)).not.toContain('pwd')
    expect(JSON.stringify(importRunsPayload)).not.toContain('new-secret')
    const rulesAfterDelete = (await (await request('/api/rules')).json()) as { data: Array<{ payload: string }> }
    const setsAfterDelete = (await (await request('/api/remote-rule-sets')).json()) as { data: Array<{ url: string }> }
    expect(rulesAfterDelete.data.some((rule) => rule.payload === 'golden-path.example.com')).toBe(false)
    expect(setsAfterDelete.data.some((set) => set.url === 'https://rules.golden-path.example.com/block.yaml')).toBe(false)
  // Recent Miniflare/workerd releases can push this exhaustive real-D1 path
  // slightly beyond two minutes when Web and Worker suites share CI resources.
  }, 180000)

  it('preserves disjoint concurrent settings patches and independent DNS selection', async () => {
    const baseline = await request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        language: 'zh',
        routingPolicyTemplate: 'router',
        dnsMode: 'smart',
      }),
    })
    expect(baseline.status).toBe(200)

    const [languageResponse, dnsResponse] = await Promise.all([
      request('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language: 'en' }),
      }),
      request('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dnsMode: 'fake-ip' }),
      }),
    ])
    expect(languageResponse.status).toBe(200)
    expect(dnsResponse.status).toBe(200)

    const concurrentSettings = await (await request('/api/settings')).json() as {
      data: { language: string; routingPolicyTemplate: string; dnsMode: string }
    }
    expect(concurrentSettings.data).toMatchObject({
      language: 'en',
      routingPolicyTemplate: 'router',
      dnsMode: 'fake-ip',
    })

    const sameTemplate = await request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ routingPolicyTemplate: 'router' }),
    })
    expect(sameTemplate.status).toBe(200)
    await expect(sameTemplate.json()).resolves.toMatchObject({
      data: { routingPolicyTemplate: 'router', dnsMode: 'fake-ip' },
    })

    const changedTemplate = await request('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ routingPolicyTemplate: 'common' }),
    })
    expect(changedTemplate.status).toBe(200)
    await expect(changedTemplate.json()).resolves.toMatchObject({
      data: { routingPolicyTemplate: 'common', dnsMode: 'fake-ip' },
    })
  }, 30000)

  it('rejects missing and cyclic policy-group references against real D1 state', async () => {
    const missing = await request('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Golden Missing Reference',
        type: 'select',
        groupIds: ['missing-golden-group'],
      }),
    })
    expect(missing.status).toBe(409)
    await expect(missing.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('references a missing group: missing-golden-group'),
    })

    const missingCollection = await request('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Golden Missing Node Group',
        type: 'select',
        collectionIds: ['missing-golden-collection'],
      }),
    })
    expect(missingCollection.status).toBe(409)
    await expect(missingCollection.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('references a missing node group: missing-golden-collection'),
    })

    const parentResponse = await request('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Golden Cycle Parent',
        type: 'select',
        collectionIds: [DEFAULT_NODE_POOL_COLLECTION_ID],
      }),
    })
    expect(parentResponse.status).toBe(201)
    const parent = await parentResponse.json() as { data: { id: string } }

    const childResponse = await request('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Golden Cycle Child',
        type: 'select',
        collectionIds: [DEFAULT_NODE_POOL_COLLECTION_ID],
        groupIds: [parent.data.id],
      }),
    })
    expect(childResponse.status).toBe(201)
    const child = await childResponse.json() as { data: { id: string } }

    const cycle = await request(`/api/groups/${parent.data.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupIds: [child.data.id] }),
    })
    expect(cycle.status).toBe(409)
    await expect(cycle.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('group reference cycle detected'),
    })

    const parentAfterRejection = await (await request(`/api/groups/${parent.data.id}`)).json() as {
      data: { groupIds: string[] }
    }
    expect(parentAfterRejection.data.groupIds).toEqual([])

    const referencedDelete = await request(`/api/groups/${parent.data.id}`, { method: 'DELETE' })
    expect(referencedDelete.status).toBe(409)
    await expect(referencedDelete.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('group is referenced by policy group'),
    })

    expect((await request(`/api/groups/${child.data.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await request(`/api/groups/${parent.data.id}`, { method: 'DELETE' })).status).toBe(200)
  }, 30000)
})

function assertExportShape(format: ExportSubscriptionFormat, content: string): void {
  if (format === 'mihomo' || format === 'clash' || format === 'stash') {
    const parsed = parseYAML(content) as Record<string, unknown>
    expect(Array.isArray(parsed.proxies), `${format} proxies`).toBe(true)
    expect(Array.isArray(parsed.rules), `${format} rules`).toBe(true)
    return
  }
  if (format === 'egern') {
    const parsed = parseYAML(content) as Record<string, unknown>
    expect(Array.isArray(parsed.proxies), 'egern proxies').toBe(true)
    expect(Array.isArray(parsed.rules), 'egern rules').toBe(true)
    return
  }
  if (format === 'singbox') {
    const parsed = JSON.parse(content) as Record<string, unknown>
    expect(validateSingbox(parsed), JSON.stringify(validateSingbox.errors)).toBe(true)
    expect(Array.isArray(parsed.outbounds), 'sing-box outbounds').toBe(true)
    expect(typeof parsed.route, 'sing-box route').toBe('object')
    return
  }
  if (format === 'nodes_base64') {
    const decoded = atob(content.trim())
    expect(decoded).toMatch(/trojan:\/\//)
    return
  }
  if (format === 'nodes_raw') {
    expect(content).toMatch(/trojan:\/\//)
    return
  }

  const requiredSections: Record<string, string[]> = {
    loon: ['[General]', '[Proxy]', '[Proxy Group]', '[Rule]'],
    surge: ['[General]', '[Proxy]', '[Proxy Group]', '[Rule]'],
    shadowrocket: ['[General]', '[Proxy]', '[Proxy Group]', '[Rule]'],
    quantumultx: ['[general]', '[server_local]', '[policy]', '[filter_local]'],
  }
  for (const section of requiredSections[format] ?? []) expect(content).toContain(section)
}
