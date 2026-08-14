import type { ExportDnsPolicy, ExportFormat } from '@uni-conf/types'
import type { ExportData } from '../export-data'
import { generateMihomoYaml } from './mihomo'
import { generateSingboxJson } from './singbox'
import { generateLoon } from './loon'
import { generateNodeSubscriptionBase64, generateNodeSubscriptionRaw } from './node-subscription'
import {
  generateEgern,
  generateQuantumultX,
  generateShadowrocket,
  generateStashYaml,
  generateSurge,
} from './client-configs'
import { sanitizeExportLabel } from '@uni-conf/shared'

export interface RenderedExport {
  content: string
  contentType: string
}

/** A normalized, immutable boundary between D1-backed export data and serializers. */
export type ExportIntermediateRepresentation = ExportData

export function materializeExportIntermediateRepresentation(data: ExportData): ExportIntermediateRepresentation {
  return {
    ...data,
    nodeRows: data.nodeRows.map((row) => ({
      ...row,
      name: sanitizeExportLabel(row.name),
      parsed_config: parseExportRecord(row.parsed_config),
      raw_config: parseExportRecord(row.raw_config),
    })),
    groupRows: data.groupRows.map((row) => ({ ...row, name: sanitizeExportLabel(row.name) })),
    remoteSetRows: data.remoteSetRows.map((row) => ({ ...row, name: sanitizeExportLabel(row.name) })),
    nodes: data.nodes.map((node) => ({ ...node, name: sanitizeExportLabel(node.name) })),
    groups: data.groups.map((group) => ({ ...group, name: sanitizeExportLabel(group.name) })),
    remoteSets: data.remoteSets.map((ruleSet) => ({ ...ruleSet, name: sanitizeExportLabel(ruleSet.name) })),
    collectionNodeNames: Object.fromEntries(
      Object.entries(data.collectionNodeNames).map(([id, names]) => [id, names.map(sanitizeExportLabel)]),
    ),
  }
}

function parseExportRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function renderExportData(
  data: ExportData,
  format: ExportFormat,
  options: {
    dnsPolicy?: ExportDnsPolicy
    managedRealIpDomains?: string[]
    ruleSetConversionBaseUrl?: string
  } = {},
): RenderedExport | null {
  const ir = materializeExportIntermediateRepresentation(data)
  const { nodes, groups, rules, remoteSets, nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames } = ir

  if (format === 'mihomo') {
    return {
      content: generateMihomoYaml(nodes, groups, rules, remoteSets, collectionNodeNames, {
        ...options,
        ruleSetExportFormat: format,
      }),
      contentType: 'text/yaml; charset=utf-8',
    }
  }
  if (format === 'singbox') {
    return {
      content: generateSingboxJson(nodes, groups, rules, remoteSets, collectionNodeNames, options),
      contentType: 'application/json; charset=utf-8',
    }
  }
  if (format === 'loon') {
    return {
      content: generateLoon(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames, options),
      contentType: 'text/plain; charset=utf-8',
    }
  }
  if (format === 'surge') {
    return {
      content: generateSurge(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames, options),
      contentType: 'text/plain; charset=utf-8',
    }
  }
  if (format === 'shadowrocket') {
    return {
      content: generateShadowrocket(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames, options),
      contentType: 'text/plain; charset=utf-8',
    }
  }
  if (format === 'quantumultx') {
    return {
      content: generateQuantumultX(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames, options),
      contentType: 'text/plain; charset=utf-8',
    }
  }
  if (format === 'stash') {
    return {
      content: generateStashYaml(nodes, groups, rules, remoteSets, collectionNodeNames, options),
      contentType: 'text/yaml; charset=utf-8',
    }
  }
  if (format === 'egern') {
    return {
      content: generateEgern(nodeRows, groupRows, ruleRows, remoteSetRows, collectionNodeNames, options),
      contentType: 'text/yaml; charset=utf-8',
    }
  }
  if (format === 'nodes_base64') {
    return {
      content: generateNodeSubscriptionBase64(nodeRows),
      contentType: 'text/plain; charset=utf-8',
    }
  }
  if (format === 'nodes_raw') {
    return {
      content: generateNodeSubscriptionRaw(nodeRows),
      contentType: 'text/plain; charset=utf-8',
    }
  }

  return null
}
