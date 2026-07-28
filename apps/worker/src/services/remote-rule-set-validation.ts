import type {
  RemoteRuleSet,
  RemoteRuleSetValidationIssue,
  RemoteRuleSetValidationResult,
} from '@uni-conf/types'
import {
  inspectRuleSetContent,
  type RuleSetContentInspectionError,
} from '@uni-conf/rule-set'
import { parseSafeRemoteHttpUrl, safeRemoteFetch, SafeRemoteUrlError } from './safe-remote-fetch'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const MAX_ISSUES = 5

interface ValidationOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
  checkedAt?: string
}

export async function validateRemoteRuleSetContent(
  ruleSet: Pick<RemoteRuleSet, 'url' | 'format' | 'behavior'>,
  options: ValidationOptions = {}
): Promise<RemoteRuleSetValidationResult> {
  const checkedAt = options.checkedAt ?? new Date().toISOString()
  const base = {
    checkedAt,
    url: ruleSet.url,
    format: ruleSet.format,
    behavior: ruleSet.behavior,
    inspectionMode: 'text' as const,
    byteLength: 0,
    invalidRuleCount: 0,
    issues: [] as RemoteRuleSetValidationIssue[],
  }

  try {
    parseSafeRemoteHttpUrl(ruleSet.url)
  } catch {
    return invalidResult(base, issue('unsafe_url', '规则集地址必须是公开可访问的 HTTP(S) 地址', 'The rule set URL must be a publicly routable HTTP(S) address.'))
  }

  let response: Response
  try {
    response = await fetchRuleSet(
      options.fetcher ?? fetch,
      ruleSet.url,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
  } catch (error) {
    if (error instanceof SafeRemoteUrlError) {
      return invalidResult(base, issue('unsafe_url', '规则集重定向到了不安全的地址', 'The rule set redirected to an unsafe address.'))
    }
    return invalidResult(base, issue('download_failed', '规则集下载失败或超时', 'The rule set download failed or timed out.'))
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || undefined
  if (!response.ok) {
    return invalidResult({ ...base, httpStatus: response.status, contentType }, issue(
      'http_error',
      `规则集服务器返回 HTTP ${response.status}`,
      `The rule set server returned HTTP ${response.status}.`
    ))
  }

  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (declaredLength > maxBytes) {
    return invalidResult({ ...base, httpStatus: response.status, contentType }, issue(
      'content_too_large',
      `规则集超过 ${formatBytes(maxBytes)} 大小限制`,
      `The rule set exceeds the ${formatBytes(maxBytes)} size limit.`
    ))
  }

  const body = await readLimitedBody(response, maxBytes)
  if (!body) {
    return invalidResult({ ...base, httpStatus: response.status, contentType }, issue(
      'content_too_large',
      `规则集超过 ${formatBytes(maxBytes)} 大小限制`,
      `The rule set exceeds the ${formatBytes(maxBytes)} size limit.`
    ))
  }

  const withResponse = { ...base, httpStatus: response.status, contentType, byteLength: body.byteLength }
  if (body.byteLength === 0) {
    return invalidResult(withResponse, issue('empty_content', '规则集内容为空', 'The rule set is empty.'))
  }

  const inspected = inspectRuleSetContent(body, {
    format: ruleSet.format,
    behavior: ruleSet.behavior,
    contentType,
  })
  if (inspected.error) {
    return invalidResult(
      { ...withResponse, inspectionMode: inspected.mode },
      contentInspectionError(inspected.error, inspected.detected.format),
    )
  }

  if (inspected.rules.length === 0) {
    const container = inspected.detected.encoding === 'mrs'
      ? 'MRS'
      : inspected.detected.encoding === 'srs'
        ? 'SRS'
        : null
    return invalidResult(
      { ...withResponse, inspectionMode: inspected.mode },
      issue(
        'no_rules',
        container ? `${container} 中没有找到可用规则` : '没有找到可用规则',
        container ? `No usable rules were found in the ${container} file.` : 'No usable rules were found.',
      ),
    )
  }

  const invalid = mapInspectionIssues(inspected.issues, ruleSet.behavior)
  const issues = invalid.slice(0, MAX_ISSUES)
  return {
    ...withResponse,
    status: invalid.length > 0 ? 'warning' : 'valid',
    inspectionMode: inspected.mode,
    ruleCount: inspected.rules.length,
    invalidRuleCount: invalid.length,
    issues,
  }
}

function contentInspectionError(
  error: RuleSetContentInspectionError,
  format: RemoteRuleSet['format']
): RemoteRuleSetValidationIssue {
  if (error === 'invalid_behavior') {
    return issue(
      'invalid_behavior',
      'MRS 只支持 domain 和 ipcidr 内容类型',
      'MRS only supports domain and ipcidr behaviors.',
    )
  }
  if (error === 'invalid_mrs') {
    return issue(
      'invalid_mrs',
      'MRS 文件损坏、版本不受支持或内容类型不匹配',
      'The MRS file is corrupt, unsupported, or has a mismatched behavior.',
    )
  }
  if (error === 'invalid_srs') {
    return issue(
      'invalid_srs',
      'SRS 文件损坏或版本不受支持',
      'The SRS file is corrupt or uses an unsupported version.',
    )
  }
  if (error === 'invalid_encoding') {
    return issue(
      'invalid_encoding',
      '规则集不是有效的 UTF-8 文本',
      'The rule set is not valid UTF-8 text.',
    )
  }
  if (error === 'html_response') {
    return issue(
      'html_response',
      '规则集地址返回了 HTML 页面，而不是规则内容',
      'The rule set URL returned an HTML page instead of rule content.',
    )
  }
  if (error === 'invalid_json') {
    return issue(
      'invalid_json',
      'sing-box 规则集不是有效的 JSON 或 SRS 文件',
      'The sing-box rule set is neither valid JSON nor an SRS file.',
    )
  }
  if (error === 'invalid_yaml') {
    return format === 'egern'
      ? issue('invalid_yaml', 'Egern 规则集不是有效的 YAML', 'The Egern rule set is not valid YAML.')
      : issue('invalid_yaml', '规则集不是有效的 YAML', 'The rule set is not valid YAML.')
  }
  if (format === 'egern') {
    return issue(
      'invalid_structure',
      'Egern YAML 中缺少受支持的规则集数组',
      'The Egern YAML document does not contain supported rule-set arrays.',
    )
  }
  if (format === 'singbox') {
    return issue(
      'invalid_structure',
      'JSON 中缺少 rules 数组',
      'The JSON document does not contain a rules array.',
    )
  }
  return issue(
    'invalid_structure',
    'YAML 中缺少规则数组',
    'The YAML document does not contain a rule array.',
  )
}

function mapInspectionIssues(
  issues: Array<{ code: 'invalid_rule'; line: number }>,
  behavior: RemoteRuleSet['behavior']
): RemoteRuleSetValidationIssue[] {
  return issues.map(({ line }) => issue(
    'invalid_rule',
    `第 ${line} 条规则与 ${behavior} 内容类型不匹配`,
    `Rule ${line} does not match the ${behavior} behavior.`,
    'warning',
    line,
  ))
}

async function fetchRuleSet(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  return safeRemoteFetch(fetcher, url, {
    method: 'GET',
    headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain, */*' },
  }, { timeoutMs })
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function invalidResult<T extends Omit<RemoteRuleSetValidationResult, 'status' | 'issues' | 'invalidRuleCount'>>(
  base: T,
  validationIssue: RemoteRuleSetValidationIssue
): RemoteRuleSetValidationResult {
  return { ...base, status: 'invalid', invalidRuleCount: 0, issues: [validationIssue] }
}

function issue(
  code: string,
  message: string,
  messageEn: string,
  severity: RemoteRuleSetValidationIssue['severity'] = 'error',
  line?: number
): RemoteRuleSetValidationIssue {
  return { code, severity, message, messageEn, ...(line === undefined ? {} : { line }) }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MiB` : `${Math.round(bytes / 1024)} KiB`
}
