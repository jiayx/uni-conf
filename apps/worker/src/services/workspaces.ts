import type { Context } from 'hono'
import { DEFAULT_NODE_POOL_COLLECTION_ID } from '@uni-conf/shared'

export const DEFAULT_WORKSPACE_ID = 'default'
export const WORKSPACE_HEADER = 'X-Workspace-Id'

const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

export function requestWorkspaceId(c: Pick<Context, 'req'>): string {
  return normalizeWorkspaceId(c.req.header(WORKSPACE_HEADER)) ?? DEFAULT_WORKSPACE_ID
}

export function normalizeWorkspaceId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return WORKSPACE_ID_PATTERN.test(normalized) ? normalized : null
}

export function workspaceEntityId(workspaceId: string, baseId: string): string {
  return workspaceId === DEFAULT_WORKSPACE_ID ? baseId : `${workspaceId}:${baseId}`
}

export function workspaceSqlLiteral(workspaceId: string): string {
  const normalized = normalizeWorkspaceId(workspaceId)
  if (!normalized) throw new Error('Invalid workspace id')
  return `'${normalized}'`
}

export function defaultNodePoolId(workspaceId: string): string {
  return workspaceEntityId(workspaceId, DEFAULT_NODE_POOL_COLLECTION_ID)
}

export function defaultExportConfigId(workspaceId: string): string {
  return workspaceEntityId(workspaceId, 'default-mihomo')
}
