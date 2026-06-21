import type { CompatibilityWarning, ExportFormat } from '@uni-conf/types';
import type { ExportData } from '../export-data';
import { resolveRemoteRuleSetForExport } from '../generators/remote-rule-set-resolver';

export function validateExportData(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  return [
    ...validateNodes(data, format),
    ...validateGroups(data, format),
    ...validateRules(data, format),
    ...validateRemoteRuleSets(data, format),
  ];
}

export function resolveExportWarnings(
  data: ExportData,
  format: ExportFormat,
  options: { showCompatibilityWarnings: boolean }
): CompatibilityWarning[] {
  return options.showCompatibilityWarnings ? validateExportData(data, format) : [];
}

function validateNodes(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const warnings: CompatibilityWarning[] = [];
  if (data.nodes.length === 0) {
    warnings.push({
      client: format,
      level: 'unsupported',
      message: '没有可导出的节点，请先刷新订阅或检查节点过滤条件',
      messageEn: 'No nodes are available for export. Refresh subscriptions or check node filters.',
    });
    return warnings;
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

function validateGroups(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const groupIds = new Set(data.groups.map((group) => group.id));
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
  }
  return warnings;
}

function validateRules(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
  const groupIds = new Set(data.groups.map((group) => group.id));
  const warnings: CompatibilityWarning[] = [];
  const enabledRules = [...data.rules].filter((rule) => rule.enabled).sort((a, b) => a.order - b.order);

  for (const rule of enabledRules) {
    if (groupIds.has(rule.targetGroupId)) continue;
    warnings.push({
      ruleId: rule.id,
      client: format,
      level: 'unsupported',
      message: `规则 ${rule.type}${rule.payload ? `,${rule.payload}` : ''} 指向不存在或未导出的策略组 ${rule.targetGroupId}`,
      messageEn: `Rule ${rule.type}${rule.payload ? `,${rule.payload}` : ''} targets a missing or non-exported group ${rule.targetGroupId}.`,
    });
  }

  const matchIndex = enabledRules.findIndex((rule) => rule.type === 'MATCH');
  if (matchIndex === -1) {
    warnings.push({
      client: format,
      level: 'partial',
      message: '缺少 MATCH 兜底规则，导出时已自动补到最后',
      messageEn: 'MATCH fallback rule is missing and will be appended during export.',
    });
  } else if (matchIndex !== enabledRules.length - 1) {
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

function validateRemoteRuleSets(data: ExportData, format: ExportFormat): CompatibilityWarning[] {
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

    const resolved = resolveRemoteRuleSetForExport(ruleSet, format);
    if (!resolved || !isRemoteRuleSetFormatCompatible(format, resolved.format)) {
      warnings.push({
        client: format,
        level: 'partial',
        message: `远程规则集 "${ruleSet.name}" 的格式 ${ruleSet.presetSource === 'quixotic' ? '动态预置' : ruleSet.format} 不兼容 ${format}，导出时会跳过`,
        messageEn: `Remote rule set "${ruleSet.name}" is not compatible with ${format} and will be skipped during export.`,
      });
    }

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

function isRemoteRuleSetFormatCompatible(format: ExportFormat, ruleSetFormat: string): boolean {
  const matrix: Partial<Record<ExportFormat, string[]>> = {
    mihomo: ['mihomo', 'clash', 'stash', 'text'],
    clash: ['mihomo', 'clash', 'stash', 'text'],
    singbox: ['singbox'],
    loon: ['loon', 'surge', 'shadowrocket', 'text'],
    surge: ['surge', 'text'],
    shadowrocket: ['shadowrocket', 'surge', 'text'],
    quantumultx: ['quantumultx', 'text'],
    stash: ['stash', 'mihomo', 'clash', 'text'],
    egern: ['egern', 'text'],
  };
  return matrix[format]?.includes(ruleSetFormat) ?? false;
}

function isDownloadableHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
