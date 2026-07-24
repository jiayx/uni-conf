import type { CompatibilityWarning, CompatibilityWarningRemediation } from '@uni-conf/types'

export interface CompatibilityRemediationAction {
  to: string
  labelKey: string
}

export function compatibilityRemediationAction(
  warning: CompatibilityWarning,
): CompatibilityRemediationAction | null {
  return remediationAction(warning.remediation)
}

export function remediationAction(
  remediation: CompatibilityWarningRemediation | undefined,
): CompatibilityRemediationAction | null {
  if (!remediation) return null

  if (remediation.target === 'settings') {
    return {
      to: `/settings#${remediation.section}`,
      labelKey: 'preview.fix_settings',
    }
  }

  const edit = remediation.id ? `edit=${encodeURIComponent(remediation.id)}` : ''
  const sourceOverride = remediation.target === 'remote-rule-sets' && remediation.sourceOverrideTarget
    ? `nativeSource=${encodeURIComponent(remediation.sourceOverrideTarget)}`
    : ''
  const query = [edit, sourceOverride].filter(Boolean).join('&')
  return {
    to: `/${remediation.target}${query ? `?${query}` : ''}`,
    labelKey: `preview.fix_${remediation.target.replaceAll('-', '_')}`,
  }
}
