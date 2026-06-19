import type {
  ProxySource,
  ProxyNode,
  NodeCollection,
  ProxyGroup,
  ProxyRule,
  RemoteRuleSet,
  ExportConfig,
} from '@uni-conf/types';

// ─── Primitive helpers ────────────────────────────────────────────────────────

export function jsonParse<T>(text: string | null): T | null {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function jsonStringify(val: unknown): string {
  return JSON.stringify(val);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

// ─── Row mappers ──────────────────────────────────────────────────────────────

export function mapSource(row: Record<string, unknown>): ProxySource {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as ProxySource['type'],
    url: (row.url as string | null) ?? undefined,
    format: row.format as ProxySource['format'],
    enabled: Boolean(row.enabled),
    nodeCount: row.node_count as number,
    lastUpdated: (row.last_updated as string | null) ?? undefined,
    updateInterval: (row.update_interval as number | null) ?? undefined,
    userAgent: (row.user_agent as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    tags: jsonParse<string[]>(row.tags as string | null) ?? [],
    groups: jsonParse<ProxySource['groups']>(row.source_groups as string | null) ?? [],
    rawContent: (row.raw_content as string | null) ?? undefined,
    uploadBytes: (row.upload_bytes as number | null) ?? undefined,
    downloadBytes: (row.download_bytes as number | null) ?? undefined,
    totalBytes: (row.total_bytes as number | null) ?? undefined,
    expireTime: (row.expire_time as number | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapNode(row: Record<string, unknown>): ProxyNode {
  return {
    id: row.id as string,
    sourceId: row.source_id as string,
    name: row.name as string,
    protocol: row.protocol as ProxyNode['protocol'],
    server: row.server as string,
    port: row.port as number,
    country: (row.country as string | null) ?? undefined,
    countryCode: (row.country_code as string | null) ?? undefined,
    enabled: Boolean(row.enabled),
    tags: jsonParse<string[]>(row.tags as string | null) ?? [],
    notes: (row.notes as string | null) ?? undefined,
    rawConfig: jsonParse<Record<string, unknown>>(row.raw_config as string | null) ?? {},
    parsedConfig: jsonParse<ProxyNode['parsedConfig']>(row.parsed_config as string | null) ?? {
      protocol: 'unknown',
      server: row.server as string,
      port: row.port as number,
      extra: {},
    },
    isManual: Boolean(row.is_manual),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapCollection(row: Record<string, unknown>): NodeCollection {
  return {
    id: row.id as string,
    name: row.name as string,
    sourceIds: jsonParse<string[]>(row.source_ids as string | null) ?? [],
    nodeIds: jsonParse<string[]>(row.node_ids as string | null) ?? [],
    filters: jsonParse<NodeCollection['filters']>(row.filters as string | null) ?? [],
    renames: jsonParse<NodeCollection['renames']>(row.renames as string | null) ?? [],
    dedup: (row.dedup as NodeCollection['dedup']) ?? 'name',
    sort: (row.sort as NodeCollection['sort']) ?? 'country',
    sortCountryOrder: jsonParse<string[]>(row.sort_country_order as string | null) ?? undefined,
    enabled: Boolean(row.enabled),
    notes: (row.notes as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapGroup(row: Record<string, unknown>): ProxyGroup {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as ProxyGroup['type'],
    collectionIds: jsonParse<string[]>(row.collection_ids as string | null) ?? [],
    groupIds: jsonParse<string[]>(row.group_ids as string | null) ?? [],
    builtins: jsonParse<ProxyGroup['builtins']>(row.builtins as string | null) ?? [],
    testUrl: (row.test_url as string | null) ?? undefined,
    interval: (row.interval as number | null) ?? undefined,
    tolerance: (row.tolerance as number | null) ?? undefined,
    lazy: row.lazy !== null && row.lazy !== undefined ? Boolean(row.lazy) : undefined,
    enabled: Boolean(row.enabled),
    order: row.sort_order as number,
    isBuiltin: Boolean(row.is_builtin),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapRule(row: Record<string, unknown>): ProxyRule {
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? undefined,
    type: row.type as ProxyRule['type'],
    payload: row.payload as string,
    noResolve: Boolean(row.no_resolve),
    targetGroupId: row.target_group_id as string,
    enabled: Boolean(row.enabled),
    order: row.sort_order as number,
    notes: (row.notes as string | null) ?? undefined,
    compatibility: jsonParse<ProxyRule['compatibility']>(row.compatibility as string | null) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapRemoteRuleSet(row: Record<string, unknown>): RemoteRuleSet {
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    format: row.format as RemoteRuleSet['format'],
    targetGroupId: row.target_group_id as string,
    updateInterval: row.update_interval as number,
    enabled: Boolean(row.enabled),
    lastUpdated: (row.last_updated as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapExportConfig(row: Record<string, unknown>): ExportConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    format: row.format as ExportConfig['format'],
    token: row.token as string,
    enabled: Boolean(row.enabled),
    includeCollectionIds:
      jsonParse<string[]>(row.include_collection_ids as string | null) ?? [],
    includeGroupIds: jsonParse<string[]>(row.include_group_ids as string | null) ?? [],
    includeRuleIds: jsonParse<string[]>(row.include_rule_ids as string | null) ?? [],
    includeRemoteSetIds:
      jsonParse<string[]>(row.include_remote_set_ids as string | null) ?? [],
    extraConfig:
      jsonParse<Record<string, unknown>>(row.extra_config as string | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
