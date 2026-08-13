import { describe, expect, it } from 'vitest'
import { buildClientImportLink } from './client-import-schemes'

const subscriptionUrl = 'https://conf.example/sub/token/loon.conf?name=Home%20%C2%B7%20Loon'

describe('buildClientImportLink', () => {
  it.each([
    ['singbox', 'sing-box://import-remote-profile?url=', '#Home%20Profile'],
    ['loon', 'loon://import?sub=', ''],
    ['surge', 'surge:///install-config?url=', ''],
    ['shadowrocket', 'shadowrocket://config/add/', ''],
    ['stash', 'stash://install-config?url=', ''],
    ['egern', 'egern:/profiles/new?name=Home%20Profile&url=', ''],
  ] as const)('builds the %s full-profile scheme', (format, prefix, suffix) => {
    expect(buildClientImportLink(format, subscriptionUrl, 'Home Profile')?.url).toBe(
      `${prefix}${encodeURIComponent(subscriptionUrl)}${suffix}`,
    )
  })

  it.each(['mihomo', 'clash', 'quantumultx', 'nodes_base64', 'nodes_raw'] as const)(
    'does not invent an unsafe scheme for %s',
    (format) => {
      expect(buildClientImportLink(format, subscriptionUrl, 'Home Profile')).toBeNull()
    },
  )
})
