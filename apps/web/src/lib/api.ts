import type {
  ProxySource,
  SourceCreateInput,
  SourceCreateResult,
  SourceImportInput,
  SourceImportPreview,
  SourceImportRun,
  SourceNodeRetryResult,
  SourceStructuredRetryResult,
  ProxyNode,
  NodeCollection,
  ProxyGroup,
  ProxyRule,
  RemoteRuleSet,
  RemoteRuleSetValidationResult,
  RemoteRuleSetSourceValidationInput,
  RemoteRuleSetSourceValidationBatchResult,
  RemoteRuleSetSourceHealthResult,
  RemoteRuleSetPendingHealthBatchResult,
  RemoteRuleSetConversionPreview,
  ExportConfig,
  ExportFormat,
  SourceRefreshResult,
  ExportResult,
  ExportReadinessResult,
  DashboardStats,
  AppSettings,
  AppSettingsPatch,
  PaginatedResponse,
  ApiErrorDetails,
} from '@uni-conf/types'
import { parseContentDispositionFilename, type ExportDownloadFile } from '@/core/export/download-file'
import { getExportSubscriptionFilename, MAX_NODE_SEARCH_LENGTH, type ExportSubscriptionFormat } from '@uni-conf/shared'
import { getStoredApiKey } from './auth'

const BASE = import.meta.env['VITE_API_URL'] ?? '/api'

type ExportConfigCreateInput = Omit<ExportConfig, 'id' | 'token' | 'createdAt' | 'updatedAt' | 'name'> & {
  name?: string
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string,
    public readonly details?: ApiErrorDetails,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ============================================================
// Core Request Helper
// ============================================================

function authHeaders(): Record<string, string> {
  const apiKey = getStoredApiKey()
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) throw new UnauthorizedError()
  let json: {
    success: boolean
    data?: T
    error?: string
    code?: string
    details?: ApiErrorDetails
  }
  try {
    const value: unknown = await res.json()
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || typeof (value as { success?: unknown }).success !== 'boolean'
    ) throw new Error('invalid response')
    json = value as typeof json
  } catch {
    throw new ApiError(
      'The server returned an invalid response',
      res.status,
      res.headers.get('X-UniConf-Error-Code') ?? 'invalid_api_response',
      res.headers.get('X-Request-Id') ?? undefined,
    )
  }
  if (!res.ok || !json.success) {
    throw new ApiError(
      json.error ?? 'Request failed',
      res.status,
      json.code ?? res.headers.get('X-UniConf-Error-Code') ?? undefined,
      res.headers.get('X-Request-Id') ?? undefined,
      json.details,
    )
  }
  return json.data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body)
const del = <T>(path: string) => request<T>('DELETE', path)
const pathSegment = (value: string): string => encodeURIComponent(value)

// ============================================================
// Sources API
// ============================================================

const sources = {
  list: (): Promise<ProxySource[]> => get('/sources'),
  get: (id: string): Promise<ProxySource> => get(`/sources/${pathSegment(id)}`),
  create: (data: SourceCreateInput): Promise<SourceCreateResult> =>
    post('/sources', data),
  import: (data: SourceImportInput): Promise<SourceCreateResult> =>
    post('/sources/import', data),
  previewImport: (data: SourceImportInput): Promise<SourceImportPreview> =>
    post('/sources/import/preview', data),
  listImports: (): Promise<SourceImportRun[]> => get('/sources/imports'),
  previewNodeRetry: (runId: string): Promise<SourceImportPreview> =>
    post(`/sources/imports/${pathSegment(runId)}/nodes/preview`),
  retryNodeImport: (runId: string): Promise<SourceNodeRetryResult> =>
    post(`/sources/imports/${pathSegment(runId)}/nodes/retry`),
  previewStructuredRetry: (runId: string): Promise<SourceImportPreview> =>
    post(`/sources/imports/${pathSegment(runId)}/structured/preview`),
  retryStructuredImport: (
    runId: string,
    structuredConflictResolutions?: SourceImportInput['structuredConflictResolutions'],
  ): Promise<SourceStructuredRetryResult> =>
    post(`/sources/imports/${pathSegment(runId)}/structured/retry`, { structuredConflictResolutions }),
  undoImport: (runId: string): Promise<SourceImportRun> => post(`/sources/imports/${pathSegment(runId)}/undo`),
  update: (id: string, data: Partial<ProxySource>): Promise<ProxySource> => put(`/sources/${pathSegment(id)}`, data),
  remove: (id: string): Promise<void> => del(`/sources/${pathSegment(id)}`),
  refresh: (id: string): Promise<SourceRefreshResult> => post(`/sources/${pathSegment(id)}/refresh`),
}

// ============================================================
// Nodes API
// ============================================================

export interface NodeListParams {
  sourceId?: string
  protocol?: string
  country?: string
  countryCode?: string
  enabled?: boolean
  search?: string
  page?: number
  pageSize?: number
}

export type NodeCreateInput =
  | (Omit<ProxyNode, 'id' | 'createdAt' | 'updatedAt'> & { uri?: never })
  | ({ uri: string } & Partial<Omit<ProxyNode, 'id' | 'createdAt' | 'updatedAt'>>)

export interface NodeBatchEnabledResult {
  ids: string[]
  enabled: boolean
  updatedCount: number
}

export interface RuleBatchEnabledResult {
  ids: string[]
  enabled: boolean
  updatedCount: number
}

function buildNodeListQuery(params?: NodeListParams): string {
  if (!params) return ''

  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value == null || key === 'country') continue
    if (key === 'search') {
      const search = String(value).trim().slice(0, MAX_NODE_SEARCH_LENGTH)
      if (search) normalized[key] = search
      continue
    }
    normalized[key] = String(value)
  }

  if (params.country && !params.countryCode) {
    normalized['countryCode'] = params.country
  }

  const search = new URLSearchParams(normalized).toString()
  return search ? `?${search}` : ''
}

const nodes = {
  listAll: (params?: Omit<NodeListParams, 'page' | 'pageSize'>): Promise<ProxyNode[]> => listAllNodes(params),
  listPage: (params?: NodeListParams): Promise<PaginatedResponse<ProxyNode>> =>
    get(`/nodes${buildNodeListQuery(params)}`),
  get: (id: string): Promise<ProxyNode> => get(`/nodes/${pathSegment(id)}`),
  create: (data: NodeCreateInput): Promise<ProxyNode> =>
    post('/nodes', data),
  update: (id: string, data: Partial<ProxyNode>): Promise<ProxyNode> => put(`/nodes/${pathSegment(id)}`, data),
  setEnabled: (ids: string[], enabled: boolean): Promise<NodeBatchEnabledResult> =>
    put('/nodes/batch-enabled', { ids, enabled }),
  remove: (id: string): Promise<void> => del(`/nodes/${pathSegment(id)}`),
}

async function listAllNodes(params?: Omit<NodeListParams, 'page' | 'pageSize'>): Promise<ProxyNode[]> {
  const pageSize = 200
  const firstPage = await nodes.listPage({ ...params, page: 1, pageSize })
  const items = [...firstPage.items]
  const total = firstPage.total

  for (let page = 2; items.length < total; page += 1) {
    const nextPage = await nodes.listPage({ ...params, page, pageSize })
    if (nextPage.items.length === 0) break
    items.push(...nextPage.items)
  }

  return items
}

// ============================================================
// Collections API
// ============================================================

const collections = {
  list: (): Promise<NodeCollection[]> => get('/collections'),
  get: (id: string): Promise<NodeCollection> => get(`/collections/${pathSegment(id)}`),
  create: (data: Omit<NodeCollection, 'id' | 'createdAt' | 'updatedAt'>): Promise<NodeCollection> =>
    post('/collections', data),
  update: (id: string, data: Partial<NodeCollection>): Promise<NodeCollection> =>
    put(`/collections/${pathSegment(id)}`, data),
  createWithGroup: (
    collection: Omit<NodeCollection, 'id' | 'createdAt' | 'updatedAt'>,
    groupType: Extract<ProxyGroup['type'], 'select' | 'url-test' | 'fallback'>,
  ): Promise<{ collection: NodeCollection; group: ProxyGroup }> =>
    post('/collections/with-group', { collection, groupType }),
  updateWithGroup: (
    id: string,
    collection: Partial<NodeCollection>,
    groupType: Extract<ProxyGroup['type'], 'select' | 'url-test' | 'fallback'>,
  ): Promise<{ collection: NodeCollection; group: ProxyGroup }> =>
    put(`/collections/${pathSegment(id)}/with-group`, { collection, groupType }),
  remove: (id: string): Promise<void> => del(`/collections/${pathSegment(id)}`),
  preview: async (id: string): Promise<ProxyNode[]> => {
    const result = await get<{ collectionId: string; nodes: ProxyNode[]; total: number }>(`/collections/${pathSegment(id)}/preview`)
    return result.nodes
  },
}

// ============================================================
// Groups API
// ============================================================

const groups = {
  list: (): Promise<ProxyGroup[]> => get('/groups'),
  get: (id: string): Promise<ProxyGroup> => get(`/groups/${pathSegment(id)}`),
  create: (data: Omit<ProxyGroup, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProxyGroup> =>
    post('/groups', data),
  update: (id: string, data: Partial<ProxyGroup>): Promise<ProxyGroup> => put(`/groups/${pathSegment(id)}`, data),
  remove: (id: string): Promise<void> => del(`/groups/${pathSegment(id)}`),
  reorder: (orderedIds: string[]): Promise<ProxyGroup[]> => post('/groups/reorder', { ids: orderedIds }),
}

// ============================================================
// Rules API
// ============================================================

const rules = {
  list: (): Promise<ProxyRule[]> => get('/rules'),
  get: (id: string): Promise<ProxyRule> => get(`/rules/${pathSegment(id)}`),
  create: (data: Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProxyRule> =>
    post('/rules', data),
  update: (id: string, data: Partial<ProxyRule>): Promise<ProxyRule> => put(`/rules/${pathSegment(id)}`, data),
  setEnabled: (ids: string[], enabled: boolean): Promise<RuleBatchEnabledResult> =>
    put('/rules/batch-enabled', { ids, enabled }),
  remove: (id: string): Promise<void> => del(`/rules/${pathSegment(id)}`),
  reorder: (orderedIds: string[]): Promise<ProxyRule[]> => post('/rules/reorder', { ids: orderedIds }),
  batchCreate: (data: Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<ProxyRule[]> =>
    post('/rules/batch', { rules: data }),
}

// ============================================================
// Remote Rule Sets API
// ============================================================

const remoteRuleSets = {
  list: (): Promise<RemoteRuleSet[]> => get('/remote-rule-sets'),
  get: (id: string): Promise<RemoteRuleSet> => get(`/remote-rule-sets/${pathSegment(id)}`),
  create: (data: Omit<RemoteRuleSet, 'id' | 'createdAt' | 'updatedAt'>): Promise<RemoteRuleSet> =>
    post('/remote-rule-sets', data),
  batchCreate: (data: Omit<RemoteRuleSet, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<RemoteRuleSet[]> =>
    post('/remote-rule-sets/batch', { sets: data }),
  update: (id: string, data: Partial<RemoteRuleSet>): Promise<RemoteRuleSet> =>
    put(`/remote-rule-sets/${pathSegment(id)}`, data),
  validate: (id: string): Promise<RemoteRuleSetValidationResult> =>
    post(`/remote-rule-sets/${pathSegment(id)}/validate`, {}),
  validateAllSources: (id: string): Promise<RemoteRuleSetSourceHealthResult> =>
    post(`/remote-rule-sets/${pathSegment(id)}/validate-all`, {}),
  validatePendingSources: (): Promise<RemoteRuleSetPendingHealthBatchResult> =>
    post('/remote-rule-sets/validate-pending', {}),
  validateSource: (data: RemoteRuleSetSourceValidationInput): Promise<RemoteRuleSetValidationResult> =>
    post('/remote-rule-sets/validate-source', data),
  validateSources: (sources: RemoteRuleSetSourceValidationInput[]): Promise<RemoteRuleSetSourceValidationBatchResult> =>
    post('/remote-rule-sets/validate-sources', { sources }),
  previewConversion: (id: string, targetFormat: ExportFormat): Promise<RemoteRuleSetConversionPreview> =>
    post(`/remote-rule-sets/${pathSegment(id)}/conversion-preview`, { targetFormat }),
  remove: (id: string): Promise<void> => del(`/remote-rule-sets/${pathSegment(id)}`),
}

// ============================================================
// Export API
// ============================================================

const exportApi = {
  listConfigs: (): Promise<ExportConfig[]> => get('/export/configs'),
  getConfig: (id: string): Promise<ExportConfig> => get(`/export/configs/${pathSegment(id)}`),
  createConfig: (data: ExportConfigCreateInput): Promise<ExportConfig> =>
    post('/export/configs', data),
  updateConfig: (id: string, data: Partial<ExportConfig>): Promise<ExportConfig> =>
    put(`/export/configs/${pathSegment(id)}`, data),
  deleteConfig: (id: string): Promise<void> => del(`/export/configs/${pathSegment(id)}`),
  resetToken: (id: string): Promise<ExportConfig> => post(`/export/configs/${pathSegment(id)}/reset-token`),
  previewFormat: (format: ExportFormat, configId?: string): Promise<ExportResult> =>
    get(exportFormatPath('preview', format, configId)),
  readinessFormat: (format: ExportFormat, configId?: string): Promise<ExportReadinessResult> =>
    get(exportFormatPath('readiness', format, configId)),
  downloadFormat: async (format: ExportFormat, configId?: string): Promise<ExportDownloadFile> => {
    const res = await fetch(
      `${BASE}${exportFormatPath('download', format, configId)}`,
      { method: 'GET', headers: authHeaders() }
    )
    if (res.status === 401) throw new UnauthorizedError()
    if (!res.ok) throw await toDownloadApiError(res)
    const fallback = getExportSubscriptionFilename(format as ExportSubscriptionFormat)
    return {
      blob: await res.blob(),
      filename: parseContentDispositionFilename(res.headers.get('content-disposition'), fallback),
    }
  },
}

function exportFormatPath(
  action: 'preview' | 'readiness' | 'download',
  format: ExportFormat,
  configId?: string,
): string {
  return `/export/${action}/${format}${configId ? `?configId=${encodeURIComponent(configId)}` : ''}`
}

async function toDownloadApiError(res: Response): Promise<ApiError> {
  let message = 'Download failed'
  let responseCode: string | undefined
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const json = await res.json() as { error?: string; code?: string }
      if (json.error) message = json.error
      responseCode = json.code
    } catch {
      // Keep the generic download error.
    }
  } else {
    const text = await res.text()
    message = text.replace(/^#\s*/, '').trim() || message
  }
  return new ApiError(
    message,
    res.status,
    responseCode ?? res.headers.get('X-UniConf-Error-Code') ?? undefined,
    res.headers.get('X-Request-Id') ?? undefined
  )
}

// ============================================================
// Dashboard API
// ============================================================

const dashboard = {
  stats: (): Promise<DashboardStats> => get('/dashboard/stats'),
}

// ============================================================
// Settings API
// ============================================================

const settingsApi = {
  get: (): Promise<AppSettings> => get('/settings'),
  update: (data: AppSettingsPatch): Promise<AppSettings> => put('/settings', data),
  exportData: async (): Promise<Blob> => {
    const res = await fetch(`${BASE}/data/export`, {
      method: 'GET',
      headers: authHeaders(),
      cache: 'no-store',
    })
    if (res.status === 401) throw new UnauthorizedError()
    if (!res.ok) throw await toDownloadApiError(res)
    return res.blob()
  },
  validateImportData: (data: unknown): Promise<{
    version: number
    totalRows: number
    tables: Record<string, number>
    containsSensitiveData: boolean
  }> => post('/data/import/validate', data),
  importData: (data: unknown): Promise<void> => post('/data/import', data),
  clearData: (): Promise<void> => del('/data'),
}

// ============================================================
// Auth API
// ============================================================

const authApi = {
  check: (): Promise<{ ok: boolean }> => get('/auth/check'),
}

// ============================================================
// Exported API object
// ============================================================

export const api = {
  sources,
  nodes,
  collections,
  groups,
  rules,
  remoteRuleSets,
  export: exportApi,
  dashboard,
  settings: settingsApi,
  auth: authApi,
}
