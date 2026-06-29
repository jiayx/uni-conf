import { describe, expect, it } from 'vitest'
import type { SourceCreateResult } from '@uni-conf/types'
import { summarizeDashboardSourceCreateResults } from './dashboard-source-create'

describe('summarizeDashboardSourceCreateResults', () => {
  it('clears the dashboard input when all subscription sources are saved and refreshed', () => {
    expect(summarizeDashboardSourceCreateResults(
      ['https://a.example/sub', 'https://b.example/sub'],
      [fulfilled(), fulfilled()]
    )).toEqual({
      nextInput: '',
      error: undefined,
    })
  })

  it('keeps only failed subscription URLs when part of the batch cannot be saved', () => {
    expect(summarizeDashboardSourceCreateResults(
      ['https://a.example/sub', 'https://b.example/sub', 'https://c.example/sub'],
      [fulfilled(), rejected(new Error('bad token')), rejected('network failed')]
    )).toEqual({
      nextInput: 'https://b.example/sub\nhttps://c.example/sub',
      error: {
        kind: 'save-failed',
        count: 2,
        message: 'bad token',
      },
    })
  })

  it('reports refresh failures without keeping successfully saved URLs in the input', () => {
    expect(summarizeDashboardSourceCreateResults(
      ['https://a.example/sub'],
      [fulfilled({ refreshError: 'No usable proxy nodes parsed' })]
    )).toEqual({
      nextInput: '',
      error: {
        kind: 'refresh-failed',
        message: 'No usable proxy nodes parsed',
      },
    })
  })
})

function fulfilled(patch: Partial<SourceCreateResult> = {}): PromiseFulfilledResult<SourceCreateResult> {
  return {
    status: 'fulfilled',
    value: {
      source: {
        id: 'source-1',
        name: 'Source',
        type: 'url',
        url: 'https://example.com/sub',
        format: 'auto',
        enabled: true,
        nodeCount: 1,
        updateInterval: 0,
        tags: [],
        groups: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      ...patch,
    },
  }
}

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: 'rejected', reason }
}
