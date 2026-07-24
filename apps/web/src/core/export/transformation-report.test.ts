import { describe, expect, it } from 'vitest'
import type { CompatibilityTransformation, CompatibilityWarning } from '@uni-conf/types'
import {
  filterTransformationWarnings,
  summarizeTransformations,
} from './transformation-report'

describe('export transformation report', () => {
  it('separates safe changes, skipped entries, and blockers', () => {
    const warnings = [
      warning({ resource: 'rule', action: 'convert', source: 'PORT,443', target: 'DST-PORT,443' }),
      warning({ resource: 'rule', action: 'omit-option', source: 'IP-CIDR,x,no-resolve', target: 'IP-CIDR,x' }),
      warning({ resource: 'rule', action: 'skip', source: 'SCRIPT,x' }),
      warning({ resource: 'remote-rule-set', action: 'block', source: 'Set (mihomo)', target: 'Set (singbox)' }),
      {
        client: 'mihomo',
        level: 'partial',
        message: 'health warning',
        messageEn: 'health warning',
      },
    ] satisfies CompatibilityWarning[]

    expect(summarizeTransformations(warnings)).toEqual({
      total: 4,
      changed: 2,
      skipped: 1,
      blocked: 1,
    })
    expect(filterTransformationWarnings(warnings, 'changed')).toHaveLength(2)
    expect(filterTransformationWarnings(warnings, 'skipped')).toHaveLength(1)
    expect(filterTransformationWarnings(warnings, 'blocked')).toHaveLength(1)
  })
})

function warning(transformation: CompatibilityTransformation): CompatibilityWarning {
  return {
    client: 'mihomo',
    level: transformation.action === 'convert' ? 'convert' : 'partial',
    message: transformation.source,
    messageEn: transformation.source,
    transformation,
  }
}
