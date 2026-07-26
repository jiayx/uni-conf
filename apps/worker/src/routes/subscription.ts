import { Hono } from 'hono'
import { buildExportData, getEnabledExportConfigByToken } from '../export-data'
import { renderExportData } from '../generators/export-renderer'
import { getAppSettings } from '../services/app-settings'
import { findBlockingExportWarning } from '../services/export-validation'
import { validateRenderedExport } from '../services/export-artifact-validation'
import type { Env } from '../types'
import {
  getExportFormatFromSubscriptionFilename,
  isFullConfigExportFormat,
  serializeExportCapabilityProfile,
} from '@uni-conf/shared'
import type { ExportFormat, ProxySource } from '@uni-conf/types'
import { getConvertedRemoteRuleSet, preflightRuleSetConversions, resolveRuleSetConversionSource, RuleSetConversionError } from '../services/rule-set-conversion'
import { resolveExportRuleSetConversionPolicy } from '../services/export-conversion-policy'

export const subscriptionRouter = new Hono<{ Bindings: Env }>()

// GET /sub/:token/rules/:ruleSetId/:filename
// Token-scoped conversion endpoint used when the source and target clients use
// different rule-set containers. It never silently broadens compound rules.
subscriptionRouter.get('/sub/:token/rules/:ruleSetId/:filename', async (c) => {
  const token = c.req.param('token')
  const target = c.req.param('filename') === 'singbox.json'
    ? 'singbox'
    : c.req.param('filename') === 'mihomo.yaml'
      ? 'mihomo'
      : c.req.param('filename') === 'egern.yaml'
        ? 'egern'
      : parseTextConversionTarget(c.req.param('filename'))
  if (!target) return convertedRuleSetError('Unknown conversion target', 400, 'conversion_target_invalid')

  const config = await getEnabledExportConfigByToken(c.env.DB, token)
  if (!config) return convertedRuleSetError('Subscription not found or disabled', 404, 'subscription_unavailable')
  const settings = await getAppSettings(c.env.DB)
  const conversionPolicy = resolveExportRuleSetConversionPolicy(
    config,
    settings.ruleSetConversionPolicy,
  )
  const requestedExportFormat = c.req.query('for')
  const exportFormat = requestedExportFormat === undefined
    ? target
    : isRuleSetConversionExportFormat(requestedExportFormat)
      ? requestedExportFormat
      : null
  if (!exportFormat) {
    return convertedRuleSetError('Unknown export format context', 400, 'conversion_export_format_invalid')
  }
  const exportData = await buildExportData(c.env.DB, config, exportFormat)
  const ruleSet = exportData.remoteSets.find((item) => item.id === c.req.param('ruleSetId') && item.enabled)
  if (!ruleSet) return convertedRuleSetError('Rule set is not included in this subscription', 404, 'rule_set_out_of_scope')
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
    return convertedRuleSetError('Rule set cannot be converted without changing its meaning', 422, 'conversion_invalid_content')
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
    ? value as 'surge' | 'loon' | 'shadowrocket' | 'quantumultx'
    : null
}

function isRuleSetConversionExportFormat(value: string): value is Exclude<ExportFormat, 'nodes_base64' | 'nodes_raw'> {
  return isFullConfigExportFormat(value)
}

// GET /sub/:token/:filename
// Public subscription endpoint — no auth required
subscriptionRouter.get('/sub/:token/:filename', async (c) => {
  const token = c.req.param('token')
  const filename = c.req.param('filename')
  const format = getExportFormatFromSubscriptionFilename(filename)
  if (!format) {
    return new Response(`# Unknown format: ${filename}\n`, {
      status: 400,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-UniConf-Error-Code': 'subscription_format_invalid',
      },
    })
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

  const exportData = await buildExportData(c.env.DB, config, format)
  const settings = await getAppSettings(c.env.DB)
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
    dnsMode: config.dnsMode,
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

  return new Response(rendered.content, {
    headers: {
      'Content-Type': rendered.contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...subscriptionUserInfoHeaders(exportData.sources),
      'X-UniConf-Capability-Profile': serializeExportCapabilityProfile(format),
    },
  })
})

export function buildSubscriptionUserInfoHeader(sources: ProxySource[]): string | undefined {
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
    }
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

function convertedRuleSetError(
  message: string,
  status: 400 | 404 | 409 | 413 | 422 | 502,
  code: string
): Response {
  return new Response(`# ${message}\n`, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-UniConf-Error-Code': code,
    },
  })
}
