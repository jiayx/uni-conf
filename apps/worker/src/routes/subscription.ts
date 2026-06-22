import { Hono } from 'hono'
import { generateMihomoYaml } from '../generators/mihomo'
import { generateSingboxJson } from '../generators/singbox'
import { generateLoon } from '../generators/loon'
import { generateNodeSubscriptionBase64, generateNodeSubscriptionRaw } from '../generators/node-subscription'
import {
  generateEgern,
  generateQuantumultX,
  generateShadowrocket,
  generateStashYaml,
  generateSurge,
} from '../generators/client-configs'
import { buildExportData, getEnabledExportConfigByToken } from '../export-data'
import { getAppSettings } from '../services/app-settings'
import type { Env } from '../types'
import { getExportFormatFromSubscriptionFilename } from '@uni-conf/shared'
import type { ProxySource } from '@uni-conf/types'

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
    sources,
    nodes,
    groups,
    rules,
    remoteSets,
    collectionNodeNames,
  } = await buildExportData(c.env.DB, config)
  const settings = await getAppSettings(c.env.DB)
  const format = getExportFormatFromSubscriptionFilename(filename)
  if (!format) {
    return new Response(`# Unknown format: ${filename}\n`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  let content: string
  let contentType: string

  if (format === 'mihomo' || format === 'clash') {
    content = generateMihomoYaml(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'text/yaml; charset=utf-8'
  } else if (format === 'singbox') {
    content = generateSingboxJson(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'application/json; charset=utf-8'
  } else if (format === 'loon') {
    content = generateLoon(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'surge') {
    content = generateSurge(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'shadowrocket') {
    content = generateShadowrocket(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'quantumultx') {
    content = generateQuantumultX(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'stash') {
    content = generateStashYaml(nodes, groups, rules, remoteSets, collectionNodeNames, { dnsMode: settings.dnsMode })
    contentType = 'text/yaml; charset=utf-8'
  } else if (format === 'egern') {
    content = generateEgern(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames)
    contentType = 'text/yaml; charset=utf-8'
  } else if (format === 'nodes_base64') {
    content = generateNodeSubscriptionBase64(nodeRows)
    contentType = 'text/plain; charset=utf-8'
  } else if (format === 'nodes_raw') {
    content = generateNodeSubscriptionRaw(nodeRows)
    contentType = 'text/plain; charset=utf-8'
  } else {
    return new Response(`# Unknown format: ${filename}\n`, { status: 400 })
  }

  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Subscription-Userinfo': buildSubscriptionUserInfoHeader(sources),
    },
  })
})

export function buildSubscriptionUserInfoHeader(sources: ProxySource[]): string {
  const summary = sources.reduce(
    (acc, source) => ({
      upload: acc.upload + (source.uploadBytes ?? 0),
      download: acc.download + (source.downloadBytes ?? 0),
      total: acc.total + (source.totalBytes ?? 0),
      expire: source.expireTime === undefined
        ? acc.expire
        : acc.expire === undefined
          ? source.expireTime
          : Math.min(acc.expire, source.expireTime),
      hasAny: acc.hasAny
        || source.uploadBytes !== undefined
        || source.downloadBytes !== undefined
        || source.totalBytes !== undefined
        || source.expireTime !== undefined,
    }),
    {
      upload: 0,
      download: 0,
      total: 0,
      expire: undefined as number | undefined,
      hasAny: false,
    }
  )

  if (!summary.hasAny) {
    return 'upload=0; download=0; total=10737418240; expire=4099680000'
  }

  const total = summary.total > 0 ? summary.total : 10737418240
  const expire = summary.expire ?? 4099680000
  return `upload=${summary.upload}; download=${summary.download}; total=${total}; expire=${expire}`
}
