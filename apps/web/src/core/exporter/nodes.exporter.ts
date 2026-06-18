import type { CompatibilityWarning } from '@uni-conf/types'
import type { ExportInput, IExporter } from './exporter.interface'
import { nodeToUri } from './node-serializer'

export class NodeBase64Exporter implements IExporter {
  readonly name = 'Nodes (Base64)'
  readonly format = 'nodes_base64' as const
  readonly extension = 'txt'
  readonly contentType = 'text/plain'

  generate(input: ExportInput): string {
    const uris = input.nodes
      .map(nodeToUri)
      .filter((uri): uri is string => uri !== null)
      .join('\n')
    return btoa(uris)
  }

  validate(_input: ExportInput): CompatibilityWarning[] {
    return []
  }
}

export class NodeRawExporter implements IExporter {
  readonly name = 'Nodes (Raw)'
  readonly format = 'nodes_raw' as const
  readonly extension = 'txt'
  readonly contentType = 'text/plain'

  generate(input: ExportInput): string {
    return input.nodes
      .map(nodeToUri)
      .filter((uri): uri is string => uri !== null)
      .join('\n')
  }

  validate(_input: ExportInput): CompatibilityWarning[] {
    return []
  }
}
