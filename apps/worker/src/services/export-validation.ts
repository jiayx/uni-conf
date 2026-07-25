import type {
  CompatibilityWarning,
  DnsMode,
  ExportFormat,
  RemoteRuleSet,
  RemoteRuleSetValidationResult,
} from '@uni-conf/types';
import {
  getExportClientCapabilities,
  isEgernTransportSupported,
  isLoonTransportSupported,
  isNodeProtocolSupportedByExport,
  isRuleSetFormatCompatible,
  resolveRuleForExport,
  supportsRuleNoResolve,
  supportsManagedDnsMode,
  validateAndNormalizeRulePayload,
} from '@uni-conf/shared';
import type { ExportData } from '../export-data';
import { nodeToSubscriptionUri } from '../generators/node-subscription';
import { resolveRemoteRuleSetForExport } from '../generators/remote-rule-set-resolver';
import { isSafeRemoteHttpUrl, safeRemoteFetch } from './safe-remote-fetch';
import { resolveConvertibleRuleSetTarget } from './rule-set-conversion';
import { mapWithConcurrency } from './async-pool';
import { buildPrivateCacheKey } from './private-cache-key';

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

const RULE_SET_REACHABILITY_KV_TTL_SECONDS = 3600;
const RULE_SET_REACHABILITY_LIVE_CHECK_LIMIT = 6;

export async function validateRemoteRuleSetReachability(
  data: ExportData,
  format: ExportFormat,
  options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
    kv?: KVNamespace;
    kvTtlSeconds?: number;
    concurrency?: number;
    maxChecks?: number;
  } = {}
): Promise<CompatibilityWarning[]> {
  if (isNodeOnlyExportFormat(format)) return [];

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2500;
  const kv = options.kv;
  const kvTtlSeconds = options.kvTtlSeconds ?? RULE_SET_REACHABILITY_KV_TTL_SECONDS;
  const checks = data.remoteSets.flatMap((ruleSet, index) => {
    const resolved = resolveRemoteRuleSetForExport(ruleSet, format);
    const supported = resolved && (
      isRuleSetFormatCompatible(format, resolved.format)
      || resolveConvertibleRuleSetTarget(resolved.format, format) !== null
    );
    if (!resolved || !supported || !isDownloadableHttpUrl(resolved.url)) return [];
    return [{ ruleSet, url: resolved.url, index }];
  });

  const warningsByIndex = new Map<number, CompatibilityWarning>();
  const pendingChecks = checks.filter(({ ruleSet, url, index }) => {
    const health = findFreshSourceHealth(ruleSet, url);
    if (!health) return true;
    if (health.status === 'invalid') {
      warningsByIndex.set(index, sourceHealthWarning(format, ruleSet, health));
    }
    return false;
  });
  const maxChecks = Math.max(
    0,
    Math.floor(options.maxChecks ?? RULE_SET_REACHABILITY_LIVE_CHECK_LIMIT)
  );
  const selectedUrls = new Set<string>();
  const selectedChecks = pendingChecks.filter(({ url }) => {
    if (selectedUrls.has(url)) return true;
    if (selectedUrls.size >= maxChecks) return false;
    selectedUrls.add(url);
    return true;
  });
  const deferredCount = pendingChecks.length - selectedChecks.length;
  const inFlightByUrl = new Map<string, Promise<boolean>>();
  const results = await mapWithConcurrency(selectedChecks, options.concurrency ?? 6, async ({ ruleSet, url, index }): Promise<{
    index: number;
    warning: CompatibilityWarning | null;
  }> => {
    let reachability = inFlightByUrl.get(url);
    if (!reachability) {
      reachability = getCachedRuleSetReachability(kv, kvTtlSeconds, url, () =>
        canFetchRemoteRuleSet(fetcher, url, timeoutMs)
      );
      inFlightByUrl.set(url, reachability);
    }
    const reachable = await reachability;
    return {
      index,
      warning: reachable ? null : unreachableRuleSetWarning(format, ruleSet),
    };
  });

  for (const result of results) {
    if (result.warning) warningsByIndex.set(result.index, result.warning);
  }
  const warnings = [...warningsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, warning]) => warning);
  if (deferredCount > 0) {
    warnings.push({
      client: format,
      level: 'partial',
      message: `为控制预览等待时间，本次有 ${deferredCount} 个规则集未实时探测；自动刷新开启时后台健康检查会继续处理，也可在分流策略页手动检查`,
      messageEn: `${deferredCount} rule set${deferredCount === 1 ? ' was' : 's were'} deferred from live probing to keep preview latency bounded. Background health checks continue when automatic refresh is enabled, or you can check them manually on the Routing page.`,
      remediation: { target: 'remote-rule-sets' },
    });
  }
  return warnings;
}

function findFreshSourceHealth(
  ruleSet: RemoteRuleSet,
  url: string
): RemoteRuleSetValidationResult | undefined {
  const health = ruleSet.sourceHealth;
  if (
    !health
    || health.stale
    || !Number.isFinite(Date.parse(health.expiresAt))
    || Date.parse(health.expiresAt) <= Date.now()
  ) {
    return undefined;
  }
  if (health.defaultSource.url === url) return health.defaultSource;
  return health.sourceOverrides.find(item => item.result.url === url)?.result;
}

function sourceHealthWarning(
  format: ExportFormat,
  ruleSet: RemoteRuleSet,
  health: RemoteRuleSetValidationResult
): CompatibilityWarning {
  const issue = health.issues.find(item => item.severity === 'error') ?? health.issues[0];
  return {
    client: format,
    level: 'partial',
    message: `远程规则集 "${ruleSet.name}" 最近一次健康检查失败${issue ? `：${issue.message}` : ''}`,
    messageEn: `The latest health check failed for remote rule set "${ruleSet.name}"${issue ? `: ${issue.messageEn}` : '.'}`,
    remediation: { target: 'remote-rule-sets', id: ruleSet.id },
  };
}

function unreachableRuleSetWarning(
  format: ExportFormat,
  ruleSet: RemoteRuleSet
): CompatibilityWarning {
  return {
    client: format,
    level: 'partial',
    message: `远程规则集 "${ruleSet.name}" 当前无法下载，请检查规则集地址或稍后重试`,
    messageEn: `Remote rule set "${ruleSet.name}" cannot be downloaded right now. Check the rule set URL or retry later.`,
    remediation: { target: 'remote-rule-sets', id: ruleSet.id },
  };
}

/**
 * Rule set reachability only depends on an external URL, not on any UniConf data,
 * so a KV-cached result (unlike a rendered export) can never go stale in a way that
 * serves a user the wrong proxy config - worst case is a warning lagging by up to
 * kvTtlSeconds after a remote host recovers.
 */
async function getCachedRuleSetReachability(
  kv: KVNamespace | undefined,
  kvTtlSeconds: number,
  url: string,
  check: () => Promise<boolean>
): Promise<boolean> {
  if (!kv) return check();

  const key = await buildPrivateCacheKey('rule-set-reachable', 1, url);
  const cached = await kv.get(key);
  if (cached === 'true') return true;
  if (cached === 'false') return false;

  const reachable = await check();
  await kv.put(key, reachable ? 'true' : 'false', { expirationTtl: kvTtlSeconds });
  return reachable;
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
    ...validateRulePayloads(data, format),
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

export function findBlockingExportWarning(
  data: ExportData,
  format: ExportFormat
): CompatibilityWarning | null {
  const nodeWarning = findBlockingNodeExportWarning(data, format);
  if (nodeWarning) return nodeWarning;
  if (isNodeOnlyExportFormat(format)) return null;

  return [
    ...validateGroups(data, format),
    ...validateRuleTargets(data, format),
    ...validateRulePayloads(data, format),
    ...validateRemoteRuleSetTargets(data, format),
    ...validateRemoteRuleSetUrls(data, format),
  ].find((warning) => warning.level === 'unsupported') ?? null;
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
        remediation: { target: 'sources', id: source.id },
      });
      continue;
    }

    if (!source.lastUpdated && source.nodeCount === 0) {
      warnings.push({
        client: format,
        level: 'partial',
        message: `订阅源 "${source.name}" 尚未成功刷新，当前导出不会包含这个来源的节点`,
        messageEn: `Source "${source.name}" has not refreshed successfully yet, so this export will not include nodes from it.`,
        remediation: { target: 'sources', id: source.id },
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
      remediation: { target: 'nodes' },
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
    remediation: { target: 'sources' },
  };
}

function noSupportedNodeExportWarning(format: ExportFormat): CompatibilityWarning {
  return {
    client: format,
    level: 'unsupported',
    message: `没有可导出到 ${format} 的节点，当前节点协议均不受该客户端导出器支持`,
    messageEn: `No nodes can be exported to ${format}. All current node protocols are unsupported by this exporter.`,
    remediation: { target: 'nodes' },
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
        remediation: { target: 'groups', id: group.id },
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
          remediation: { target: 'groups', id: group.id },
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
          remediation: { target: 'groups', id: group.id },
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
    if (isNodeRenderableForFormat(node, format)) continue;
    if (
      format === 'loon'
      && isNodeProtocolSupportedByExport(node.protocol, format)
      && !isLoonTransportSupported(node.parsedConfig.network)
    ) {
      const transport = node.parsedConfig.network ?? 'unknown';
      warnings.push({
        nodeId: node.id,
        client: format,
        level: 'partial',
        message: `节点 "${node.name}" 使用的 ${node.protocol} 传输层 ${transport} 无法安全导出到 Loon，导出时会跳过`,
        messageEn: `Node "${node.name}" uses the ${transport} transport for ${node.protocol}, which cannot be safely exported to Loon and will be skipped.`,
        remediation: nodeRemediation(node),
      });
      continue;
    }
    if (
      format === 'egern'
      && isNodeProtocolSupportedByExport(node.protocol, format)
      && !isEgernTransportSupported(node.protocol, node.parsedConfig.network)
    ) {
      const transport = node.parsedConfig.network ?? 'unknown';
      warnings.push({
        nodeId: node.id,
        client: format,
        level: 'partial',
        message: `节点 "${node.name}" 使用的 ${node.protocol} 传输层 ${transport} 无法安全导出到 Egern，导出时会跳过`,
        messageEn: `Node "${node.name}" uses the ${transport} transport for ${node.protocol}, which cannot be safely exported to Egern and will be skipped.`,
        remediation: nodeRemediation(node),
      });
      continue;
    }
    warnings.push({
      nodeId: node.id,
      client: format,
      level: 'partial',
      message: `节点 "${node.name}" 使用的协议 ${node.protocol} 暂不支持导出到 ${format}，导出时会跳过`,
      messageEn: `Node "${node.name}" uses protocol ${node.protocol}, which is not currently supported by the ${format} exporter and will be skipped.`,
      remediation: nodeRemediation(node),
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
      remediation: nodeRowRemediation(row, id),
    });
  }
  return warnings;
}

function nodeRemediation(
  node: ExportData['nodes'][number]
): NonNullable<CompatibilityWarning['remediation']> {
  if (!node.isManual && node.sourceId && node.sourceId !== 'manual') {
    return { target: 'sources', id: node.sourceId };
  }
  return { target: 'nodes', id: node.id };
}

function nodeRowRemediation(
  row: Record<string, unknown>,
  id: string
): NonNullable<CompatibilityWarning['remediation']> {
  const sourceId = String(row['source_id'] ?? '');
  const isManual = Boolean(row['is_manual']) || sourceId === 'manual';
  if (!isManual && sourceId) return { target: 'sources', id: sourceId };
  return { target: 'nodes', ...(id ? { id } : {}) };
}

function supportedNodeNameSet(data: ExportData, format: ExportFormat): Set<string> {
  return new Set(
    data.nodes
      .filter((node) => isNodeRenderableForFormat(node, format))
      .map((node) => node.name)
  );
}

function hasRenderableNode(data: ExportData, format: ExportFormat): boolean {
  if (isNodeOnlyExportFormat(format)) {
    return data.nodeRows.some((row) => nodeToSubscriptionUri(row) !== null);
  }
  return data.nodes.some((node) => isNodeRenderableForFormat(node, format));
}

function isNodeRenderableForFormat(
  node: ExportData['nodes'][number],
  format: ExportFormat
): boolean {
  if (!isNodeProtocolSupportedByExport(node.protocol, format)) return false;
  if (
    format === 'loon'
    && ['vmess', 'vless', 'trojan'].includes(node.protocol)
  ) {
    return isLoonTransportSupported(node.parsedConfig.network);
  }
  if (
    format === 'egern'
    && ['vmess', 'vless', 'trojan'].includes(node.protocol)
  ) {
    return isEgernTransportSupported(node.protocol, node.parsedConfig.network);
  }
  return true;
}

function isNodeOnlyExportFormat(format: ExportFormat): boolean {
  return getExportClientCapabilities(format).outputKind === 'node-subscription';
}

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
        remediation: { target: 'rules', id: rule.id },
      });
    }
  }

  return warnings;
}

function validateRulePayloads(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  for (const rule of data.rules.filter((item) => item.enabled)) {
    const validation = validateAndNormalizeRulePayload(rule.type, rule.payload);
    if (validation.valid) continue;
    warnings.push({
      ruleId: rule.id,
      client: format,
      level: 'unsupported',
      message: `规则 ${rule.type}${rule.payload ? `,${rule.payload}` : ''} 的匹配内容无效：${validation.message}`,
      messageEn: `Rule ${rule.type}${rule.payload ? `,${rule.payload}` : ''} has an invalid payload: ${validation.message}.`,
      remediation: { target: 'rules', id: rule.id },
    });
  }
  return warnings;
}

function validateRuleCompatibility(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  const enabledRules = [...data.rules].filter((rule) => rule.enabled).sort((a, b) => a.order - b.order);

  for (const rule of enabledRules) {
    const resolution = resolveRuleForExport(rule.type, rule.payload, format);
    const compatibility = resolution.level;
    if (compatibility === 'unsupported') {
      warnings.push({
        code: 'rule-unsupported',
        ruleId: rule.id,
        client: format,
        level: 'unsupported',
        message: `规则 ${rule.type}${rule.payload ? `,${rule.payload}` : ''} 不兼容 ${format}，导出时会跳过`,
        messageEn: `Rule ${rule.type}${rule.payload ? `,${rule.payload}` : ''} is not supported by ${format} and will be skipped during export.`,
        remediation: { target: 'rules', id: rule.id },
        transformation: {
          resource: 'rule',
          action: 'skip',
          source: formatRuleDiagnostic(rule.type, rule.payload),
          reason: resolution.reason,
        },
      });
    } else if (compatibility === 'convert') {
      warnings.push({
        code: 'rule-converted',
        ruleId: rule.id,
        client: format,
        level: 'convert',
        message: `规则 ${rule.type},${rule.payload} 将等价转换为 ${resolution.type},${resolution.payload}`,
        messageEn: `Rule ${rule.type},${rule.payload} will be converted to the semantics-equivalent ${resolution.type},${resolution.payload}.`,
        remediation: { target: 'rules', id: rule.id },
        transformation: {
          resource: 'rule',
          action: 'convert',
          source: formatRuleDiagnostic(rule.type, rule.payload),
          target: formatRuleDiagnostic(resolution.type, resolution.payload),
          reason: resolution.reason,
        },
      });
    } else if (compatibility === 'partial') {
      warnings.push({
        code: 'rule-partial',
        ruleId: rule.id,
        client: format,
        level: 'partial',
        message: `规则类型 ${rule.type} 在 ${format} 中只能部分兼容，导出时会按客户端能力降级`,
        messageEn: `Rule type ${rule.type} is only partially supported by ${format} and will be downgraded during export.`,
        remediation: { target: 'rules', id: rule.id },
        transformation: {
          resource: 'rule',
          action: 'degrade',
          source: formatRuleDiagnostic(rule.type, rule.payload),
          target: formatRuleDiagnostic(resolution.type, resolution.payload),
          reason: resolution.reason,
        },
      });
    }
    if (rule.noResolve && !supportsRuleNoResolve(rule.type, format)) {
      warnings.push({
        code: 'rule-option-omitted',
        ruleId: rule.id,
        client: format,
        level: 'partial',
        message: `规则 ${rule.type},${rule.payload} 使用了 no-resolve，但 ${format} 对该规则没有语义等价选项；导出时会保留匹配条件并省略该选项`,
        messageEn: `Rule ${rule.type},${rule.payload} uses no-resolve, but ${format} has no semantics-equivalent option for this rule. The match is preserved and the option is omitted during export.`,
        remediation: { target: 'rules', id: rule.id },
        transformation: {
          resource: 'rule',
          action: 'omit-option',
          source: `${formatRuleDiagnostic(rule.type, rule.payload)},no-resolve`,
          target: formatRuleDiagnostic(resolution.type, resolution.payload),
          reason: 'unsupported-no-resolve',
        },
      });
    }
  }

  const matchIndex = enabledRules.findIndex((rule) => rule.type === 'MATCH');
  if (matchIndex !== -1 && matchIndex !== enabledRules.length - 1) {
    warnings.push({
      code: 'rule-reordered',
      ruleId: enabledRules[matchIndex]?.id,
      client: format,
      level: 'partial',
      message: 'MATCH 规则不是最后一条，导出时会把 MATCH 放到最后',
      messageEn: 'MATCH rule is not last and will be moved to the end during export.',
      remediation: { target: 'rules', id: enabledRules[matchIndex]?.id },
      transformation: {
        resource: 'rule',
        action: 'reorder',
        source: 'MATCH',
        target: 'MATCH',
        reason: 'final-rule-order',
      },
    });
  }

  return warnings;
}

function formatRuleDiagnostic(type: string, payload: string): string {
  return payload ? `${type},${payload}` : type;
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
        remediation: { target: 'remote-rule-sets', id: ruleSet.id },
      });
    }
  }
  return warnings;
}

function validateRemoteRuleSetCompatibility(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  for (const ruleSet of data.remoteSets) {
    const resolved = resolveRemoteRuleSetForExport(ruleSet, format);
    const conversionTarget = resolved
      ? resolveConvertibleRuleSetTarget(resolved.format, format)
      : null;
    if (conversionTarget) {
      warnings.push({
        code: 'remote-rule-set-conversion-planned',
        client: format,
        level: 'convert',
        message: `远程规则集 "${ruleSet.name}" 将从 ${resolved!.format} 自动转换为 ${conversionTarget}；预检会报告实际保留和跳过数量`,
        messageEn: `Remote rule set "${ruleSet.name}" will be converted from ${resolved!.format} to ${conversionTarget}; preflight reports the exact kept and skipped counts.`,
        remediation: { target: 'remote-rule-sets', id: ruleSet.id },
      });
    } else if (!resolved || !isRuleSetFormatCompatible(format, resolved.format)) {
      warnings.push({
        code: 'remote-rule-set-unsupported',
        client: format,
        level: 'partial',
        message: `远程规则集 "${ruleSet.name}" 的格式 ${ruleSet.presetSource === 'quixotic' ? '动态预置' : ruleSet.format} 不兼容 ${format}，导出时会跳过`,
        messageEn: `Remote rule set "${ruleSet.name}" is not compatible with ${format} and will be skipped during export.`,
        remediation: { target: 'remote-rule-sets', id: ruleSet.id },
        transformation: {
          resource: 'remote-rule-set',
          action: 'skip',
          source: `${ruleSet.name} (${resolved?.format ?? ruleSet.format})`,
          reason: 'unsupported-rule-set-format',
        },
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
        remediation: { target: 'remote-rule-sets', id: ruleSet.id },
      });
    }
  }
  return warnings;
}

function validateDns(format: ExportFormat, dnsMode: DnsMode | undefined): CompatibilityWarning[] {
  if (!dnsMode || supportsManagedDnsMode(format, dnsMode)) return [];

  return [{
    client: format,
    level: 'partial',
    message: `当前客户端 ${format} 不支持完整导出 ${formatDnsMode(dnsMode)} DNS，导出时会按客户端能力降级或跳过 DNS 字段`,
    messageEn: `The ${format} export cannot fully include ${dnsMode} DNS settings. DNS fields will be downgraded or skipped during export.`,
    remediation: { target: 'settings', section: 'dns' },
  }];
}

function formatDnsMode(dnsMode: DnsMode): string {
  if (dnsMode === 'smart') return '智能防污染';
  if (dnsMode === 'fake-ip') return '高级 fake-ip';
  return '兼容优先';
}

function isDownloadableHttpUrl(value: string): boolean {
  return isSafeRemoteHttpUrl(value);
}

async function canFetchRemoteRuleSet(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const startedAt = Date.now();
  const head = await fetchWithTimeout(fetcher, url, { method: 'HEAD' }, timeoutMs);
  if (isReachableResponse(head)) return true;
  if (head && ![405, 403, 501].includes(head.status)) return false;

  const remainingMs = timeoutMs - (Date.now() - startedAt);
  if (remainingMs <= 0) return false;
  const get = await fetchWithTimeout(fetcher, url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
  }, remainingMs);
  return isReachableResponse(get);
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response | null> {
  try {
    return await safeRemoteFetch(fetcher, url, init, { timeoutMs });
  } catch {
    return null;
  }
}

function isReachableResponse(response: Response | null): boolean {
  if (!response) return false;
  return response.status >= 200 && response.status < 400;
}
