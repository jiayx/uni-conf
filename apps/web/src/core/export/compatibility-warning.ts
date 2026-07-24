import type { CompatibilityWarning } from '@uni-conf/types'

export function compatibilityWarningMessage(warning: CompatibilityWarning, language?: string): string {
  return language?.startsWith('zh') ? warning.message : warning.messageEn
}
