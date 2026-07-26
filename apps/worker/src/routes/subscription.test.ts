import { describe, expect, it } from 'vitest'
import type { ProxySource } from '@uni-conf/types'
import {
  EXPORT_SUBSCRIPTION_FORMATS,
  FULL_CONFIG_EXPORT_FORMATS,
  NODE_SUBSCRIPTION_EXPORT_FORMATS,
  RULE_SET_FORMATS,
  getExportFormatFromSubscriptionFilename,
  getExportSubscriptionFilename,
  isExportSubscriptionFormat,
  isFullConfigExportFormat,
  isRuleSetFormat,
} from '@uni-conf/shared'
import { buildSubscriptionUserInfoHeader } from './subscription'

const baseSource: ProxySource = {
  id: 'source-1',
  name: 'Airport',
  type: 'url',
  format: 'auto',
  enabled: true,
  nodeCount: 0,
  tags: [],
  groups: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('subscription route helpers', () => {
  it('aggregates cached subscription userinfo from enabled sources', () => {
    expect(buildSubscriptionUserInfoHeader([
      {
        ...baseSource,
        uploadBytes: 100,
        downloadBytes: 200,
        totalBytes: 1000,
        expireTime: 2000,
      },
      {
        ...baseSource,
        id: 'source-2',
        uploadBytes: 10,
        downloadBytes: 20,
        totalBytes: 3000,
        expireTime: 1500,
      },
    ])).toBe('upload=110; download=220; total=4000; expire=1500')
  })

  it('omits userinfo when sources do not provide it', () => {
    expect(buildSubscriptionUserInfoHeader([baseSource])).toBeUndefined()
  })

  it('uses the canonical public filename for sing-box subscriptions', () => {
    expect(getExportSubscriptionFilename('singbox')).toBe('singbox.json')
    expect(getExportFormatFromSubscriptionFilename('singbox.json')).toBe('singbox')
    expect(getExportFormatFromSubscriptionFilename('sing-box.json')).toBeNull()
  })

  it('exposes Clash as an explicit Mihomo-compatible subscription filename', () => {
    expect(getExportSubscriptionFilename('clash')).toBe('clash.yaml')
    expect(getExportFormatFromSubscriptionFilename('clash.yaml')).toBe('clash')
  })

  it('derives every target format registry from one complete partition', () => {
    expect(EXPORT_SUBSCRIPTION_FORMATS).toEqual([
      ...FULL_CONFIG_EXPORT_FORMATS,
      ...NODE_SUBSCRIPTION_EXPORT_FORMATS,
    ])
    expect(RULE_SET_FORMATS).toEqual([...FULL_CONFIG_EXPORT_FORMATS, 'text'])
    expect(FULL_CONFIG_EXPORT_FORMATS.every(isFullConfigExportFormat)).toBe(true)
    expect(EXPORT_SUBSCRIPTION_FORMATS.every(isExportSubscriptionFormat)).toBe(true)
    expect(RULE_SET_FORMATS.every(isRuleSetFormat)).toBe(true)
  })
})
