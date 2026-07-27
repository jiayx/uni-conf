import { describe, expect, it } from 'vitest'
import { mapRemoteRuleSet } from './helpers'

describe('mapRemoteRuleSet', () => {
  it('exposes both the managed default and the effective overridden target', () => {
    const mapped = mapRemoteRuleSet({
      id: 'managed-streaming',
      name: 'Managed Streaming',
      url: 'https://rules.example.com/streaming.list',
      format: 'mihomo',
      behavior: 'classical',
      preset_source: 'quixotic',
      preset_id: 'streaming',
      source_overrides: '{}',
      source_missing: 0,
      target_group_id: 'builtin-streaming',
      target_override_group_id: 'builtin-proxy',
      update_interval: 24,
      enabled: 1,
      sort_order: 10,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })

    expect(mapped.defaultTargetGroupId).toBe('builtin-streaming')
    expect(mapped.targetOverrideGroupId).toBe('builtin-proxy')
    expect(mapped.targetGroupId).toBe('builtin-proxy')
  })

  it('uses the managed default when no override exists', () => {
    const mapped = mapRemoteRuleSet({
      id: 'managed-streaming',
      name: 'Managed Streaming',
      url: 'https://rules.example.com/streaming.list',
      format: 'mihomo',
      behavior: 'classical',
      source_overrides: '{}',
      source_missing: 0,
      target_group_id: 'builtin-streaming',
      target_override_group_id: null,
      update_interval: 24,
      enabled: 1,
      sort_order: 10,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })

    expect(mapped.defaultTargetGroupId).toBe('builtin-streaming')
    expect(mapped.targetOverrideGroupId).toBeUndefined()
    expect(mapped.targetGroupId).toBe('builtin-streaming')
  })
})
