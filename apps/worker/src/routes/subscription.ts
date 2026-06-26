import { Hono } from 'hono'
import { buildExportData, getEnabledExportConfigByToken } from '../export-data'
import { renderExportData } from '../generators/export-renderer'
import { getAppSettings } from '../services/app-settings'
import { findEmptyNodeExportWarning } from '../services/export-validation'
import type { Env } from '../types'
import { getExportFormatFromSubscriptionFilename } from '@uni-conf/shared'
import type { ProxySource } from '@uni-conf/types'

export const subscriptionRouter = new Hono<{ Bindings: Env }>()

// GET /sub/:token/:filename
// Public subscription endpoint — no auth required
subscriptionRouter.get('/sub/:token/:filename', async (c) => {
  const token = c.req.param('token')
  const filename = c.req.param('filename')
  const format = getExportFormatFromSubscriptionFilename(filename)
  if (!format) {
    return new Response(`# Unknown format: ${filename}\n`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  // Look up export config by token
  const config = await getEnabledExportConfigByToken(c.env.DB, token)

  if (!config) {
    return new Response('# Subscription not found or disabled\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const exportData = await buildExportData(c.env.DB, config)
  const settings = await getAppSettings(c.env.DB)
  const blockingWarning = findEmptyNodeExportWarning(exportData, format)
  if (blockingWarning) {
    return new Response(`# ${blockingWarning.message}\n`, {
      status: 409,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Subscription-Userinfo': buildSubscriptionUserInfoHeader(exportData.sources),
      },
    })
  }
  const rendered = renderExportData(exportData, format, { dnsMode: settings.dnsMode })
  if (!rendered) {
    return new Response(`# Unknown format: ${filename}\n`, { status: 400 })
  }

  return new Response(rendered.content, {
    headers: {
      'Content-Type': rendered.contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Subscription-Userinfo': buildSubscriptionUserInfoHeader(exportData.sources),
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
