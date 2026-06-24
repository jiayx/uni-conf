import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreDefaultData } from './data'
import { ensureDefaultExportConfig } from '../services/default-export-config'
import { ensureDefaultRemoteRuleSets } from '../services/default-rule-sets'
import { syncAutoNodeGroups } from '../services/auto-node-groups'

vi.mock('../services/default-export-config', () => ({
  ensureDefaultExportConfig: vi.fn(),
}))

vi.mock('../services/default-rule-sets', () => ({
  ensureDefaultRemoteRuleSets: vi.fn(),
}))

vi.mock('../services/auto-node-groups', () => ({
  syncAutoNodeGroups: vi.fn(),
}))

describe('data reset defaults', () => {
  beforeEach(() => {
    vi.mocked(ensureDefaultExportConfig).mockReset()
    vi.mocked(ensureDefaultRemoteRuleSets).mockReset()
    vi.mocked(syncAutoNodeGroups).mockReset()
  })

  it('restores export config, automatic node groups, and remote rule sets after clearing data', async () => {
    const db = {} as D1Database
    const ts = '2026-01-01T00:00:00.000Z'

    await restoreDefaultData(db, ts)

    expect(ensureDefaultExportConfig).toHaveBeenCalledWith(db, ts)
    expect(syncAutoNodeGroups).toHaveBeenCalledWith(db, ts)
    expect(ensureDefaultRemoteRuleSets).toHaveBeenCalledWith(db, ts)
  })
})
