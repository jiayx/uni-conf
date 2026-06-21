# Adding a New Exporter to UniConf

This guide explains how to add support for a new proxy client format (e.g., Surge, Quantumult X, Stash) to UniConf.

## Step 1: Add the format type

In `packages/types/src/index.ts`, add the new format to `ExportFormat`:

```ts
export type ExportFormat =
  | 'mihomo'
  | 'clash'
  | 'singbox'
  | 'loon'
  | 'surge'        // ← add here
  | 'quantumultx'
  | 'stash'
  // ...
```

## Step 2: Create the exporter class (frontend)

Create `apps/web/src/core/exporter/surge.exporter.ts`:

```ts
import type { ExportFormat, CompatibilityWarning } from '@uni-conf/types'
import type { IExporter, ExportInput } from './exporter.interface'

export class SurgeExporter implements IExporter {
  readonly name = 'Surge'
  readonly format: ExportFormat = 'surge'
  readonly extension = 'conf'
  readonly contentType = 'text/plain'

  generate(input: ExportInput): string {
    const { nodes, groups, rules, remoteSets } = input
    const lines: string[] = []

    // [General] section
    lines.push('[General]')
    lines.push('loglevel = notify')
    lines.push('dns-server = system, 8.8.8.8, 1.1.1.1')
    // ... other general options

    // [Proxy] section
    lines.push('\n[Proxy]')
    for (const node of nodes) {
      lines.push(nodeToSurge(node))
    }

    // [Proxy Group] section
    lines.push('\n[Proxy Group]')
    for (const group of groups) {
      lines.push(groupToSurge(group, nodes, groups))
    }

    // [Rule] section
    lines.push('\n[Rule]')
    for (const rule of rules) {
      if (rule.enabled) lines.push(ruleToSurge(rule))
    }
    lines.push(`FINAL,${defaultPolicy(groups)}`)

    return lines.join('\n')
  }

  validate(input: ExportInput): CompatibilityWarning[] {
    const warnings: CompatibilityWarning[] = []
    for (const rule of input.rules) {
      if (rule.type === 'GEOSITE') {
        warnings.push({
          ruleId: rule.id,
          client: 'surge',
          level: 'unsupported',
          message: 'Surge 不支持 GEOSITE 规则类型',
          messageEn: 'Surge does not support GEOSITE rule type',
        })
      }
    }
    return warnings
  }
}
```

`defaultPolicy(groups)` should prefer `漏网之鱼`, then `PROXY`, then the first available group. This keeps generated client configs aligned with UniConf's default catch-all strategy.

## Step 3: Register the exporter

In `apps/web/src/core/exporter/registry.ts`:

```ts
import { SurgeExporter } from './surge.exporter'

const exporters: Map<ExportFormat, IExporter> = new Map([
  // existing...
  ['surge', new SurgeExporter()],
])
```

## Step 4: Create the server-side generator

Create `apps/worker/src/generators/surge.ts`:

```ts
import type { ProxyNode, ProxyGroup, ProxyRule, RemoteRuleSet } from '@uni-conf/types'

export function generateSurge(
  nodes: ProxyNode[],
  groups: ProxyGroup[],
  rules: ProxyRule[],
  remoteSets: RemoteRuleSet[],
): string {
  // Same logic as the frontend exporter, but running in Worker
  // ...
}
```

## Step 5: Add the format to the worker export route

In `apps/worker/src/routes/subscription.ts`, add a case for the new format:

```ts
case 'surge.conf':
  content = generateSurge(nodes, groups, rules, remoteSets)
  contentType = 'text/plain; charset=utf-8'
  break
```

## Step 6: Add node serialization

In `apps/web/src/core/exporter/node-serializer.ts`, add a `nodeToSurge(node)` function:

```ts
export function nodeToSurge(node: ProxyNode): string {
  switch (node.protocol) {
    case 'ss':
      return `${node.name} = ss, ${node.server}, ${node.port}, encrypt-method=${node.parsedConfig.extra['cipher']}, password=${node.parsedConfig.password}`
    case 'vmess':
      return `${node.name} = vmess, ${node.server}, ${node.port}, username=${node.parsedConfig.uuid}`
    // ... other protocols
    default:
      return `# Unsupported: ${node.name} (${node.protocol})`
  }
}
```

## Step 7: Add i18n strings

In `apps/web/src/i18n/zh.json`:
```json
{
  "export": {
    "formats": {
      "surge": "Surge"
    }
  }
}
```

In `apps/web/src/i18n/en.json`:
```json
{
  "export": {
    "formats": {
      "surge": "Surge"
    }
  }
}
```

## Step 8: Add compatibility rules

In `apps/web/src/core/compatibility/compat-checker.ts`, update `RULE_COMPAT` to include Surge's compatibility for each rule type.

## Step 9: Write tests

Create `apps/web/src/core/exporter/__tests__/surge.exporter.test.ts` with snapshot tests and edge cases.

## Compatibility Matrix Reference

| Rule Type | Mihomo | sing-box | Loon | Surge | Shadowrocket | QX |
|-----------|--------|---------|------|-------|-------------|-----|
| DOMAIN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| DOMAIN-SUFFIX | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| DOMAIN-KEYWORD | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| IP-CIDR | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GEOIP | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GEOSITE | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| PROCESS-NAME | ✅ | ✅ | ⚠️ | ✅ | ❌ | ❌ |
| RULE-SET | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SCRIPT | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |

Legend: ✅ Full support, ⚠️ Partial support, ❌ Not supported
