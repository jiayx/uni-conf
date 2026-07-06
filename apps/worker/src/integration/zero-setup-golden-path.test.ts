/// <reference types="node" />

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as parseYAML } from 'js-yaml'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker from '../index'
import type { Env } from '../types'
import type { ExportConfig } from '@uni-conf/types'

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

  it('turns a single pasted config import into a downloadable, coherent mihomo config', async () => {
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
`,
      }),
    })
    expect(importRes.status).toBe(201)
    const importPayload = (await importRes.json()) as {
      success: boolean
      data: { refresh?: { nodeCount: number }; refreshError?: string }
    }
    expect(importPayload.success).toBe(true)
    expect(importPayload.data.refreshError).toBeUndefined()
    expect(importPayload.data.refresh?.nodeCount).toBe(2)

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
  }, 20000)
})
