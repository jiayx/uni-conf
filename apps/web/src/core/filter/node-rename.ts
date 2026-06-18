import type { ProxyNode, NodeRename } from '@uni-conf/types'

// Emoji regex (covers most emoji ranges)
const EMOJI_RE =
  /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F1E0}-\u{1F1FF}]/gu

// Country standardization map: normalize various representations to standard name
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
      let result = name
      for (const [pattern, replacement] of COUNTRY_STANDARDIZE) {
        result = result.replace(pattern, replacement)
      }
      return result.trim()
    }

    case 'auto_number':
      // auto_number is handled at the batch level in renameNodes
      return name

    default:
      return name
  }
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
