import type { ExportFormat } from '@uni-conf/types'
import type { IExporter } from './exporter.interface'
import { MihomoExporter } from './mihomo.exporter'
import { SingboxExporter } from './singbox.exporter'
import { LoonExporter } from './loon.exporter'
import { NodeBase64Exporter, NodeRawExporter } from './nodes.exporter'

const mihomoExporter = new MihomoExporter()
const singboxExporter = new SingboxExporter()
const loonExporter = new LoonExporter()
const nodeBase64Exporter = new NodeBase64Exporter()
const nodeRawExporter = new NodeRawExporter()

const exporters: Map<ExportFormat, IExporter> = new Map([
  ['mihomo', mihomoExporter],
  ['clash', mihomoExporter], // same format
  ['singbox', singboxExporter],
  ['loon', loonExporter],
  ['nodes_base64', nodeBase64Exporter],
  ['nodes_raw', nodeRawExporter],
])

export function getExporter(format: ExportFormat): IExporter | undefined {
  return exporters.get(format)
}

export function getAllExporters(): IExporter[] {
  // Return unique exporters (no duplicates for clash/mihomo)
  const seen = new Set<IExporter>()
  const result: IExporter[] = []
  for (const exporter of exporters.values()) {
    if (!seen.has(exporter)) {
      seen.add(exporter)
      result.push(exporter)
    }
  }
  return result
}
