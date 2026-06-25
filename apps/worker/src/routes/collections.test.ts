import { describe, expect, it } from 'vitest'
import { validateCollectionWrite } from './collections'

describe('collections route helpers', () => {
  it('normalizes create payloads with defaults', () => {
    expect(validateCollectionWrite({
      name: '  US Pool  ',
      sourceIds: [' source-1 ', 'source-1'],
      filters: [{
        id: ' country ',
        field: 'countryCode',
        operator: 'equals',
        value: ' US ',
        enabled: true,
      }],
      renames: [{
        id: 'strip',
        type: 'strip_emoji',
        enabled: true,
        order: 0,
      }],
    }, { create: true })).toEqual({
      valid: true,
      name: 'US Pool',
      sourceIds: ['source-1'],
      nodeIds: undefined,
      filters: [{
        id: 'country',
        field: 'countryCode',
        operator: 'equals',
        value: 'US',
        enabled: true,
      }],
      renames: [{
        id: 'strip',
        type: 'strip_emoji',
        pattern: undefined,
        replacement: undefined,
        enabled: true,
        order: 0,
      }],
      dedup: 'name',
      sort: 'country',
      sortCountryOrder: undefined,
      enabled: true,
      notes: undefined,
    })
  })

  it('normalizes list filter values', () => {
    expect(validateCollectionWrite({
      filters: [{
        id: 'tags',
        field: 'tag',
        operator: 'in',
        value: ' streaming, unlock, streaming ',
        enabled: true,
      }],
    }, { create: false })).toEqual(expect.objectContaining({
      valid: true,
      filters: [{
        id: 'tags',
        field: 'tag',
        operator: 'in',
        value: ['streaming', 'unlock'],
        enabled: true,
      }],
    }))
  })

  it('rejects malformed collection payloads', () => {
    expect(validateCollectionWrite({ name: ' ' }, { create: true })).toEqual({
      valid: false,
      error: 'name is required',
    })
    expect(validateCollectionWrite({ sourceIds: ['source-1', ''] }, { create: false })).toEqual({
      valid: false,
      error: 'sourceIds must only contain non-empty strings',
    })
    expect(validateCollectionWrite({ dedup: 'server' as never }, { create: false })).toEqual({
      valid: false,
      error: 'invalid dedup strategy',
    })
    expect(validateCollectionWrite({ sort: 'latency' as never }, { create: false })).toEqual({
      valid: false,
      error: 'invalid sort strategy',
    })
  })

  it('rejects invalid filters and rename regexes', () => {
    expect(validateCollectionWrite({
      filters: [{ id: 'bad', field: 'name', operator: 'starts_with' as never, value: 'HK', enabled: true }],
    }, { create: false })).toEqual({
      valid: false,
      error: 'invalid filter operator at index 0',
    })
    expect(validateCollectionWrite({
      filters: [{ id: 'bad', field: 'name', operator: 'regex', value: '(', enabled: true }],
    }, { create: false })).toEqual({
      valid: false,
      error: 'invalid filter regex at index 0',
    })
    expect(validateCollectionWrite({
      renames: [{ id: 'bad', type: 'regex', pattern: '(', enabled: true, order: 0 }],
    }, { create: false })).toEqual({
      valid: false,
      error: 'invalid rename regex at index 0',
    })
  })
})
