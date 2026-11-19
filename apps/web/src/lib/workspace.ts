export const DEFAULT_WORKSPACE_ID = 'default'
const STORAGE_KEY = 'uniconf.workspaceId'

export function getActiveWorkspaceId(): string {
  return window.sessionStorage.getItem(STORAGE_KEY) || DEFAULT_WORKSPACE_ID
}

export function setActiveWorkspaceId(id: string): void {
  window.sessionStorage.setItem(STORAGE_KEY, id)
}
