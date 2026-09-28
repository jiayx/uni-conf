import { Hono } from 'hono'
import { html } from 'hono/html'
import { buildExportData, getEnabledExportConfigByToken } from '../export-data'
import { renderExportData } from '../generators/export-renderer'
import { getAppSettings } from '../services/app-settings'
import { findBlockingExportWarning } from '../services/export-validation'
import { validateRenderedExport } from '../services/export-artifact-validation'
import type { Env } from '../types'
import {
  getExportFormatFromSubscriptionFilename,
  getExportSubscriptionFilename,
  EXPORT_FORMAT_FILENAMES,
  isFullConfigExportFormat,
  serializeExportCapabilityProfile,
} from '@uni-conf/shared'
import type { ExportFormat, ProxySource } from '@uni-conf/types'
import {
  getConvertedRemoteRuleSet,
  preflightRuleSetConversions,
  resolveRuleSetConversionSource,
  RuleSetConversionError,
} from '../services/rule-set-conversion'
import { resolveExportRuleSetConversionPolicy } from '../services/export-conversion-policy'
import { getEffectiveExportDnsPolicy } from '../services/export-dns'
import { exportNeedsInlineManagedRealIpDomains, getManagedRealIpDomains } from '../services/managed-dns-resources'
import { DEFAULT_WORKSPACE_ID, defaultExportConfigId } from '../services/workspaces'
import { buildContentEtag, requestMatchesEtag } from '../services/content-etag'

export const subscriptionRouter = new Hono<{ Bindings: Env }>()

// GET /sub/:token/rules/:ruleSetId/:filename
// Token-scoped conversion endpoint used when the source and target clients use
// different rule-set containers. It never silently broadens compound rules.
subscriptionRouter.get('/sub/:token/rules/:ruleSetId/:filename', async (c) => {
  const token = c.req.param('token')
  const target =
    c.req.param('filename') === 'singbox.json'
      ? 'singbox'
      : c.req.param('filename') === 'mihomo.yaml'
        ? 'mihomo'
        : c.req.param('filename') === 'egern.yaml'
          ? 'egern'
          : parseTextConversionTarget(c.req.param('filename'))
  if (!target) return convertedRuleSetError('Unknown conversion target', 400, 'conversion_target_invalid')

  const config = await getEnabledExportConfigByToken(c.env.DB, token)
  if (!config) return convertedRuleSetError('Subscription not found or disabled', 404, 'subscription_unavailable')
  const workspaceId = config.workspaceId ?? DEFAULT_WORKSPACE_ID
  const settings = await getAppSettings(c.env.DB, workspaceId)
  const conversionPolicy = resolveExportRuleSetConversionPolicy(config, settings.ruleSetConversionPolicy)
  const requestedExportFormat = c.req.query('for')
  const exportFormat =
    requestedExportFormat === undefined
      ? target
      : isRuleSetConversionExportFormat(requestedExportFormat)
        ? requestedExportFormat
        : null
  if (!exportFormat) {
    return convertedRuleSetError('Unknown export format context', 400, 'conversion_export_format_invalid')
  }
  if (config.id !== defaultExportConfigId(workspaceId) && config.format !== exportFormat) {
    return convertedRuleSetError('Export profile does not support this format', 404, 'subscription_format_mismatch')
  }
  const exportData = await buildExportData(c.env.DB, config, exportFormat, workspaceId)
  const ruleSet = exportData.remoteSets.find((item) => item.id === c.req.param('ruleSetId') && item.enabled)
  if (!ruleSet)
    return convertedRuleSetError('Rule set is not included in this subscription', 404, 'rule_set_out_of_scope')
  const conversion = resolveRuleSetConversionSource(ruleSet, exportFormat)
  if (!conversion || conversion.target !== target) {
    return convertedRuleSetError('Rule set does not require this conversion target', 422, 'conversion_not_required')
  }

  try {
    const result = await getConvertedRemoteRuleSet(conversion.source, target, { kv: c.env.KV })
    if (conversionPolicy === 'strict' && result.skippedRuleCount > 0) {
      return convertedRuleSetError(
        `Strict completeness mode rejected ${result.skippedRuleCount} unconverted rule${result.skippedRuleCount === 1 ? '' : 's'}`,
        409,
        'conversion_incomplete',
      )
    }
    return new Response(result.content, {
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-UniConf-Converted-Rules': String(result.convertedRuleCount),
        'X-UniConf-Skipped-Rules': String(result.skippedRuleCount),
        'X-UniConf-Skipped-Rule-Types': serializeSkippedRuleTypes(result.skippedRuleTypes),
        'X-UniConf-Capability-Profile': serializeExportCapabilityProfile(exportFormat),
      },
    })
  } catch (error) {
    if (error instanceof RuleSetConversionError && error.code === 'too_large') {
      return convertedRuleSetError(error.message, 413, 'conversion_source_too_large')
    }
    if (error instanceof RuleSetConversionError && error.code === 'download_failed') {
      return convertedRuleSetError(error.message, 502, 'conversion_upstream_unavailable')
    }
    return convertedRuleSetError(
      'Rule set cannot be converted without changing its meaning',
      422,
      'conversion_invalid_content',
    )
  }
})

function serializeSkippedRuleTypes(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([type, count]) => `${type}=${count}`)
    .join(',')
}

function parseTextConversionTarget(filename: string): 'surge' | 'loon' | 'shadowrocket' | 'quantumultx' | null {
  const value = filename.endsWith('.list') ? filename.slice(0, -5) : ''
  return ['surge', 'loon', 'shadowrocket', 'quantumultx'].includes(value)
    ? (value as 'surge' | 'loon' | 'shadowrocket' | 'quantumultx')
    : null
}

function isRuleSetConversionExportFormat(value: string): value is Exclude<ExportFormat, 'nodes_base64' | 'nodes_raw'> {
  return isFullConfigExportFormat(value)
}

// Both public URLs share token checks, scope restrictions and rendering.
subscriptionRouter.use('/sub/:token', async (c, next) => {
  await next()
  c.res.headers.set('Vary', 'User-Agent, Accept')
  c.res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
})
subscriptionRouter.get('/sub/:token/:filename?', async (c) => {
  const token = c.req.param('token')
  const requestedFilename = c.req.param('filename')
  const mode = c.req.query('mode') ?? 'config'
  const requestedFormat = c.req.query('format')
  let format: ExportFormat | null
  if (requestedFilename) {
    format = getExportFormatFromSubscriptionFilename(requestedFilename)
  } else if (mode === 'nodes') {
    format = requestedFormat === undefined ? 'nodes_base64'
      : requestedFormat === 'nodes_base64' || requestedFormat === 'nodes_raw' ? requestedFormat : null
  } else if (mode === 'config') {
    format = requestedFormat === undefined
      ? detectSubscriptionFormat(c.req.header('User-Agent') ?? '')
      : isFullConfigExportFormat(requestedFormat) ? requestedFormat : null
  } else {
    format = null
  }
  const needsSelection = !requestedFilename && mode === 'config' && requestedFormat === undefined && !format
  if (!format && !needsSelection) {
    return convertedRuleSetError('Invalid subscription format or mode', 400, 'subscription_format_invalid')
  }

  // Look up export config by token
  const config = await getEnabledExportConfigByToken(c.env.DB, token)

  if (!config) {
    return new Response('# Subscription not found or disabled\n', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-UniConf-Error-Code': 'subscription_unavailable',
      },
    })
  }
  const workspaceId = config.workspaceId ?? DEFAULT_WORKSPACE_ID
  if (!format) {
    if (!c.req.header('Accept')?.includes('text/html')) {
      return convertedRuleSetError(
        'Cannot identify client. Specify ?format=mihomo (or another client), or ?mode=nodes for a node subscription.',
        400,
        'subscription_client_unknown',
      )
    }
    const formats = (Object.keys(EXPORT_FORMAT_FILENAMES) as ExportFormat[])
      .filter(value => config.id === defaultExportConfigId(workspaceId) || value === config.format)
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
    return c.html(html`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><title>UniConf · 选择订阅格式</title>
      <style>body{font:16px system-ui;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color-scheme:light dark}li{margin:1rem 0}a{color:inherit}</style></head>
      <body><h1>选择订阅格式</h1><p>通用链接默认根据客户端导出完整配置。浏览器无法识别客户端，请选择格式；仅订阅节点请选择节点订阅。</p>
      <ul>${formats.map(value => html`<li><a href="?${isFullConfigExportFormat(value) ? '' : 'mode=nodes&'}format=${value}">${getExportSubscriptionFilename(value)}</a></li>`)}</ul>
      <p>订阅链接包含访问令牌，请勿分享给他人。</p></body></html>`)
  }
  const filename = getExportSubscriptionFilename(format)
  if (config.id !== defaultExportConfigId(workspaceId) && config.format !== format) {
    return new Response('# Subscription format does not match this export profile\n', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-UniConf-Error-Code': 'subscription_format_mismatch',
      },
    })
  }

  const exportData = await buildExportData(c.env.DB, config, format, workspaceId)
  const settings = await getAppSettings(c.env.DB, workspaceId)
  const blockingWarning = findBlockingExportWarning(exportData, format)
  if (blockingWarning) {
    return new Response(`# ${blockingWarning.message}\n`, {
      status: 409,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-UniConf-Error-Code': 'export_not_ready',
        ...subscriptionUserInfoHeaders(exportData.sources),
      },
    })
  }
  const conversionPreflight = await preflightRuleSetConversions(exportData, format, {
    kv: c.env.KV,
    policy: resolveExportRuleSetConversionPolicy(config, settings.ruleSetConversionPolicy),
  })
  if (conversionPreflight.blockingWarning) {
    return new Response(`# ${conversionPreflight.blockingWarning.message}\n`, {
      status: 409,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-UniConf-Error-Code': 'conversion_incomplete',
        ...subscriptionUserInfoHeaders(exportData.sources),
      },
    })
  }
  const rendered = renderExportData(exportData, format, {
    dnsPolicy: await getEffectiveExportDnsPolicy(c.env.DB, format, workspaceId),
    managedRealIpDomains: exportNeedsInlineManagedRealIpDomains(format)
      ? await getManagedRealIpDomains(c.env.KV)
      : undefined,
    ruleSetConversionBaseUrl: buildRuleSetConversionBaseUrl(c.req.url, token),
  })
  if (!rendered) {
    return new Response(`# Unknown format: ${filename}\n`, {
      status: 400,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-UniConf-Error-Code': 'subscription_format_invalid',
      },
    })
  }
  const artifactValidation = validateRenderedExport(format, rendered.content)
  if (!artifactValidation.valid) {
    return new Response('# Generated subscription failed structural validation\n', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-UniConf-Error-Code': 'artifact_invalid',
        ...subscriptionUserInfoHeaders(exportData.sources),
      },
    })
  }

  const etag = await buildContentEtag(rendered.content)
  const responseHeaders = {
    'Content-Type': rendered.contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    ETag: etag,
    ...subscriptionUserInfoHeaders(exportData.sources),
    'X-UniConf-Capability-Profile': serializeExportCapabilityProfile(format),
  }
  if (requestMatchesEtag(c.req.raw, etag)) {
    return new Response(null, { status: 304, headers: responseHeaders })
  }
  return new Response(rendered.content, { headers: responseHeaders })
})

export function buildSubscriptionUserInfoHeader(sources: ProxySource[]): string | undefined {
  const summary = sources.reduce(
    (acc, source) => ({
      upload: acc.upload + (source.uploadBytes ?? 0),
      download: acc.download + (source.downloadBytes ?? 0),
      total: acc.total + (source.totalBytes ?? 0),
      expire:
        source.expireTime === undefined
          ? acc.expire
          : acc.expire === undefined
            ? source.expireTime
            : Math.min(acc.expire, source.expireTime),
      hasUpload: acc.hasUpload || source.uploadBytes !== undefined,
      hasDownload: acc.hasDownload || source.downloadBytes !== undefined,
      hasTotal: acc.hasTotal || source.totalBytes !== undefined,
      hasExpire: acc.hasExpire || source.expireTime !== undefined,
    }),
    {
      upload: 0,
      download: 0,
      total: 0,
      expire: undefined as number | undefined,
      hasUpload: false,
      hasDownload: false,
      hasTotal: false,
      hasExpire: false,
    },
  )

  const fields: string[] = []
  if (summary.hasUpload) fields.push(`upload=${summary.upload}`)
  if (summary.hasDownload) fields.push(`download=${summary.download}`)
  if (summary.hasTotal) fields.push(`total=${summary.total}`)
  if (summary.hasExpire && summary.expire !== undefined) fields.push(`expire=${summary.expire}`)
  return fields.length > 0 ? fields.join('; ') : undefined
}

function subscriptionUserInfoHeaders(sources: ProxySource[]): Record<string, string> {
  const value = buildSubscriptionUserInfoHeader(sources)
  return value ? { 'Subscription-Userinfo': value } : {}
}

export function buildRuleSetConversionBaseUrl(requestUrl: string, token: string): string {
  return `${new URL(requestUrl).origin}/sub/${encodeURIComponent(token)}/rules`
}

function convertedRuleSetError(message: string, status: 400 | 404 | 409 | 413 | 422 | 502, code: string): Response {
  return new Response(`# ${message}\n`, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-UniConf-Error-Code': code,
    },
  })
}

function detectSubscriptionFormat(userAgent: string): ExportFormat | null {
  // Specific clients can also mention their underlying Clash core.
  const clients: [RegExp, ExportFormat][] = [
    [/\bstash\b/i, 'stash'],
    [/\begern\b/i, 'egern'],
    [/\bshadowrocket\b/i, 'shadowrocket'],
    [/\bquantumult(?:[\s_-]|%20)*x\b/i, 'quantumultx'],
    [/\bsurge\b/i, 'surge'],
    [/\bloon\b/i, 'loon'],
    [/\bsing[- ]?box\b/i, 'singbox'],
    [/\b(?:mihomo|clash(?:[ ._-]?meta)?)\b/i, 'mihomo'],
  ]
  return clients.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null
}
