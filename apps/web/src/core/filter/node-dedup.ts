import type { ProxyNode, DedupStrategy } from '@uni-conf/types'

function getKey(node: ProxyNode, strategy: DedupStrategy): string {
  switch (strategy) {
    case 'name':
      return node.name.toLowerCase()
    case 'server_port':
      return `${node.server.toLowerCase()}:${node.port}`
    case 'protocol_server_port':
      return `${node.protocol}:${node.server.toLowerCase()}:${node.port}`
    case 'full_config':
      return JSON.stringify(node.parsedConfig)
    default:
      return node.id
  }
}

export function dedupNodes(nodes: ProxyNode[], strategy: DedupStrategy): ProxyNode[] {
  const seen = new Set<string>()
  const result: ProxyNode[] = []

  for (const node of nodes) {
    const key = getKey(node, strategy)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(node)
    }
  }

  return result
}
