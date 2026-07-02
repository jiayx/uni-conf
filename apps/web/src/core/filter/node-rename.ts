import type { ProxyNode, NodeRename } from '@uni-conf/types'

// Emoji regex (covers most emoji ranges)
const EMOJI_RE =
  /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F1E0}-\u{1F1FF}]/gu

// Country standardization map: normalize various representations to standard name
const COUNTRY_STANDARDIZE: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /🇭🇰|香港|hong\s*kong|hongkong|\bHK\b/gi, replacement: '香港' },
  { pattern: /🇯🇵|日本|japan|\bJP\b|tokyo/gi, replacement: '日本' },
  { pattern: /🇺🇸|美国|united\s+states?|usa|\bUS\b|america/gi, replacement: '美国' },
  { pattern: /🇸🇬|新加坡|singapore|\bSG\b/gi, replacement: '新加坡' },
  { pattern: /🇹🇼|台湾|taiwan|\bTW\b/gi, replacement: '台湾' },
  { pattern: /🇰🇷|韩国|korea|\bKR\b/gi, replacement: '韩国' },
  { pattern: /🇬🇧|英国|united\s+kingdom|britain|england|\bGB\b|\bUK\b/gi, replacement: '英国' },
  { pattern: /🇩🇪|德国|germany|german|\bDE\b/gi, replacement: '德国' },
  { pattern: /🇫🇷|法国|france|\bFR\b/gi, replacement: '法国' },
  { pattern: /🇳🇱|荷兰|netherlands|\bNL\b/gi, replacement: '荷兰' },
  { pattern: /🇦🇺|澳大利亚|australia|\bAU\b/gi, replacement: '澳大利亚' },
  { pattern: /🇨🇦|加拿大|canada|\bCA\b/gi, replacement: '加拿大' },
]

export function applyRename(name: string, rename: NodeRename): string {
  if (!rename.enabled) return name

  switch (rename.type) {
    case 'replace': {
      if (!rename.pattern) return name
      return name.split(rename.pattern).join(rename.replacement ?? '')
    }

    case 'regex': {
      if (!rename.pattern) return name
      try {
        const re = new RegExp(rename.pattern, 'g')
        return name.replace(re, rename.replacement ?? '')
      } catch {
        return name
      }
    }

    case 'prefix':
      return (rename.replacement ?? '') + name

    case 'suffix':
      return name + (rename.replacement ?? '')

    case 'strip_emoji':
      return name.replace(EMOJI_RE, '').trim()

    case 'standardize_country': {
      return standardizeCountryName(name)
    }

    case 'auto_number':
      // auto_number is handled at the batch level in renameNodes
      return name

    default:
      return name
  }
}

function standardizeCountryName(name: string): string {
  let result = name
  for (const { pattern, replacement } of COUNTRY_STANDARDIZE) {
    pattern.lastIndex = 0
    if (!pattern.test(result)) continue
    result = `${replacement} ${result.replace(pattern, ' ')}`
  }
  return result.replace(/\s+/g, ' ').trim()
}

export function applyRenames(name: string, renames: NodeRename[]): string {
  const sorted = [...renames].sort((a, b) => a.order - b.order)
  return sorted
    .filter((r) => r.enabled && r.type !== 'auto_number')
    .reduce((current, rename) => applyRename(current, rename), name)
}

export function renameNodes(nodes: ProxyNode[], renames: NodeRename[]): ProxyNode[] {
  const enabledRenames = [...renames].sort((a, b) => a.order - b.order).filter((r) => r.enabled)
  const hasAutoNumber = enabledRenames.some((r) => r.type === 'auto_number')
  const nonAutoRenames = enabledRenames.filter((r) => r.type !== 'auto_number')

  // Apply all non-auto_number renames first
  const renamed = nodes.map((node) => {
    const newName = nonAutoRenames.reduce((n, rename) => applyRename(n, rename), node.name)
    return { ...node, name: newName }
  })

  if (!hasAutoNumber) return renamed

  // Group by base name to find duplicates, then number them
  const nameCount = new Map<string, number>()
  for (const node of renamed) {
    nameCount.set(node.name, (nameCount.get(node.name) ?? 0) + 1)
  }

  const nameIndex = new Map<string, number>()
  return renamed.map((node) => {
    const count = nameCount.get(node.name) ?? 1
    if (count <= 1) return node

    const idx = (nameIndex.get(node.name) ?? 0) + 1
    nameIndex.set(node.name, idx)
    const paddedIdx = idx.toString().padStart(2, '0')
    return { ...node, name: `${node.name} ${paddedIdx}` }
  })
}
