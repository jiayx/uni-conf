import type { ExportFormat } from '@uni-conf/types'

export type ConfigSyntaxLanguage = 'json' | 'yaml' | 'ini'

const MAX_HIGHLIGHT_LENGTH = 512 * 1024

export function getExportSyntaxLanguage(format: ExportFormat): ConfigSyntaxLanguage | null {
  if (format === 'singbox') return 'json'
  if (format === 'mihomo' || format === 'stash' || format === 'egern') {
    return 'yaml'
  }
  if (
    format === 'loon'
    || format === 'surge'
    || format === 'shadowrocket'
    || format === 'quantumultx'
  ) {
    return 'ini'
  }
  return null
}

export async function highlightExportContent(
  content: string,
  format: ExportFormat,
): Promise<string | null> {
  const language = getExportSyntaxLanguage(format)
  if (!language || content.length > MAX_HIGHLIGHT_LENGTH) return null

  const { highlightConfig } = await import('./shiki-config-highlighter')
  return highlightConfig(content, language)
}
