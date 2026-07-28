import type {
  CompatibilityWarning,
  ExportFormat,
} from '@uni-conf/types';
import {
  getExportClientCapabilities,
  getRuleSetConversionTargetFormat,
  isEgernTransportSupported,
  isLoonTransportSupported,
  isNodeProtocolSupportedByExport,
  isRuleSetFormatCompatible,
  resolveRuleForExport,
  supportsRuleNoResolve,
  validateAndNormalizeRulePayload,
} from '@uni-conf/shared';
import type { ExportData } from '../export-data';
import { nodeToSubscriptionUri } from '../generators/node-subscription';
import { resolveRemoteRuleSetForExport } from '../generators/remote-rule-set-resolver';
import { isSafeRemoteHttpUrl } from './safe-remote-fetch';

export function validateExportData(
  data: ExportData,
  format: ExportFormat
): CompatibilityWarning[] {
  return [
    ...validateExportReadiness(data, format),
    ...validateExportCompatibility(data, format),
  ];
}

export function resolveExportWarnings(
  data: ExportData,
  format: ExportFormat,
  options: { showCompatibilityWarnings: boolean }
): CompatibilityWarning[] {
  const readinessWarnings = validateExportReadiness(data, format);
  if (!options.showCompatibilityWarnings) return readinessWarnings;
  return [
    ...readinessWarnings,
    ...validateExportCompatibility(data, format),
  ];
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
  format: ExportFormat
): CompatibilityWarning[] {
  if (isNodeOnlyExportFormat(format)) {
    return validateNodeCompatibility(data, format);
  }

  return [
    ...validateNodeCompatibility(data, format),
    ...validateRuleCompatibility(data, format),
    ...validateRemoteRuleSetCompatibility(data, format),
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
        remediation: groupRemediation(group),
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
          remediation: groupRemediation(group),
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
          remediation: groupRemediation(group),
        });
      }
    }
  }
  return warnings;
}

function groupRemediation(
  group: ExportData['groups'][number]
): NonNullable<CompatibilityWarning['remediation']> {
  return group.isBuiltin
    ? { target: 'groups' }
    : { target: 'groups', id: group.id };
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
    const convertible = resolved
      ? getRuleSetConversionTargetFormat(resolved.format, format) !== null
      : false;
    if (!convertible && (!resolved || !isRuleSetFormatCompatible(format, resolved.format))) {
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

function isDownloadableHttpUrl(value: string): boolean {
  return isSafeRemoteHttpUrl(value);
}
