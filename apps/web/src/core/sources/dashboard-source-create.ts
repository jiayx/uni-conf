import type { SourceCreateResult } from '@uni-conf/types'

export interface DashboardSourceCreateSummary {
  nextInput: string
  error?: {
    kind: 'save-failed' | 'refresh-failed'
    count?: number
    message: string
  }
}

export function summarizeDashboardSourceCreateResults(
  urls: readonly string[],
  results: readonly PromiseSettledResult<SourceCreateResult>[]
): DashboardSourceCreateSummary {
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  const failedUrls = results.flatMap((result, index) => result.status === 'rejected' && urls[index] ? [urls[index]] : [])

  if (failures.length > 0) {
    return {
      nextInput: failedUrls.join('\n'),
      error: {
        kind: 'save-failed',
        count: failures.length,
        message: failures[0]?.reason instanceof Error ? failures[0].reason.message : 'unknown error',
      },
    }
  }

  const successes = results
    .filter((result): result is PromiseFulfilledResult<SourceCreateResult> => result.status === 'fulfilled')
    .map(result => result.value)
  const refreshFailure = successes.find(result => result.refreshError)

  return {
    nextInput: '',
    error: refreshFailure?.refreshError
      ? { kind: 'refresh-failed', message: refreshFailure.refreshError }
      : undefined,
  }
}
