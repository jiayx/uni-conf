import { Hono } from 'hono'
import { generateMihomoYaml } from '../generators/mihomo'
import { generateSingboxJson } from '../generators/singbox'
import { generateLoon } from '../generators/loon'
import { generateNodeSubscriptionBase64, generateNodeSubscriptionRaw } from '../generators/node-subscription'
import { buildExportData, getEnabledExportConfigByToken } from '../export-data'
import type { Env } from '../types'

export const subscriptionRouter = new Hono<{ Bindings: Env }>()

// GET /sub/:token/:filename
// Public subscription endpoint — no auth required
subscriptionRouter.get('/sub/:token/:filename', async (c) => {
  const token = c.req.param('token')
  const filename = c.req.param('filename')

  // Look up export config by token
  const config = await getEnabledExportConfigByToken(c.env.DB, token)

  if (!config) {
    return new Response('# Subscription not found or disabled\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const {
    nodeRows,
    groupRows,
    ruleRows,
    remoteSetRows,
    nodes,
    groups,
    rules,
    remoteSets,
  } = await buildExportData(c.env.DB, config)

  let content: string
  let contentType: string

  // Determine format from filename
  if (filename === 'mihomo.yaml' || filename === 'clash.yaml') {
    content = generateMihomoYaml(nodes, groups, rules, remoteSets)
    contentType = 'text/yaml; charset=utf-8'
  } else if (filename === 'singbox.json') {
    content = generateSingboxJson(nodes, groups, rules, remoteSets)
    contentType = 'application/json; charset=utf-8'
  } else if (filename === 'loon.conf') {
    content = generateLoon(nodeRows, groupRows, ruleRows, remoteSetRows)
    contentType = 'text/plain; charset=utf-8'
  } else if (filename === 'nodes.txt') {
    content = generateNodeSubscriptionBase64(nodeRows)
    contentType = 'text/plain; charset=utf-8'
  } else if (filename === 'nodes-raw.txt') {
    content = generateNodeSubscriptionRaw(nodeRows)
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
