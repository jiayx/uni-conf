import { describe, expect, it } from 'vitest'
import { EXPORT_SUBSCRIPTION_FORMATS } from '@uni-conf/shared'
import type { ExportFormat, ProxyGroup, ProxyNode } from '@uni-conf/types'
import type { ExportData } from '../export-data'
import { renderExportData } from './export-renderer'

describe('renderExportData', () => {
  it('renders every public subscription format from the shared format list', () => {
    for (const format of EXPORT_SUBSCRIPTION_FORMATS) {
      const rendered = renderExportData(makeExportData(), format as ExportFormat)

      expect(rendered, `${format} should render`).not.toBeNull()
      expect(rendered?.content.trim().length, `${format} should not be empty`).toBeGreaterThan(0)
      expect(rendered?.contentType, `${format} should set content type`).toContain('charset=utf-8')
    }
  })

  it('serializes node-only subscription formats from the same node rows used by full configs', () => {
    const raw = renderExportData(makeExportData(), 'nodes_raw')
    const encoded = renderExportData(makeExportData(), 'nodes_base64')

    expect(raw?.content).toContain('ss://')
    expect(raw?.content).toContain('#Smoke%20SS')
    expect(Buffer.from(encoded?.content ?? '', 'base64').toString('utf8')).toBe(raw?.content)
  })
})

function makeExportData(): ExportData {
  const node = makeNode()
  const nodeRow = makeNodeRow()
  const group = makeGroup()
  const groupRow = makeGroupRow()

  return {
    nodeRows: [nodeRow],
    groupRows: [groupRow],
    ruleRows: [],
    remoteSetRows: [],
    sourceRows: [],
    sources: [],
    nodes: [node],
    groups: [group],
    rules: [],
    remoteSets: [],
    collectionNodeNames: {
      'collection-all': [node.name],
    },
  }
}

function makeNode(): ProxyNode {
  return {
    id: 'node-1',
    sourceId: 'source-1',
    name: 'Smoke SS',
    protocol: 'ss',
    server: 'smoke.example.com',
    port: 8388,
    country: 'United States',
    countryCode: 'US',
    enabled: true,
    tags: [],
    rawConfig: {},
    parsedConfig: {
      protocol: 'ss',
      server: 'smoke.example.com',
      port: 8388,
      password: 'password',
      extra: { cipher: 'aes-256-gcm' },
    },
    isManual: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeNodeRow(): Record<string, unknown> {
  const node = makeNode()
  return {
    id: node.id,
    source_id: node.sourceId,
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    port: node.port,
    country: node.country,
    country_code: node.countryCode,
    enabled: 1,
    tags: JSON.stringify(node.tags),
    raw_config: JSON.stringify(node.rawConfig),
    parsed_config: JSON.stringify(node.parsedConfig),
    is_manual: 0,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
  }
}

function makeGroup(): ProxyGroup {
  return {
    id: 'group-proxy',
    name: 'PROXY',
    type: 'select',
    collectionIds: ['collection-all'],
    groupIds: [],
    builtins: [],
    enabled: true,
    order: 0,
    isBuiltin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeGroupRow(): Record<string, unknown> {
  const group = makeGroup()
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    collection_ids: JSON.stringify(group.collectionIds),
    group_ids: JSON.stringify(group.groupIds),
    builtins: JSON.stringify(group.builtins),
    enabled: 1,
    sort_order: group.order,
    is_builtin: 1,
    created_at: group.createdAt,
    updated_at: group.updatedAt,
  }
}
