import type { CompatibilityWarning, ProxyProtocol, RuleType } from '@uni-conf/types'
import type { ExportInput, IExporter } from './exporter.interface'
import { nodeToLoon } from './node-serializer'
import { isRuleSetFormatCompatible } from '../remote-rules/compatibility'

// Protocols with limited Loon support
const LIMITED_PROTOCOLS: Set<ProxyProtocol> = new Set(['vless', 'hysteria2', 'tuic'])

// Rule types not supported in Loon
const UNSUPPORTED_RULE_TYPES: Set<RuleType> = new Set([
  'DOMAIN-REGEX',
  'IP-ASN',
  'SRC-IP-CIDR',
  'SRC-PORT',
  'PROTOCOL',
  'IN-TYPE',
  'SCRIPT',
])

export class LoonExporter implements IExporter {
  readonly name = 'Loon'
  readonly format = 'loon' as const
  readonly extension = 'conf'
  readonly contentType = 'text/plain'

  generate(input: ExportInput): string {
    const { nodes, groups, rules, remoteSets, collectionNodeNames = {} } = input
    const lines: string[] = []

    // [General]
    lines.push('[General]')
    lines.push('ip-mode = v4-only')
    lines.push('dns-server = system')
    lines.push('allow-wifi-access = false')
    lines.push('wifi-access-http-port = 7222')
    lines.push('wifi-access-socks5-port = 7221')
    lines.push('interface-mode = auto')
    lines.push('test-timeout = 5')
    lines.push('proxy-test-url = http://www.google.com/generate_204')
    lines.push('internet-test-url = http://connectivitycheck.gstatic.com/generate_204')
    lines.push('')

    // [Proxy]
    lines.push('[Proxy]')
    for (const node of nodes) {
      lines.push(nodeToLoon(node))
    }
    lines.push('')

    // [Remote Proxy] — if any remote proxy sets referenced
    // (For Loon, remote proxy sets are subscription URLs, not rule sets)
    lines.push('[Remote Proxy]')
    lines.push('')

    // [Proxy Group]
    lines.push('[Proxy Group]')
    for (const group of groups.filter((g) => g.enabled).sort((a, b) => a.order - b.order)) {
      const members: string[] = []

      for (const b of group.builtins) {
        members.push(b)
      }
      for (const gid of group.groupIds) {
        const nested = groups.find((g) => g.id === gid)
        if (nested) members.push(nested.name)
      }
      const collectionNames = group.collectionIds.flatMap((id) => collectionNodeNames[id] ?? [])
      if (collectionNames.length > 0) {
        members.push(...collectionNames)
      } else if (group.collectionIds.length === 0 || group.collectionIds.includes('*')) {
        for (const node of nodes) {
          members.push(node.name)
        }
      }

      const loonType = mapLoonGroupType(group.type)
      const dedupedMembers = [...new Set(members)]
      let line = `${group.name} = ${loonType},${dedupedMembers.join(',')}`

      if (group.type === 'url-test' || group.type === 'fallback') {
        line += `,url=${group.testUrl ?? 'http://www.google.com/generate_204'}`
        line += `,interval=${group.interval ?? 300}`
      }

      lines.push(line)
    }
    lines.push('')

    // [Rule]
    lines.push('[Rule]')
    const enabledRules = rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order)
    for (const rule of enabledRules) {
      if (UNSUPPORTED_RULE_TYPES.has(rule.type)) continue
      const targetGroup = resolveGroupName(rule.targetGroupId, groups)
      if (rule.type === 'MATCH') {
        lines.push(`FINAL,${targetGroup}`)
      } else if (rule.noResolve) {
        lines.push(`${rule.type},${rule.payload},${targetGroup},no-resolve`)
      } else {
        lines.push(`${rule.type},${rule.payload},${targetGroup}`)
      }
    }
    // Ensure FINAL at end
    if (!enabledRules.some((r) => r.type === 'MATCH')) {
      lines.push('FINAL,PROXY')
    }
    lines.push('')

    // [Remote Rule]
    lines.push('[Remote Rule]')
    for (const rs of remoteSets.filter((s) => s.enabled && isRuleSetFormatCompatible('loon', s.format))) {
      const targetGroup = resolveGroupName(rs.targetGroupId, groups)
      lines.push(`${rs.url}, policy=${targetGroup}, tag=${rs.name}, enabled=true`)
    }
    lines.push('')

    return lines.join('\n')
  }

  validate(input: ExportInput): CompatibilityWarning[] {
    const warnings: CompatibilityWarning[] = []

    // Check for limited protocol support
    for (const node of input.nodes) {
      if (LIMITED_PROTOCOLS.has(node.protocol)) {
        warnings.push({
          client: 'loon',
          level: 'partial',
          message: `节点 "${node.name}" 使用的协议 ${node.protocol} 在 Loon 中支持有限`,
          messageEn: `Node "${node.name}" uses protocol ${node.protocol} which has limited support in Loon`,
        })
      }
    }

    // Check for unsupported rule types
    for (const rule of input.rules) {
      if (UNSUPPORTED_RULE_TYPES.has(rule.type)) {
        warnings.push({
          ruleId: rule.id,
          client: 'loon',
          level: 'unsupported',
          message: `规则类型 ${rule.type} 在 Loon 中不受支持`,
          messageEn: `Rule type ${rule.type} is not supported in Loon`,
        })
      }
    }

    return warnings
  }
}

function mapLoonGroupType(type: string): string {
  const map: Record<string, string> = {
    select: 'select',
    'url-test': 'url-test',
    fallback: 'fallback',
    'load-balance': 'load-balance',
    direct: 'select',
    reject: 'select',
  }
  return map[type] ?? 'select'
}

function resolveGroupName(groupId: string, groups: Array<{ id: string; name: string }>): string {
  return groups.find((group) => group.id === groupId)?.name ?? groupId
}
