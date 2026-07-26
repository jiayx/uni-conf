export const SETUP_GUIDE_OPEN_EVENT = 'uni-conf:setup-guide-open'
export const DASHBOARD_DATA_CHANGED_EVENT = 'uni-conf:dashboard-data-changed'

export function openSetupGuide(): void {
  window.dispatchEvent(new Event(SETUP_GUIDE_OPEN_EVENT))
}

export function notifyDashboardDataChanged(): void {
  window.dispatchEvent(new Event(DASHBOARD_DATA_CHANGED_EVENT))
}
