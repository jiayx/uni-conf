import type { CompatibilityWarning, ProxyGroup } from '@uni-conf/types'
import yaml from 'js-yaml'
import type { ExportInput, IExporter } from './exporter.interface'
import { nodeToClash } from './node-serializer'

function mapGroupType(type: ProxyGroup['type']): string {
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

export class MihomoExporter implements IExporter {
  readonly name = 'Mihomo / Clash'
  readonly format = 'mihomo' as const
  readonly extension = 'yaml'
  readonly contentType = 'text/yaml'

  generate(input: ExportInput): string {
    const { nodes, groups, rules, remoteSets } = input

    // Base config
    const config: Record<string, unknown> = {
      port: 7890,
      'socks-port': 7891,
      'allow-lan': false,
      mode: 'rule',
      'log-level': 'info',
      'external-controller': '127.0.0.1:9090',
      dns: {
        enable: true,
        'enhanced-mode': 'fake-ip',
        'fake-ip-range': '198.18.0.1/16',
        nameserver: ['8.8.8.8', '1.1.1.1'],
        fallback: ['tls://8.8.4.4:853', 'tls://1.0.0.1:853'],
      },
    }

    // proxies
    config['proxies'] = nodes.map(nodeToClash)

    // proxy-groups
    const proxyGroups = groups
      .filter((g) => g.enabled)
      .sort((a, b) => a.order - b.order)
      .map((group) => {
        const proxies: string[] = []

        // Add builtins
        for (const b of group.builtins) {
          proxies.push(b)
        }

        // Add nested groups
        for (const gid of group.groupIds) {
          const nested = groups.find((g) => g.id === gid)
          if (nested) proxies.push(nested.name)
        }

        // Add node names from collections (simplified: use all node names)
        // In practice, caller resolves collections -> node names
        // Here we include all node names for groups that reference all collections
        if (group.collectionIds.length === 0 || group.collectionIds.includes('*')) {
          for (const node of nodes) {
            proxies.push(node.name)
          }
        }

        const g: Record<string, unknown> = {
          name: group.name,
          type: mapGroupType(group.type),
          proxies,
        }

        if (group.type === 'url-test' || group.type === 'fallback') {
          g['url'] = group.testUrl ?? 'http://www.gstatic.com/generate_204'
          g['interval'] = group.interval ?? 300
          if (group.tolerance !== undefined) g['tolerance'] = group.tolerance
          if (group.lazy !== undefined) g['lazy'] = group.lazy
        }

        if (group.type === 'load-balance') {
          g['url'] = group.testUrl ?? 'http://www.gstatic.com/generate_204'
          g['interval'] = group.interval ?? 300
          g['strategy'] = 'consistent-hashing'
        }

        return g
      })

    config['proxy-groups'] = proxyGroups

    // rule-providers
    const enabledSets = remoteSets.filter((s) => s.enabled)
    if (enabledSets.length > 0) {
      const ruleProviders: Record<string, unknown> = {}
      for (const rs of enabledSets) {
        const providerName = rs.name.replace(/\s+/g, '-').toLowerCase()
        ruleProviders[providerName] = {
          type: 'http',
          behavior: 'domain',
          url: rs.url,
          path: `./ruleset/${providerName}.yaml`,
          interval: (rs.updateInterval ?? 24) * 3600,
        }
      }
      config['rule-providers'] = ruleProviders
    }

    // rules
    const ruleLines: string[] = []
    const enabledRules = rules.filter((r) => r.enabled).sort((a, b) => a.order - b.order)

    for (const rule of enabledRules) {
      const targetGroup = rule.targetGroupId // caller should resolve to group name; use id as fallback
      let line: string
      if (rule.type === 'MATCH') {
        line = `MATCH,${targetGroup}`
      } else if (rule.noResolve) {
        line = `${rule.type},${rule.payload},${targetGroup},no-resolve`
      } else {
        line = `${rule.type},${rule.payload},${targetGroup}`
      }
      ruleLines.push(line)
    }

    // Add remote rule-set rules
    for (const rs of enabledSets) {
      const providerName = rs.name.replace(/\s+/g, '-').toLowerCase()
      ruleLines.push(`RULE-SET,${providerName},${rs.targetGroupId}`)
    }

    // Ensure MATCH at end
    if (!ruleLines.some((l) => l.startsWith('MATCH'))) {
      ruleLines.push('MATCH,PROXY')
    }

    config['rules'] = ruleLines

    return yaml.dump(config, { lineWidth: -1, quotingType: '"', noRefs: true })
  }

  validate(_input: ExportInput): CompatibilityWarning[] {
    return []
  }
}
