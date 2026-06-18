import type { ProxyNode, ProxyGroup, ProxyRule, RemoteRuleSet, ExportFormat, CompatibilityWarning } from '@uni-conf/types'

export interface ExportInput {
  nodes: ProxyNode[]
  groups: ProxyGroup[]
  rules: ProxyRule[]
  remoteSets: RemoteRuleSet[]
}

export interface IExporter {
  readonly name: string
  readonly format: ExportFormat
  readonly extension: string
  readonly contentType: string
  generate(input: ExportInput): string
  validate(input: ExportInput): CompatibilityWarning[]
}
