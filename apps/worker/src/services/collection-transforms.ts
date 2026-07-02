import type { NodeCollection, NodeFilter, NodeRename, ProxyNode } from '@uni-conf/types';

export function applyCollectionTransforms(nodes: ProxyNode[], collection: NodeCollection): ProxyNode[] {
  return applySort(
    applyDedup(
      applyRenames(
        applyFilters(nodes, collection.filters),
        collection.renames
      ),
      collection.dedup
    ),
    collection.sort,
    collection.sortCountryOrder
  );
}

function applyFilters(nodes: ProxyNode[], filters: NodeFilter[]): ProxyNode[] {
  const enabledFilters = filters.filter((f) => f.enabled);
  if (enabledFilters.length === 0) return nodes;

  return nodes.filter((node) =>
    enabledFilters.every((filter) => matchesFilter(node, filter))
  );
}

const EMOJI_RE =
  /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F1E0}-\u{1F1FF}]/gu;

const COUNTRY_STANDARDIZE: Array<[RegExp, string]> = [
  [/🇭🇰|hong\s*kong|hongkong|\bHK\b/gi, '香港'],
  [/🇯🇵|japan|\bJP\b|tokyo/gi, '日本'],
  [/🇺🇸|united\s+states?|usa|\bUS\b|america/gi, '美国'],
  [/🇸🇬|singapore|\bSG\b/gi, '新加坡'],
  [/🇹🇼|taiwan|\bTW\b/gi, '台湾'],
  [/🇰🇷|korea|\bKR\b/gi, '韩国'],
  [/🇬🇧|united\s+kingdom|britain|england|\bGB\b|\bUK\b/gi, '英国'],
  [/🇩🇪|germany|german|\bDE\b/gi, '德国'],
  [/🇫🇷|france|\bFR\b/gi, '法国'],
  [/🇳🇱|netherlands|\bNL\b/gi, '荷兰'],
  [/🇦🇺|australia|\bAU\b/gi, '澳大利亚'],
  [/🇨🇦|canada|\bCA\b/gi, '加拿大'],
];

function applyRename(name: string, rename: NodeRename): string {
  if (!rename.enabled) return name;

  switch (rename.type) {
    case 'replace':
      return rename.pattern ? name.split(rename.pattern).join(rename.replacement ?? '') : name;
    case 'regex': {
      if (!rename.pattern) return name;
      try {
        return name.replace(new RegExp(rename.pattern, 'g'), rename.replacement ?? '');
      } catch {
        return name;
      }
    }
    case 'prefix':
      return (rename.replacement ?? '') + name;
    case 'suffix':
      return name + (rename.replacement ?? '');
    case 'strip_emoji':
      return name.replace(EMOJI_RE, '').trim();
    case 'standardize_country': {
      let result = name;
      for (const [pattern, replacement] of COUNTRY_STANDARDIZE) {
        result = result.replace(pattern, replacement);
      }
      return result.trim();
    }
    case 'auto_number':
    default:
      return name;
  }
}

function applyRenames(nodes: ProxyNode[], renames: NodeRename[]): ProxyNode[] {
  const enabledRenames = [...renames].sort((a, b) => a.order - b.order).filter((r) => r.enabled);
  const hasAutoNumber = enabledRenames.some((r) => r.type === 'auto_number');
  const nonAutoRenames = enabledRenames.filter((r) => r.type !== 'auto_number');

  const renamed = nodes.map((node) => ({
    ...node,
    name: nonAutoRenames.reduce((current, rename) => applyRename(current, rename), node.name),
  }));

  if (!hasAutoNumber) return renamed;

  const nameCount = new Map<string, number>();
  for (const node of renamed) {
    nameCount.set(node.name, (nameCount.get(node.name) ?? 0) + 1);
  }

  const nameIndex = new Map<string, number>();
  return renamed.map((node) => {
    const count = nameCount.get(node.name) ?? 1;
    if (count <= 1) return node;

    const idx = (nameIndex.get(node.name) ?? 0) + 1;
    nameIndex.set(node.name, idx);
    return { ...node, name: `${node.name} ${idx.toString().padStart(2, '0')}` };
  });
}

function getNodeFieldValue(node: ProxyNode, field: NodeFilter['field']): string | string[] {
  switch (field) {
    case 'name': return node.name;
    case 'server': return node.server;
    case 'protocol': return node.protocol;
    case 'country': return node.country ?? '';
    case 'countryCode': return node.countryCode ?? '';
    case 'tag': return node.tags;
    case 'sourceId': return node.sourceId;
    default: return '';
  }
}

function matchesFilter(node: ProxyNode, filter: NodeFilter): boolean {
  const fieldValue = getNodeFieldValue(node, filter.field);
  const filterValue = filter.value;
  const firstFilterValue = Array.isArray(filterValue) ? filterValue[0] : filterValue;
  if (firstFilterValue === undefined) return true;

  switch (filter.operator) {
    case 'contains': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      return val.toLowerCase().includes(pattern.toLowerCase());
    }
    case 'not_contains': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      return !val.toLowerCase().includes(pattern.toLowerCase());
    }
    case 'equals': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      return val === pattern;
    }
    case 'not_equals': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      return val !== pattern;
    }
    case 'regex': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      try { return new RegExp(pattern, 'i').test(val); } catch { return false; }
    }
    case 'not_regex': {
      const val = Array.isArray(fieldValue) ? fieldValue.join(' ') : fieldValue;
      const pattern = firstFilterValue;
      try { return !new RegExp(pattern, 'i').test(val); } catch { return true; }
    }
    case 'in': {
      const items = Array.isArray(filterValue) ? filterValue : [filterValue];
      if (Array.isArray(fieldValue)) {
        return fieldValue.some((v) => items.includes(v));
      }
      return items.includes(fieldValue);
    }
    case 'not_in': {
      const items = Array.isArray(filterValue) ? filterValue : [filterValue];
      if (Array.isArray(fieldValue)) {
        return !fieldValue.some((v) => items.includes(v));
      }
      return !items.includes(fieldValue);
    }
    default:
      return true;
  }
}

function applyDedup(
  nodes: ProxyNode[],
  strategy: NodeCollection['dedup']
): ProxyNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    let key: string;
    switch (strategy) {
      case 'name':
        key = node.name;
        break;
      case 'server_port':
        key = `${node.server}:${node.port}`;
        break;
      case 'protocol_server_port':
        key = `${node.protocol}:${node.server}:${node.port}`;
        break;
      case 'full_config':
        key = JSON.stringify(node.parsedConfig);
        break;
      default:
        key = node.id;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applySort(
  nodes: ProxyNode[],
  strategy: NodeCollection['sort'],
  countryOrder?: string[]
): ProxyNode[] {
  const sorted = [...nodes];
  switch (strategy) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'protocol':
      sorted.sort((a, b) => a.protocol.localeCompare(b.protocol));
      break;
    case 'source':
      sorted.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
      break;
    case 'country': {
      const order = countryOrder ?? [];
      sorted.sort((a, b) => {
        const ai = order.indexOf(a.countryCode ?? '');
        const bi = order.indexOf(b.countryCode ?? '');
        if (ai === -1 && bi === -1) {
          return (a.countryCode ?? '').localeCompare(b.countryCode ?? '');
        }
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      break;
    }
    case 'manual':
    default:
      break;
  }
  return sorted;
}
