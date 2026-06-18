import type {
  ProxySource,
  ProxyNode,
  NodeCollection,
  ProxyGroup,
  ProxyRule,
  RuleTemplate,
  ExportConfig,
  SourceRefreshResult,
  ExportResult,
  DashboardStats,
  AppSettings,
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
const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body)
const del = <T>(path: string) => request<T>('DELETE', path)

// ============================================================
// Sources API
// ============================================================

const sources = {
  list: (): Promise<ProxySource[]> => get('/sources'),
  get: (id: string): Promise<ProxySource> => get(`/sources/${id}`),
  create: (data: Omit<ProxySource, 'id' | 'nodeCount' | 'createdAt' | 'updatedAt'>): Promise<ProxySource> =>
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
  enabled?: boolean
  search?: string
  page?: number
  pageSize?: number
}

const nodes = {
  list: (params?: NodeListParams): Promise<ProxyNode[]> => {
    const query = params ? '?' + new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)])
      )
    ).toString() : ''
    return get(`/nodes${query}`)
  },
  get: (id: string): Promise<ProxyNode> => get(`/nodes/${id}`),
  create: (data: Omit<ProxyNode, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProxyNode> =>
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
  preview: (id: string): Promise<ProxyNode[]> => get(`/collections/${id}/preview`),
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
  reorder: (orderedIds: string[]): Promise<void> => patch('/groups/reorder', { orderedIds }),
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
  reorder: (orderedIds: string[]): Promise<void> => patch('/rules/reorder', { orderedIds }),
  batchCreate: (data: Omit<ProxyRule, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<ProxyRule[]> =>
    post('/rules/batch', data),
}

// ============================================================
// Templates API
// ============================================================

const templates = {
  list: (): Promise<RuleTemplate[]> => get('/templates'),
  get: (id: string): Promise<RuleTemplate> => get(`/templates/${id}`),
  importTemplate: (id: string, targetGroupId: string): Promise<{ imported: number }> =>
    post(`/templates/${id}/import`, { targetGroupId }),
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
  templates,
  export: exportApi,
  dashboard,
  settings: settingsApi,
}
