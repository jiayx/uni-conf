import { describe, expect, it } from 'vitest'
import { appRoutes } from './router'

describe('application routes', () => {
  it('keeps every supported page reachable from the root layout', () => {
    const children = appRoutes[0]?.children ?? []
    expect(children.map((route) => route.index ? '/' : `/${String(route.path)}`)).toEqual([
      '/', '/sources', '/nodes', '/collections', '/groups', '/rules',
      '/remote-rule-sets', '/export', '/preview', '/settings',
    ])
  })
})
