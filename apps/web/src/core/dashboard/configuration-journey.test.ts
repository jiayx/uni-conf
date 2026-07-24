import { describe, expect, it } from 'vitest'
import type { DashboardStats } from '@uni-conf/types'
import { deriveDashboardJourney } from './configuration-journey'

const readyStats: DashboardStats = {
  sourceCount: 1,
  nodeCount: 2,
  enabledNodeCount: 2,
  collectionCount: 1,
  groupCount: 4,
  ruleCount: 1,
  exportConfigCount: 1,
  defaultExportEnabled: true,
}

describe('dashboard configuration journey', () => {
  it('makes source input the only current step before usable nodes exist', () => {
    expect(deriveDashboardJourney({
      ...readyStats,
      enabledNodeCount: 0,
    }, 'checking')).toEqual([
      expect.objectContaining({ id: 'input', status: 'current', detail: 'input_needed', to: '/sources' }),
      expect.objectContaining({ id: 'generated', status: 'pending' }),
      expect.objectContaining({ id: 'export', status: 'pending' }),
    ])
  })

  it('points to the exact missing generated resource', () => {
    expect(deriveDashboardJourney({
      ...readyStats,
      collectionCount: 0,
      groupCount: 0,
    }, 'checking')[1]).toMatchObject({
      id: 'generated',
      status: 'current',
      detail: 'collections_missing',
      to: '/collections',
    })
    expect(deriveDashboardJourney({
      ...readyStats,
      exportConfigCount: 0,
    }, 'checking')[1]).toMatchObject({
      detail: 'export_profile_missing',
      to: '/export',
    })
  })

  it('distinguishes paused, blocked, attention, and ready exports', () => {
    expect(deriveDashboardJourney({
      ...readyStats,
      defaultExportEnabled: false,
    }, 'ready')[2]).toMatchObject({ status: 'blocked', detail: 'export_paused', to: '/export' })
    expect(deriveDashboardJourney(readyStats, 'blocked', '/nodes?edit=node-1')[2]).toMatchObject({
      status: 'blocked',
      detail: 'export_blocked',
      to: '/nodes?edit=node-1',
    })
    expect(deriveDashboardJourney(readyStats, 'attention')[2]).toMatchObject({
      status: 'attention',
      detail: 'export_attention',
    })
    expect(
      deriveDashboardJourney(readyStats, 'attention', undefined, '/preview?format=singbox')[2],
    ).toMatchObject({
      to: '/preview?format=singbox',
    })
    expect(deriveDashboardJourney(readyStats, 'ready')[2]).toMatchObject({
      status: 'complete',
      detail: 'export_ready',
    })
  })
})
