import { describe, expect, it } from 'vitest'
import { validateGroupWrite } from './groups'

describe('groups route helpers', () => {
  it('normalizes create payloads for custom groups', () => {
    expect(validateGroupWrite({
      name: '  AI Backup  ',
      type: 'select',
      groupIds: [' builtin-proxy ', 'builtin-proxy', 'builtin-auto-select'],
      builtins: ['DIRECT', 'DIRECT'],
      interval: 300,
      tolerance: 150,
    }, { create: true, isBuiltin: false })).toEqual({
      valid: true,
      name: 'AI Backup',
      type: 'select',
      collectionIds: undefined,
      groupIds: ['builtin-proxy', 'builtin-auto-select'],
      builtins: ['DIRECT'],
      testUrl: undefined,
      interval: 300,
      tolerance: 150,
      lazy: true,
      enabled: true,
    })
  })

  it('rejects invalid group shapes', () => {
    expect(validateGroupWrite({ name: 'Bad', type: 'random' as never }, { create: true, isBuiltin: false })).toEqual({
      valid: false,
      error: 'invalid group type',
    })
    expect(validateGroupWrite({ name: 'Bad', type: 'direct' }, { create: true, isBuiltin: false })).toEqual({
      valid: false,
      error: 'DIRECT and REJECT are built-in foundation outlets',
    })
    expect(validateGroupWrite({ groupIds: ['group-1', ''] }, { create: false, id: 'group-2', isBuiltin: false })).toEqual({
      valid: false,
      error: 'groupIds must only contain non-empty strings',
    })
    expect(validateGroupWrite({ builtins: ['PROXY' as never] }, { create: false, id: 'group-2', isBuiltin: false })).toEqual({
      valid: false,
      error: 'builtins must only contain DIRECT or REJECT',
    })
    expect(validateGroupWrite({ groupIds: ['group-1'] }, { create: false, id: 'group-1', isBuiltin: false })).toEqual({
      valid: false,
      error: 'groupIds cannot include the group itself',
    })
    expect(validateGroupWrite({ name: ' AI ', type: 'select' }, { create: true, isBuiltin: false })).toEqual({
      valid: false,
      error: 'custom group name conflicts with a built-in policy group',
    })
    expect(validateGroupWrite({ name: 'direct' }, { create: false, id: 'custom-1', isBuiltin: false })).toEqual({
      valid: false,
      error: 'custom group name conflicts with a built-in policy group',
    })
  })

  it('allows built-in foundation types only for built-in group maintenance', () => {
    expect(validateGroupWrite({ name: 'REJECT', type: 'reject' }, { create: false, id: 'builtin-reject', isBuiltin: true })).toEqual({
      valid: true,
      name: 'REJECT',
      type: 'reject',
      collectionIds: undefined,
      groupIds: undefined,
      builtins: undefined,
      testUrl: undefined,
      interval: undefined,
      tolerance: undefined,
      lazy: undefined,
      enabled: undefined,
    })
  })
})
