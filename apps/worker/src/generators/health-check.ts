import { DEFAULT_HEALTH_CHECK } from '@uni-conf/shared'

export const HTTPS_HEALTH_CHECK_URL = 'https://www.gstatic.com/generate_204'

/** Upgrade persisted defaults as well as new groups; preserve custom endpoints. */
export function healthCheckUrl(value?: unknown): string {
  if (value == null || value === DEFAULT_HEALTH_CHECK.testUrl) return HTTPS_HEALTH_CHECK_URL
  return String(value)
}
