import { Hono } from 'hono'
import { generateMihomoYaml } from '../generators/mihomo'
import { generateSingboxJson } from '../generators/singbox'
import { generateLoon } from '../generators/loon'
import { mapGroup, mapNode, mapRemoteRuleSet, mapRule } from '../db/helpers'
import type { Env } from '../types'

export const subscriptionRouter = new Hono<{ Bindings: Env }>()

// GET /sub/:token/:filename
// Public subscription endpoint — no auth required
subscriptionRouter.get('/sub/:token/:filename', async (c) => {
  const token = c.req.param('token')
  const filename = c.req.param('filename')

  // Look up export config by token
  const config = await c.env.DB
    .prepare('SELECT * FROM export_configs WHERE token = ? AND enabled = 1')
    .bind(token)
    .first()

  if (!config) {
    return new Response('# Subscription not found or disabled\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  // Load all enabled nodes, groups, rules, remote sets
  const nodes = (await c.env.DB.prepare('SELECT * FROM nodes WHERE enabled = 1').all()).results ?? []
  const groups = (await c.env.DB.prepare('SELECT * FROM groups WHERE enabled = 1 ORDER BY sort_order ASC').all()).results ?? []
  const rules = (await c.env.DB.prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY sort_order ASC').all()).results ?? []
  const remoteSets = (await c.env.DB.prepare('SELECT * FROM remote_rule_sets WHERE enabled = 1').all()).results ?? []

  const rawNodes = nodes as Record<string, unknown>[]
  const rawGroups = groups as Record<string, unknown>[]
  const rawRules = rules as Record<string, unknown>[]
  const rawSets = remoteSets as Record<string, unknown>[]
  const mappedNodes = rawNodes.map(mapNode)
  const mappedGroups = rawGroups.map(mapGroup)
  const mappedRules = rawRules.map(mapRule)
  const mappedSets = rawSets.map(mapRemoteRuleSet)

  let content: string
  let contentType: string

  // Determine format from filename
  if (filename === 'mihomo.yaml' || filename === 'clash.yaml') {
    content = generateMihomoYaml(mappedNodes, mappedGroups, mappedRules, mappedSets)
    contentType = 'text/yaml; charset=utf-8'
  } else if (filename === 'singbox.json') {
    content = generateSingboxJson(mappedNodes, mappedGroups, mappedRules, mappedSets)
    contentType = 'application/json; charset=utf-8'
  } else if (filename === 'loon.conf') {
    content = generateLoon(rawNodes, rawGroups, rawRules, rawSets)
    contentType = 'text/plain; charset=utf-8'
  } else if (filename === 'nodes.txt') {
    // Raw node URIs, base64 encoded
    content = generateNodeSubscription(rawNodes)
    contentType = 'text/plain; charset=utf-8'
  } else {
    return new Response(`# Unknown format: ${filename}\n`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Subscription-Userinfo': `upload=0; download=0; total=10737418240; expire=4099680000`,
    },
  })
})

function generateNodeSubscription(nodes: Record<string, unknown>[]): string {
  const lines: string[] = []
  for (const node of nodes) {
    const name = encodeURIComponent(String(node['name'] ?? ''))
    const server = String(node['server'] ?? '')
    const port = Number(node['port'] ?? 0)
    const protocol = String(node['protocol'] ?? '')
    const parsed = safeJson(node['parsed_config'] as string)

    let uri: string | null = null
    const extra = asRecord(parsed?.['extra'])

    if (protocol === 'ss') {
      const cipher = String(extra?.['cipher'] ?? 'aes-256-gcm')
      const password = String(parsed?.['password'] ?? '')
      const credentials = btoa(`${cipher}:${password}`)
      uri = `ss://${credentials}@${server}:${port}#${name}`
    } else if (protocol === 'vmess') {
      const vmessObj = {
        v: '2', ps: decodeURIComponent(name), add: server, port: String(port),
        id: String(parsed?.['uuid'] ?? ''), aid: '0', net: String(parsed?.['network'] ?? 'tcp'),
        type: 'none', host: '', path: String(extra?.['wsPath'] ?? ''),
        tls: parsed?.['tls'] ? 'tls' : '',
      }
      uri = `vmess://${btoa(JSON.stringify(vmessObj))}`
    } else if (protocol === 'vless') {
      const uuid = String(parsed?.['uuid'] ?? '')
      uri = `vless://${uuid}@${server}:${port}?encryption=none#${name}`
    } else if (protocol === 'trojan') {
      const password = String(parsed?.['password'] ?? '')
      uri = `trojan://${password}@${server}:${port}#${name}`
    } else if (protocol === 'hysteria2' || protocol === 'hy2') {
      const password = String(parsed?.['password'] ?? '')
      uri = `hysteria2://${password}@${server}:${port}#${name}`
    }

    if (uri) lines.push(uri)
  }
  // Base64 encode the whole thing
  return btoa(lines.join('\n'))
}

function safeJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null
  try { return JSON.parse(text) as Record<string, unknown> } catch { return null }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}
