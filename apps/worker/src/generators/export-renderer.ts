import type { DnsMode, ExportFormat } from '@uni-conf/types'
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

export interface RenderedExport {
  content: string
  contentType: string
}

export function renderExportData(
  data: ExportData,
  format: ExportFormat,
  options: { dnsMode?: DnsMode; ruleSetConversionBaseUrl?: string } = {}
): RenderedExport | null {
  const {
    nodes,
    groups,
    rules,
    remoteSets,
    nodeRows,
    groupRows,
    ruleRows,
    remoteSetRows,
    collectionNodeNames,
  } = data

  if (format === 'mihomo' || format === 'clash') {
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
