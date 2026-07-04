import type {
  ProxySource,
  SourceCreateInput,
  SourceCreateResult,
  SourceImportInput,
  ProxyNode,
  NodeCollection,
  ProxyGroup,
  ProxyRule,
  RemoteRuleSet,
  ExportConfig,
  ExportFormat,
  SourceRefreshResult,
  ExportResult,
  DashboardStats,
  AppSettings,
  AppSettingsPatch,
  PaginatedResponse,
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
  const json = (await res.json()) as { success: boolean; data?: T; error?: string }
  if (!res.ok || !json.success) throw new Error(json.error ?? 'Request failed')
  return json.data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body)
const del = <T>(path: string) => request<T>('DELETE', path)

// ============================================================
// Sources API
// ============================================================

const sources = {
  list: (): Promise<ProxySource[]> => get('/sources'),
  get: (id: string): Promise<ProxySource> => get(`/sources/${id}`),
  create: (data: SourceCreateInput): Promise<SourceCreateResult> =>
    post('/sources', data),
  import: (data: SourceImportInput): Promise<SourceCreateResult> =>
    post('/sources/import', data),
  update: (id: string, data: Partial<ProxySource>): Promise<ProxySource> => put(`/sources/${id}`, data),
  remove: (id: string): Promise<void> => del(`/sources/${id}`),
  refresh: (id: string): Promise<SourceRefreshResult> => post(`/sources/${id}/refresh`),
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
  get: (id: string): Promise<ProxyNode> => get(`/nodes/${id}`),
  create: (data: NodeCreateInput): Promise<ProxyNode> =>
    post('/nodes', data),
  update: (id: string, data: Partial<ProxyNode>): Promise<ProxyNode> => put(`/nodes/${id}`, data),
  remove: (id: string): Promise<void> => del(`/nodes/${id}`),
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
  get: (id: string): Promise<NodeCollection> => get(`/collections/${id}`),
  create: (data: Omit<NodeCollection, 'id' | 'createdAt' | 'updatedAt'>): Promise<NodeCollection> =>
    post('/collections', data),
  update: (id: string, data: Partial<NodeCollection>): Promise<NodeCollection> =>
    put(`/collections/${id}`, data),
  remove: (id: string): Promise<void> => del(`/collections/${id}`),
  preview: async (id: string): Promise<ProxyNode[]> => {
    const result = await get<{ collectionId: string; nodes: ProxyNode[]; total: number }>(`/collections/${id}/preview`)
    return result.nodes
  },
}

// ============================================================
// Groups API
// ============================================================

const groups = {
  list: (): Promise<ProxyGroup[]> => get('/groups'),
  get: (id: string): Promise<ProxyGroup> => get(`/groups/${id}`),
  create: (data: Omit<ProxyGroup, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProxyGroup> =>
    post('/groups', data),
  update: (id: string, data: Partial<ProxyGroup>): Promise<ProxyGroup> => put(`/groups/${id}`, data),
  remove: (id: string): Promise<void> => del(`/groups/${id}`),
  reorder: (orderedIds: string[]): Promise<ProxyGroup[]> => post('/groups/reorder', { ids: orderedIds }),
}

// ============================================================
// Rules API
// ============================================================

const rules = {
  list: (): Promise<ProxyRule[]> => get('/rules'),
  get: (id: string): Promise<ProxyRule> => get(`/rules/${id}`),
  create: (data: Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProxyRule> =>
    post('/rules', data),
  update: (id: string, data: Partial<ProxyRule>): Promise<ProxyRule> => put(`/rules/${id}`, data),
  remove: (id: string): Promise<void> => del(`/rules/${id}`),
  reorder: (orderedIds: string[]): Promise<ProxyRule[]> => post('/rules/reorder', { ids: orderedIds }),
  batchCreate: (data: Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<ProxyRule[]> =>
    post('/rules/batch', { rules: data }),
}

// ============================================================
// Remote Rule Sets API
// ============================================================

const remoteRuleSets = {
  list: (): Promise<RemoteRuleSet[]> => get('/remote-rule-sets'),
  get: (id: string): Promise<RemoteRuleSet> => get(`/remote-rule-sets/${id}`),
  create: (data: Omit<RemoteRuleSet, 'id' | 'createdAt' | 'updatedAt'>): Promise<RemoteRuleSet> =>
    post('/remote-rule-sets', data),
  batchCreate: (data: Omit<RemoteRuleSet, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<RemoteRuleSet[]> =>
    post('/remote-rule-sets/batch', { sets: data }),
  update: (id: string, data: Partial<RemoteRuleSet>): Promise<RemoteRuleSet> =>
    put(`/remote-rule-sets/${id}`, data),
  remove: (id: string): Promise<void> => del(`/remote-rule-sets/${id}`),
}

// ============================================================
// Export API
// ============================================================

const exportApi = {
  listConfigs: (): Promise<ExportConfig[]> => get('/export/configs'),
  getConfig: (id: string): Promise<ExportConfig> => get(`/export/configs/${id}`),
  createConfig: (data: ExportConfigCreateInput): Promise<ExportConfig> =>
    post('/export/configs', data),
  updateConfig: (id: string, data: Partial<ExportConfig>): Promise<ExportConfig> =>
    put(`/export/configs/${id}`, data),
  deleteConfig: (id: string): Promise<void> => del(`/export/configs/${id}`),
  resetToken: (id: string): Promise<ExportConfig> => post(`/export/configs/${id}/reset-token`),
  previewFormat: (format: string, configId?: string): Promise<ExportResult> =>
    get(`/export/preview/${format}${configId ? `?configId=${configId}` : ''}`),
  downloadFormat: async (format: ExportFormat, configId?: string): Promise<ExportDownloadFile> => {
    const res = await fetch(
      `${BASE}/export/download/${format}${configId ? `?configId=${configId}` : ''}`,
      { method: 'GET', headers: authHeaders() }
    )
    if (res.status === 401) throw new UnauthorizedError()
    if (!res.ok) throw new Error(await readDownloadError(res))
    const fallback = getExportSubscriptionFilename(format as ExportSubscriptionFormat)
    return {
      blob: await res.blob(),
      filename: parseContentDispositionFilename(res.headers.get('content-disposition'), fallback),
    }
  },
}

async function readDownloadError(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      const json = await res.json() as { error?: string }
      if (json.error) return json.error
    } catch {
      return 'Download failed'
    }
  }

  const text = await res.text()
  return text.replace(/^#\s*/, '').trim() || 'Download failed'
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
    const res = await fetch(`${BASE}/data/export`, { method: 'GET', headers: authHeaders() })
    if (res.status === 401) throw new UnauthorizedError()
    return res.blob()
  },
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
