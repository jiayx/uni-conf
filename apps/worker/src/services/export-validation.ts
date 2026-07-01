import type { CompatibilityWarning, DnsMode, ExportFormat } from '@uni-conf/types';
import { getRuleCompatibilityLevel, isRuleSetFormatCompatible } from '@uni-conf/shared';
import type { ExportData } from '../export-data';
import { nodeToSubscriptionUri } from '../generators/node-subscription';
import { resolveRemoteRuleSetForExport } from '../generators/remote-rule-set-resolver';

interface ExportValidationOptions {
  dnsMode?: DnsMode;
}

export function validateExportData(
  data: ExportData,
  format: ExportFormat,
  options: ExportValidationOptions = {}
): CompatibilityWarning[] {
  return [
    ...validateExportReadiness(data, format),
    ...validateExportCompatibility(data, format, options),
  ];
}

export function resolveExportWarnings(
  data: ExportData,
  format: ExportFormat,
  options: { showCompatibilityWarnings: boolean } & ExportValidationOptions
): CompatibilityWarning[] {
  const readinessWarnings = validateExportReadiness(data, format);
  if (!options.showCompatibilityWarnings) return readinessWarnings;
  return [
    ...readinessWarnings,
    ...validateExportCompatibility(data, format, options),
  ];
}

export async function validateRemoteRuleSetReachability(
  data: ExportData,
  format: ExportFormat,
  options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {}
): Promise<CompatibilityWarning[]> {
  if (isNodeOnlyExportFormat(format)) return [];

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2500;
  const checks = data.remoteSets.flatMap((ruleSet) => {
    const resolved = resolveRemoteRuleSetForExport(ruleSet, format);
    if (!resolved || !isDownloadableHttpUrl(resolved.url) || !isRuleSetFormatCompatible(format, resolved.format)) return [];
    return [{ ruleSet, url: resolved.url }];
  });

  const results = await Promise.all(checks.map(async ({ ruleSet, url }): Promise<CompatibilityWarning | null> => {
    const reachable = await canFetchRemoteRuleSet(fetcher, url, timeoutMs);
    return reachable ? null : {
      client: format,
      level: 'unsupported',
      message: `远程规则集 "${ruleSet.name}" 当前无法下载，请检查规则集地址或稍后重试`,
      messageEn: `Remote rule set "${ruleSet.name}" cannot be downloaded right now. Check the rule set URL or retry later.`,
    } satisfies CompatibilityWarning;
  }));

  return results.filter((item): item is CompatibilityWarning => Boolean(item));
}

export function validateExportReadiness(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  if (isNodeOnlyExportFormat(format)) {
    return [
      ...validateSources(data, format),
      ...validateNodes(data, format),
    ];
  }

  return [
    ...validateSources(data, format),
    ...validateNodes(data, format),
    ...validateGroups(data, format),
    ...validateRuleTargets(data, format),
    ...validateRemoteRuleSetTargets(data, format),
    ...validateRemoteRuleSetUrls(data, format),
  ];
}

export function findEmptyNodeExportWarning(
  data: ExportData,
  format: ExportFormat
): CompatibilityWarning | null {
  return data.nodes.length === 0
    ? emptyNodeExportWarning(format)
    : null;
}

export function findBlockingNodeExportWarning(
  data: ExportData,
  format: ExportFormat
): CompatibilityWarning | null {
  const emptyWarning = findEmptyNodeExportWarning(data, format);
  if (emptyWarning) return emptyWarning;

  return hasRenderableNode(data, format)
    ? null
    : noSupportedNodeExportWarning(format);
}

export function validateExportCompatibility(
  data: ExportData,
  format: ExportFormat,
  options: ExportValidationOptions = {}
): CompatibilityWarning[] {
  if (isNodeOnlyExportFormat(format)) {
    return validateNodeCompatibility(data, format);
  }

  return [
    ...validateNodeCompatibility(data, format),
    ...validateRuleCompatibility(data, format),
    ...validateRemoteRuleSetCompatibility(data, format),
    ...validateDns(format, options.dnsMode),
  ];
}

function validateSources(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];

  for (const source of data.sources) {
    if (source.lastRefreshError) {
      warnings.push({
        client: format,
        level: 'unsupported',
        message: `订阅源 "${source.name}" 最近刷新失败：${source.lastRefreshError}`,
        messageEn: `Source "${source.name}" failed during the latest refresh: ${source.lastRefreshError}`,
      });
      continue;
    }

    if (!source.lastUpdated && source.nodeCount === 0) {
      warnings.push({
        client: format,
        level: 'partial',
        message: `订阅源 "${source.name}" 尚未成功刷新，当前导出不会包含这个来源的节点`,
        messageEn: `Source "${source.name}" has not refreshed successfully yet, so this export will not include nodes from it.`,
      });
    }
  }

  return warnings;
}

function validateNodes(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  if (data.nodes.length === 0) {
    warnings.push(emptyNodeExportWarning(format));
    return warnings;
  }
  if (!hasRenderableNode(data, format)) {
    warnings.push(noSupportedNodeExportWarning(format));
  }

  const counts = new Map<string, number>();
  for (const node of data.nodes) {
    counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    if (count <= 1) continue;
    warnings.push({
      client: format,
      level: 'partial',
      message: `节点名称 "${name}" 重复 ${count} 次，目标客户端可能只保留其中一个`,
      messageEn: `Node name "${name}" appears ${count} times. The target client may only keep one of them.`,
    });
  }
  return warnings;
}

function emptyNodeExportWarning(format: ExportFormat): CompatibilityWarning {
  return {
    client: format,
    level: 'unsupported',
    message: '没有可导出的节点，请先刷新订阅或检查节点过滤条件',
    messageEn: 'No nodes are available for export. Refresh subscriptions or check node filters.',
  };
}

function noSupportedNodeExportWarning(format: ExportFormat): CompatibilityWarning {
  return {
    client: format,
    level: 'unsupported',
    message: `没有可导出到 ${format} 的节点，当前节点协议均不受该客户端导出器支持`,
    messageEn: `No nodes can be exported to ${format}. All current node protocols are unsupported by this exporter.`,
  };
}

function validateGroups(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const groupIds = new Set(data.groups.map((group) => group.id));
  const nodeNames = supportedNodeNameSet(data, format);
  const warnings: CompatibilityWarning[] = [];
  for (const group of data.groups) {
    for (const childId of group.groupIds) {
      if (groupIds.has(childId)) continue;
      warnings.push({
        groupId: group.id,
        client: format,
        level: 'unsupported',
        message: `策略组 "${group.name}" 引用了不存在或未导出的策略组 ${childId}`,
        messageEn: `Policy group "${group.name}" references a missing or non-exported group ${childId}.`,
      });
    }

    for (const collectionId of group.collectionIds) {
      const memberNames = data.collectionNodeNames[collectionId] ?? [];
      if (memberNames.length === 0) {
        warnings.push({
          groupId: group.id,
          client: format,
          level: 'partial',
          message: `策略组 "${group.name}" 绑定的节点组 ${collectionId} 没有可导出的节点，导出时会回退到 DIRECT`,
          messageEn: `Policy group "${group.name}" uses node group ${collectionId}, but it has no exportable nodes. The export will fall back to DIRECT.`,
        });
        continue;
      }

      for (const nodeName of memberNames) {
        if (nodeNames.has(nodeName)) continue;
        warnings.push({
          groupId: group.id,
          client: format,
          level: 'unsupported',
          message: `策略组 "${group.name}" 引用了不存在或未导出的节点 "${nodeName}"`,
          messageEn: `Policy group "${group.name}" references missing or non-exported node "${nodeName}".`,
        });
      }
    }
  }
  return warnings;
}

function validateNodeCompatibility(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  if (isNodeOnlyExportFormat(format)) return validateNodeSubscriptionCompatibility(data, format);

  const warnings: CompatibilityWarning[] = [];
  for (const node of data.nodes) {
    if (isNodeProtocolSupportedByExport(node.protocol, format)) continue;
    warnings.push({
      nodeId: node.id,
      client: format,
      level: 'partial',
      message: `节点 "${node.name}" 使用的协议 ${node.protocol} 暂不支持导出到 ${format}，导出时会跳过`,
      messageEn: `Node "${node.name}" uses protocol ${node.protocol}, which is not currently supported by the ${format} exporter and will be skipped.`,
    });
  }
  return warnings;
}

function validateNodeSubscriptionCompatibility(
  data: ExportData,
  format: ExportFormat
): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  for (const row of data.nodeRows) {
    if (nodeToSubscriptionUri(row) !== null) continue;
    const id = String(row['id'] ?? '');
    const name = String(row['name'] ?? (id || 'Unknown'));
    const protocol = String(row['protocol'] ?? 'unknown');
    warnings.push({
      nodeId: id || undefined,
      client: format,
      level: 'partial',
      message: `节点 "${name}" 使用的协议 ${protocol} 无法转换为订阅 URI，导出时会跳过`,
      messageEn: `Node "${name}" uses protocol ${protocol}, which cannot be converted to a subscription URI and will be skipped.`,
    });
  }
  return warnings;
}

function supportedNodeNameSet(data: ExportData, format: ExportFormat): Set<string> {
  return new Set(
    data.nodes
      .filter((node) => isNodeProtocolSupportedByExport(node.protocol, format))
      .map((node) => node.name)
  );
}

function hasRenderableNode(data: ExportData, format: ExportFormat): boolean {
  if (isNodeOnlyExportFormat(format)) {
    return data.nodeRows.some((row) => nodeToSubscriptionUri(row) !== null);
  }
  return data.nodes.some((node) => isNodeProtocolSupportedByExport(node.protocol, format));
}

function isNodeProtocolSupportedByExport(protocol: string, format: ExportFormat): boolean {
  if (format === 'mihomo' || format === 'clash' || format === 'stash') {
    return MIHOMO_EXPORT_NODE_PROTOCOLS.has(protocol);
  }
  if (format === 'singbox') return SINGBOX_EXPORT_NODE_PROTOCOLS.has(protocol);
  if (format === 'nodes_base64' || format === 'nodes_raw') return NODE_SUBSCRIPTION_PROTOCOLS.has(protocol);
  return TEXT_CLIENT_EXPORT_NODE_PROTOCOLS.has(protocol);
}

function isNodeOnlyExportFormat(format: ExportFormat): boolean {
  return format === 'nodes_base64' || format === 'nodes_raw';
}

const MIHOMO_EXPORT_NODE_PROTOCOLS = new Set([
  'ss',
  'vmess',
  'vless',
  'trojan',
  'hysteria',
  'hysteria2',
  'tuic',
  'anytls',
  'socks5',
  'http',
  'https',
]);

const SINGBOX_EXPORT_NODE_PROTOCOLS = new Set([
  'ss',
  'vmess',
  'vless',
  'trojan',
  'hysteria',
  'hysteria2',
  'tuic',
  'anytls',
  'shadowtls',
  'ssh',
  'socks5',
  'http',
  'https',
  'wireguard',
]);

const TEXT_CLIENT_EXPORT_NODE_PROTOCOLS = new Set([
  'ss',
  'vmess',
  'trojan',
  'anytls',
  'socks5',
  'http',
  'https',
]);

const NODE_SUBSCRIPTION_PROTOCOLS = new Set([
  'ss',
  'vmess',
  'vless',
  'trojan',
  'hysteria2',
  'tuic',
  'anytls',
  'socks5',
]);

function validateRuleTargets(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const groupIds = new Set(data.groups.map((group) => group.id));
  const warnings: CompatibilityWarning[] = [];
  const enabledRules = [...data.rules].filter((rule) => rule.enabled).sort((a, b) => a.order - b.order);

  for (const rule of enabledRules) {
    if (!groupIds.has(rule.targetGroupId)) {
      warnings.push({
        ruleId: rule.id,
        client: format,
        level: 'unsupported',
        message: `规则 ${rule.type}${rule.payload ? `,${rule.payload}` : ''} 指向不存在或未导出的策略组 ${rule.targetGroupId}`,
        messageEn: `Rule ${rule.type}${rule.payload ? `,${rule.payload}` : ''} targets a missing or non-exported group ${rule.targetGroupId}.`,
      });
    }
  }

  return warnings;
}

function validateRuleCompatibility(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  const enabledRules = [...data.rules].filter((rule) => rule.enabled).sort((a, b) => a.order - b.order);

  for (const rule of enabledRules) {
    const compatibility = getExportRuleCompatibility(rule.type, format);
    if (compatibility === 'unsupported') {
      warnings.push({
        ruleId: rule.id,
        client: format,
        level: 'unsupported',
        message: `规则类型 ${rule.type} 不兼容 ${format}，导出时会跳过`,
        messageEn: `Rule type ${rule.type} is not supported by ${format} and will be skipped during export.`,
      });
    } else if (compatibility === 'partial' || compatibility === 'convert') {
      warnings.push({
        ruleId: rule.id,
        client: format,
        level: 'partial',
        message: `规则类型 ${rule.type} 在 ${format} 中只能部分兼容，导出时会按客户端能力降级`,
        messageEn: `Rule type ${rule.type} is only partially supported by ${format} and will be downgraded during export.`,
      });
    }
  }

  const matchIndex = enabledRules.findIndex((rule) => rule.type === 'MATCH');
  if (matchIndex !== -1 && matchIndex !== enabledRules.length - 1) {
    warnings.push({
      ruleId: enabledRules[matchIndex]?.id,
      client: format,
      level: 'partial',
      message: 'MATCH 规则不是最后一条，导出时会把 MATCH 放到最后',
      messageEn: 'MATCH rule is not last and will be moved to the end during export.',
    });
  }

  return warnings;
}

function getExportRuleCompatibility(
  ruleType: ExportData['rules'][number]['type'],
  format: ExportFormat
): 'full' | 'partial' | 'convert' | 'unsupported' {
  if (format === 'nodes_base64' || format === 'nodes_raw') return 'full';
  return getRuleCompatibilityLevel(ruleType, format);
}

function validateRemoteRuleSetTargets(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const groupIds = new Set(data.groups.map((group) => group.id));
  const warnings: CompatibilityWarning[] = [];
  for (const ruleSet of data.remoteSets) {
    if (!groupIds.has(ruleSet.targetGroupId)) {
      warnings.push({
        client: format,
        level: 'unsupported',
        message: `远程规则集 "${ruleSet.name}" 指向不存在或未导出的策略组 ${ruleSet.targetGroupId}`,
        messageEn: `Remote rule set "${ruleSet.name}" targets a missing or non-exported group ${ruleSet.targetGroupId}.`,
      });
    }
  }
  return warnings;
}

function validateRemoteRuleSetCompatibility(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  for (const ruleSet of data.remoteSets) {
    const resolved = resolveRemoteRuleSetForExport(ruleSet, format);
    if (!resolved || !isRuleSetFormatCompatible(format, resolved.format)) {
      warnings.push({
        client: format,
        level: 'partial',
        message: `远程规则集 "${ruleSet.name}" 的格式 ${ruleSet.presetSource === 'quixotic' ? '动态预置' : ruleSet.format} 不兼容 ${format}，导出时会跳过`,
        messageEn: `Remote rule set "${ruleSet.name}" is not compatible with ${format} and will be skipped during export.`,
      });
    }
  }
  return warnings;
}

function validateRemoteRuleSetUrls(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  for (const ruleSet of data.remoteSets) {
    const resolved = resolveRemoteRuleSetForExport(ruleSet, format);
    if (resolved && !isDownloadableHttpUrl(resolved.url)) {
      warnings.push({
        client: format,
        level: 'unsupported',
        message: `远程规则集 "${ruleSet.name}" 的 URL 不是可下载的 http(s) 地址`,
        messageEn: `Remote rule set "${ruleSet.name}" does not use a downloadable http(s) URL.`,
      });
    }
  }
  return warnings;
}

function validateDns(format: ExportFormat, dnsMode: DnsMode | undefined): CompatibilityWarning[] {
  if (!dnsMode || dnsMode === 'compatible' || supportsManagedDns(format)) return [];

  return [{
    client: format,
    level: 'partial',
    message: `当前客户端 ${format} 不支持完整导出 ${formatDnsMode(dnsMode)} DNS，导出时会按客户端能力降级或跳过 DNS 字段`,
    messageEn: `The ${format} export cannot fully include ${dnsMode} DNS settings. DNS fields will be downgraded or skipped during export.`,
  }];
}

function supportsManagedDns(format: ExportFormat): boolean {
  return format === 'mihomo' || format === 'clash' || format === 'singbox' || format === 'stash';
}

function formatDnsMode(dnsMode: DnsMode): string {
  if (dnsMode === 'smart') return '智能防污染';
  if (dnsMode === 'fake-ip') return '高级 fake-ip';
  return '兼容优先';
}

function isDownloadableHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function canFetchRemoteRuleSet(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const head = await fetchWithTimeout(fetcher, url, { method: 'HEAD' }, timeoutMs);
  if (isReachableResponse(head)) return true;
  if (head && ![405, 403, 501].includes(head.status)) return false;

  const get = await fetchWithTimeout(fetcher, url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
  }, timeoutMs);
  return isReachableResponse(get);
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isReachableResponse(response: Response | null): boolean {
  if (!response) return false;
  return response.status >= 200 && response.status < 400;
}
