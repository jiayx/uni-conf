import type { ProxyNode, NodeFilter, FilterOperator } from '@uni-conf/types'

function getFieldValue(node: ProxyNode, field: NodeFilter['field']): string | string[] {
  switch (field) {
    case 'name':
      return node.name
    case 'server':
      return node.server
    case 'protocol':
      return node.protocol
    case 'country':
      return node.country ?? ''
    case 'countryCode':
      return node.countryCode ?? ''
    case 'tag':
      return node.tags
    case 'sourceId':
      return node.sourceId
    default:
      return ''
  }
}

function matchOperator(
  fieldValue: string | string[],
  operator: FilterOperator,
  filterValue: string | string[],
): boolean {
  const normalize = (v: string) => v.toLowerCase()
  const strValue = Array.isArray(fieldValue) ? fieldValue.join(',') : fieldValue
  const filterStr = Array.isArray(filterValue) ? filterValue[0] : filterValue
  const filterArr = Array.isArray(filterValue) ? filterValue : [filterValue]

  switch (operator) {
    case 'contains':
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => normalize(v).includes(normalize(filterStr)))
      }
      return normalize(strValue).includes(normalize(filterStr))

    case 'not_contains':
      if (Array.isArray(fieldValue)) {
        return !fieldValue.some((v) => normalize(v).includes(normalize(filterStr)))
      }
      return !normalize(strValue).includes(normalize(filterStr))

    case 'regex': {
      const re = new RegExp(filterStr, 'i')
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => re.test(v))
      }
      return re.test(strValue)
    }

    case 'not_regex': {
      const re = new RegExp(filterStr, 'i')
      if (Array.isArray(fieldValue)) {
        return !fieldValue.some((v) => re.test(v))
      }
      return !re.test(strValue)
    }

    case 'equals':
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => normalize(v) === normalize(filterStr))
      }
      return normalize(strValue) === normalize(filterStr)

    case 'not_equals':
      if (Array.isArray(fieldValue)) {
        return !fieldValue.some((v) => normalize(v) === normalize(filterStr))
      }
      return normalize(strValue) !== normalize(filterStr)

    case 'in':
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => filterArr.some((f) => normalize(v) === normalize(f)))
      }
      return filterArr.some((f) => normalize(strValue) === normalize(f))

    case 'not_in':
      if (Array.isArray(fieldValue)) {
        return !fieldValue.some((v) => filterArr.some((f) => normalize(v) === normalize(f)))
      }
      return !filterArr.some((f) => normalize(strValue) === normalize(f))

    default:
      return true
  }
}

export function applyFilter(node: ProxyNode, filter: NodeFilter): boolean {
  if (!filter.enabled) return true
  const fieldValue = getFieldValue(node, filter.field)
  return matchOperator(fieldValue, filter.operator, filter.value)
}

export function applyFilters(node: ProxyNode, filters: NodeFilter[]): boolean {
  return filters.filter((f) => f.enabled).every((filter) => applyFilter(node, filter))
}

export function filterNodes(nodes: ProxyNode[], filters: NodeFilter[]): ProxyNode[] {
  const enabledFilters = filters.filter((f) => f.enabled)
  if (enabledFilters.length === 0) return nodes
  return nodes.filter((node) => applyFilters(node, enabledFilters))
}
