const SYSTEM_DISABLED_MISSING_TARGET_NOTE = '[uni-conf:auto-disabled:missing-target]'

export function isSystemDisabledRemoteRuleSet(notes?: string | null): boolean {
  return Boolean(notes?.includes(SYSTEM_DISABLED_MISSING_TARGET_NOTE))
}

export function visibleRemoteRuleSetNotes(notes?: string | null): string {
  return (notes ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && line !== SYSTEM_DISABLED_MISSING_TARGET_NOTE)
    .join('\n')
}

