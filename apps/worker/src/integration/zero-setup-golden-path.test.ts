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
import { EXPORT_FORMAT_FILENAMES, type ExportSubscriptionFormat } from '@uni-conf/shared'

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

  it('turns a single pasted config import into coherent downloads for every advertised format', async () => {
    // Miniflare/D1 startup and the full zero-setup chain can be slow under CI load.
    const importRes = await request('/api/sources/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Golden Path Source',
        content: `
proxies:
  - { name: '🇺🇸 US 01', type: trojan, server: us.golden-path.example.com, port: 443, password: pwd }
  - { name: '🇯🇵 JP 01', type: trojan, server: jp.golden-path.example.com, port: 443, password: pwd }
rules:
  - DOMAIN-SUFFIX,golden-path.example.com,PROXY
  - RULE-SET,golden-block,REJECT
rule-providers:
  golden-block: { type: http, behavior: domain, url: https://rules.golden-path.example.com/block.yaml, interval: 86400 }
`,
        importStructured: true,
      }),
    })
    expect(importRes.status).toBe(201)
    const importPayload = (await importRes.json()) as {
      success: boolean
      data: {
        refresh?: { nodeCount: number }
        refreshError?: string
        structuredImport?: { rules: number; remoteRuleSets: number; skippedRules: number }
      }
    }
    expect(importPayload.success).toBe(true)
    expect(importPayload.data.refreshError).toBeUndefined()
    expect(importPayload.data.refresh?.nodeCount).toBe(2)
    expect(importPayload.data.structuredImport).toEqual({ rules: 1, remoteRuleSets: 1, skippedRules: 0 })

    const rulesRes = await request('/api/rules')
    const rulesPayload = (await rulesRes.json()) as { data: Array<{ payload: string }> }
    expect(rulesPayload.data.some((rule) => rule.payload === 'golden-path.example.com')).toBe(true)

    const ruleSetsRes = await request('/api/remote-rule-sets')
    const ruleSetsPayload = (await ruleSetsRes.json()) as { data: Array<{ url: string }> }
    expect(ruleSetsPayload.data.some((set) => set.url === 'https://rules.golden-path.example.com/block.yaml')).toBe(true)

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

    for (const [format, filename] of Object.entries(EXPORT_FORMAT_FILENAMES) as Array<[ExportSubscriptionFormat, string]>) {
      const response = await request(`/sub/${defaultConfig!.token}/${filename}`)
      expect(response.status, `${format} download status`).toBe(200)
      const content = await response.text()
      expect(content.length, `${format} content length`).toBeGreaterThan(20)
      assertExportShape(format, content)
    }
  }, 20000)
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
