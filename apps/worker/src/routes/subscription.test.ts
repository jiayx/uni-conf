import { describe, expect, it } from 'vitest'
import type { ProxySource } from '@uni-conf/types'
import {
  getExportFormatFromSubscriptionFilename,
  getExportSubscriptionFilename,
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

})
