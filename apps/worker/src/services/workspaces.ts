import { HTTPException } from 'hono/http-exception'
import type { Context } from 'hono'
import { DEFAULT_NODE_POOL_COLLECTION_ID } from '@uni-conf/shared'

export const DEFAULT_WORKSPACE_ID = 'default'
const WORKSPACE_HEADER = 'X-Workspace-Id'

const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/

export function requestWorkspaceId(c: Pick<Context, 'req'>): string {
  const value = c.req.header(WORKSPACE_HEADER)
  if (value === undefined) return DEFAULT_WORKSPACE_ID
  const workspaceId = normalizeWorkspaceId(value)
  if (!workspaceId) throw new HTTPException(400, { message: 'Invalid X-Workspace-Id' })
  return workspaceId
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
