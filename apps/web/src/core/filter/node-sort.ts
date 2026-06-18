import type { ProxyNode, SortStrategy } from '@uni-conf/types'

export const DEFAULT_COUNTRY_ORDER = [
  'HK', 'TW', 'JP', 'SG', 'US', 'KR', 'GB', 'DE', 'FR', 'NL', 'AU', 'CA', 'OTHER',
]

function getCountryRank(countryCode: string | undefined, order: string[]): number {
  if (!countryCode) return order.indexOf('OTHER') >= 0 ? order.indexOf('OTHER') : order.length
  const idx = order.indexOf(countryCode.toUpperCase())
  if (idx >= 0) return idx
  const otherIdx = order.indexOf('OTHER')
  return otherIdx >= 0 ? otherIdx : order.length
}

export function sortNodes(
  nodes: ProxyNode[],
  strategy: SortStrategy,
  customCountryOrder?: string[],
): ProxyNode[] {
  const countryOrder = customCountryOrder ?? DEFAULT_COUNTRY_ORDER

  switch (strategy) {
    case 'country':
      return [...nodes].sort((a, b) => {
        const ra = getCountryRank(a.countryCode, countryOrder)
        const rb = getCountryRank(b.countryCode, countryOrder)
        if (ra !== rb) return ra - rb
        return a.name.localeCompare(b.name)
      })

    case 'name':
      return [...nodes].sort((a, b) => a.name.localeCompare(b.name))

    case 'source':
      return [...nodes].sort((a, b) => {
        const cmp = a.sourceId.localeCompare(b.sourceId)
        if (cmp !== 0) return cmp
        return a.name.localeCompare(b.name)
      })

    case 'protocol':
      return [...nodes].sort((a, b) => {
        const cmp = a.protocol.localeCompare(b.protocol)
        if (cmp !== 0) return cmp
        return a.name.localeCompare(b.name)
      })

    case 'manual':
    default:
      return [...nodes]
  }
}
