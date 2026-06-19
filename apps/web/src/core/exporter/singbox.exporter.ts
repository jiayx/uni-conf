import type { CompatibilityWarning, ProxyGroup, RemoteRuleSet, RuleSetFormat, RuleType } from '@uni-conf/types'
import type { ExportInput, IExporter } from './exporter.interface'
import { nodeToSingboxOutbound } from './node-serializer'
import { isRuleSetFormatCompatible, resolveRemoteRuleSetForExport } from '../remote-rules/compatibility'

// Rule types not supported in sing-box
const UNSUPPORTED_RULE_TYPES: Set<RuleType> = new Set(['PROCESS-PATH', 'IN-TYPE', 'SCRIPT'])

function mapRuleType(type: RuleType): string {
  const map: Record<string, string> = {
    'DOMAIN': 'domain',
    'DOMAIN-SUFFIX': 'domain_suffix',
    'DOMAIN-KEYWORD': 'domain_keyword',
    'DOMAIN-REGEX': 'domain_regex',
    'IP-CIDR': 'ip_cidr',
    'IP-CIDR6': 'ip_cidr',
    'IP-ASN': 'ip_asn',
    'GEOIP': 'geoip',
    'GEOSITE': 'geosite',
    'PROCESS-NAME': 'process_name',
    'PORT': 'port',
    'SRC-PORT': 'source_port',
    'SRC-IP-CIDR': 'source_ip_cidr',
    'NETWORK': 'network',
    'PROTOCOL': 'protocol',
    'RULE-SET': 'rule_set',
    'MATCH': 'final',
  }
  return map[type] ?? type.toLowerCase().replace(/-/g, '_')
}

function mapGroupType(type: ProxyGroup['type']): string {
  const map: Record<string, string> = {
    select: 'selector',
    'url-test': 'urltest',
    fallback: 'urltest',
    'load-balance': 'urltest',
    direct: 'direct',
    reject: 'block',
  }
  return map[type] ?? 'selector'
}

export class SingboxExporter implements IExporter {
  readonly name = 'sing-box'
  readonly format = 'singbox' as const
  readonly extension = 'json'
  readonly contentType = 'application/json'

  generate(input: ExportInput): string {
    const { nodes, groups, rules, remoteSets, collectionNodeNames = {} } = input

    // Outbounds: proxy nodes
    const proxyOutbounds = nodes.map(nodeToSingboxOutbound)

    // Group outbounds
    const groupOutbounds = groups
      .filter((g) => g.enabled)
      .sort((a, b) => a.order - b.order)
      .map((group) => {
        const outboundRefs: string[] = []

        for (const b of group.builtins) {
          outboundRefs.push(b === 'DIRECT' ? 'direct' : 'block')
        }

        for (const gid of group.groupIds) {
          const nested = groups.find((g) => g.id === gid)
          if (nested) outboundRefs.push(nested.name)
        }

        const collectionNames = group.collectionIds.flatMap((id) => collectionNodeNames[id] ?? [])
        if (collectionNames.length > 0) {
          outboundRefs.push(...collectionNames)
        } else if (group.collectionIds.length === 0 || group.collectionIds.includes('*')) {
          for (const node of nodes) {
            outboundRefs.push(node.name)
          }
        }

        const gType = mapGroupType(group.type)

        const ob: Record<string, unknown> = {
          type: gType,
          tag: group.name,
          outbounds: [...new Set(outboundRefs)],
        }

        if (gType === 'urltest') {
          ob['url'] = group.testUrl ?? 'https://www.gstatic.com/generate_204'
          ob['interval'] = `${group.interval ?? 300}s`
          if (group.tolerance !== undefined) ob['tolerance'] = group.tolerance
        }

        return ob
      })

    // Built-in outbounds
    const builtinOutbounds = [
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
      { type: 'dns', tag: 'dns-out' },
    ]

    const allOutbounds = [...proxyOutbounds, ...groupOutbounds, ...builtinOutbounds]

    // Route rules
    const routeRules: Record<string, unknown>[] = []

    // DNS rule
    routeRules.push({ protocol: 'dns', outbound: 'dns-out' })

    const enabledRules = rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order)
    let finalOutbound = 'direct'

    for (const rule of enabledRules) {
      if (UNSUPPORTED_RULE_TYPES.has(rule.type)) continue
      const targetGroup = groups.find((g) => g.id === rule.targetGroupId)?.name ?? rule.targetGroupId
      if (rule.type === 'MATCH') {
        finalOutbound = targetGroup
        continue
      }
      const ruleType = mapRuleType(rule.type)
      const ruleObj: Record<string, unknown> = {
        [ruleType]: rule.payload,
        outbound: targetGroup,
      }
      routeRules.push(ruleObj)
    }

    // Remote rule sets
    const ruleSets: Record<string, unknown>[] = []
    const enabledRemoteSets = remoteSets
      .filter((s) => s.enabled)
      .map((s) => ({ source: s, resolved: resolveRemoteRuleSetForExport(s, 'singbox') }))
      .filter((item): item is { source: RemoteRuleSet; resolved: { url: string; format: RuleSetFormat } } =>
        Boolean(item.resolved) && isRuleSetFormatCompatible('singbox', item.resolved!.format)
      )

    for (const { source: rs, resolved } of enabledRemoteSets) {
      const tag = rs.name.replace(/\s+/g, '-').toLowerCase()
      ruleSets.push({
        tag,
        type: 'remote',
        format: 'binary',
        url: resolved.url,
        download_detour: 'direct',
        update_interval: `${rs.updateInterval ?? 24}h`,
      })
      const targetGroup = groups.find((g) => g.id === rs.targetGroupId)?.name ?? rs.targetGroupId
      routeRules.push({ rule_set: tag, outbound: targetGroup })
    }

    // Determine primary proxy group name
    const primaryGroup = groups.find((g) => g.enabled && !g.isBuiltin)
    if (primaryGroup && finalOutbound === 'direct') {
      finalOutbound = primaryGroup.name
    }

    const config = {
      log: { level: 'info', timestamp: true },
      dns: {
        servers: [
          {
            tag: 'remote',
            address: 'tls://8.8.8.8',
            address_resolver: 'local',
            strategy: 'ipv4_only',
            detour: finalOutbound,
          },
          {
            tag: 'local',
            address: '223.5.5.5',
            strategy: 'ipv4_only',
            detour: 'direct',
          },
          { tag: 'block', address: 'rcode://success' },
        ],
        rules: [
          { outbound: 'any', server: 'local' },
          { clash_mode: 'direct', server: 'local' },
          { clash_mode: 'global', server: 'remote' },
          { geosite: 'cn', server: 'local' },
        ],
        final: 'remote',
        strategy: 'ipv4_only',
      },
      inbounds: [
        {
          type: 'tun',
          tag: 'tun-in',
          inet4_address: '172.19.0.1/30',
          auto_route: true,
          strict_route: true,
          sniff: true,
        },
        {
          type: 'mixed',
          tag: 'mixed-in',
          listen: '127.0.0.1',
          listen_port: 2080,
          sniff: true,
        },
      ],
      outbounds: allOutbounds,
      route: {
        rules: routeRules,
        rule_set: ruleSets.length > 0 ? ruleSets : undefined,
        final: finalOutbound,
        auto_detect_interface: true,
      },
    }

    return JSON.stringify(config, null, 2)
  }

  validate(input: ExportInput): CompatibilityWarning[] {
    const warnings: CompatibilityWarning[] = []
    for (const rule of input.rules) {
      if (UNSUPPORTED_RULE_TYPES.has(rule.type)) {
        warnings.push({
          ruleId: rule.id,
          client: 'singbox',
          level: 'unsupported',
          message: `规则类型 ${rule.type} 在 sing-box 中不受支持`,
          messageEn: `Rule type ${rule.type} is not supported in sing-box`,
        })
      }
    }
    return warnings
  }
}
