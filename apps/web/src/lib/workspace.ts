export const DEFAULT_WORKSPACE_ID = 'default'
const STORAGE_KEY = 'uniconf.workspaceId'

export function getActiveWorkspaceId(): string {
  return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_WORKSPACE_ID
}

export function setActiveWorkspaceId(id: string): void {
  window.localStorage.setItem(STORAGE_KEY, id)
}

export function clearActiveWorkspaceId(): void {
  window.localStorage.removeItem(STORAGE_KEY)
}
