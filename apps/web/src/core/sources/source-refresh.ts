import type { ProxySource, SourceFormat } from '@uni-conf/types'

export interface SourceRefreshRelevantUpdate {
  url?: string
  format?: SourceFormat
  userAgent?: string
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

export function shouldRefreshSourceAfterUpdate(
  source: ProxySource,
  update: SourceRefreshRelevantUpdate
): boolean {
  if (source.type !== 'url') {
    return false
  }

  if ('url' in update && normalizeOptionalText(update.url) !== normalizeOptionalText(source.url)) {
    return true
  }

  if ('format' in update && update.format !== source.format) {
    return true
  }

  if (
    'userAgent' in update
    && normalizeOptionalText(update.userAgent) !== normalizeOptionalText(source.userAgent)
  ) {
    return true
  }

  return false
}
