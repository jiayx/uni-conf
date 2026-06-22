import type {
  ProxySource,
  SourceCreateInput,
  SourceCreateResult,
  ProxyNode,
  NodeCollection,
  ProxyGroup,
  ProxyRule,
  RemoteRuleSet,
  ExportConfig,
  SourceRefreshResult,
  ExportResult,
  DashboardStats,
  AppSettings,
  PaginatedResponse,
} from '@uni-conf/types'

const BASE = import.meta.env['VITE_API_URL'] ?? '/api'

// ============================================================
// Core Request Helper
// ============================================================

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  })
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
    normalized[key] = String(value)
  }

  if (params.country && !params.countryCode) {
    normalized['countryCode'] = params.country
  }

  const search = new URLSearchParams(normalized).toString()
  return search ? `?${search}` : ''
}

const nodes = {
  list: async (params?: NodeListParams): Promise<ProxyNode[]> => {
    const result = await get<PaginatedResponse<ProxyNode>>(`/nodes${buildNodeListQuery(params)}`)
    return result.items
  },
  listPage: (params?: NodeListParams): Promise<PaginatedResponse<ProxyNode>> =>
    get(`/nodes${buildNodeListQuery(params)}`),
  get: (id: string): Promise<ProxyNode> => get(`/nodes/${id}`),
  create: (data: NodeCreateInput): Promise<ProxyNode> =>
    post('/nodes', data),
  update: (id: string, data: Partial<ProxyNode>): Promise<ProxyNode> => put(`/nodes/${id}`, data),
  remove: (id: string): Promise<void> => del(`/nodes/${id}`),
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
  createConfig: (data: Omit<ExportConfig, 'id' | 'token' | 'createdAt' | 'updatedAt'>): Promise<ExportConfig> =>
    post('/export/configs', data),
  updateConfig: (id: string, data: Partial<ExportConfig>): Promise<ExportConfig> =>
    put(`/export/configs/${id}`, data),
  deleteConfig: (id: string): Promise<void> => del(`/export/configs/${id}`),
  resetToken: (id: string): Promise<ExportConfig> => post(`/export/configs/${id}/reset-token`),
  previewFormat: (format: string, configId?: string): Promise<ExportResult> =>
    get(`/export/preview/${format}${configId ? `?configId=${configId}` : ''}`),
  downloadFormat: (format: string, configId?: string): Promise<Blob> =>
    fetch(
      `${BASE}/export/download/${format}${configId ? `?configId=${configId}` : ''}`,
      { method: 'GET' }
    ).then(r => r.blob()),
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
  update: (data: Partial<AppSettings>): Promise<AppSettings> => put('/settings', data),
  exportData: (): Promise<Blob> =>
    fetch(`${BASE}/data/export`, { method: 'GET' }).then(r => r.blob()),
  importData: (data: unknown): Promise<void> => post('/data/import', data),
  clearData: (): Promise<void> => del('/data'),
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
}
