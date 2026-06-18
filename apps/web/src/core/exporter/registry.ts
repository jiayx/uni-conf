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

const exporters = new Map<ExportFormat, IExporter>()
exporters.set('mihomo', mihomoExporter)
exporters.set('clash', mihomoExporter) // same format
exporters.set('singbox', singboxExporter)
exporters.set('loon', loonExporter)
exporters.set('nodes_base64', nodeBase64Exporter)
exporters.set('nodes_raw', nodeRawExporter)

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
