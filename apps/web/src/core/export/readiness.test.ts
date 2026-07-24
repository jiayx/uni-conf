import { describe, expect, it } from 'vitest'
import { deriveExportReadiness } from './readiness'
import type { CompatibilityWarning, ExportResult } from '@uni-conf/types'

describe('export readiness', () => {
  it('marks a non-empty, structurally valid artifact without warnings as ready', () => {
    expect(deriveExportReadiness(result())).toMatchObject({ status: 'ready', structureValid: true })
  })

  it('keeps partial and conversion notices usable but visible', () => {
    expect(deriveExportReadiness(result([warning('partial'), warning('convert')]))).toMatchObject({
      status: 'attention',
      summary: { unsupported: 0, partial: 1, convert: 1, total: 2 },
    })
  })

  it('blocks unsupported warnings, invalid structure, and empty artifacts', () => {
    expect(deriveExportReadiness(result([warning('unsupported')], true, false)).status).toBe('blocked')
    expect(deriveExportReadiness(result([], false)).status).toBe('blocked')
    expect(deriveExportReadiness({ ...result(), readiness: { ready: false, blockingWarnings: [] } }).status).toBe('blocked')
  })

  it('does not confuse a non-blocking unsupported diagnostic with download readiness', () => {
    expect(deriveExportReadiness(result([warning('unsupported')], true, true))).toMatchObject({
      status: 'attention',
      summary: { unsupported: 1 },
    })
  })
})

function result(warnings: CompatibilityWarning[] = [], valid = true, ready = valid): ExportResult {
  return {
    format: 'mihomo', content: 'proxies: []', contentType: 'text/yaml', warnings,
    capabilityProfile: { id: 'uni-conf-exporter', revision: 1, format: 'mihomo' },
    artifactValidation: { format: 'mihomo', kind: 'yaml', valid, issues: [] },
    readiness: { ready, blockingWarnings: ready ? [] : warnings },
  }
}

function warning(level: CompatibilityWarning['level']): CompatibilityWarning {
  return { client: 'mihomo', level, message: level, messageEn: level }
}
