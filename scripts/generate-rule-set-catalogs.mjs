import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const prettierOptions = (await resolveConfig(root)) ?? {}
const definitionPath = resolve(root, 'resources/rule-set-catalogs.json')
const definitionRoot = dirname(definitionPath)
const outputDirectory = resolve(root, 'apps/worker/src/generated/rule-set-catalogs')
const definitionIndex = JSON.parse(await readFile(definitionPath, 'utf8'))

if (definitionIndex.schemaVersion !== 1 || !Array.isArray(definitionIndex.catalogFiles)) {
  throw new Error('resources/rule-set-catalogs.json has an unsupported schema')
}
const definitions = await Promise.all(
  definitionIndex.catalogFiles.map(async (path) => {
    if (!isCatalogFilePath(path)) throw new Error(`Unsupported catalog definition path: ${path}`)
    return JSON.parse(await readFile(resolve(definitionRoot, path), 'utf8'))
  }),
)

const catalogs = []
for (const definition of definitions) {
  catalogs.push(await scanCatalog(definition))
}
const bundledCatalogs = catalogs
  .map((catalog) => ({
    ...catalog,
    items: catalog.items.filter((item) => item.provisioning !== 'optional'),
  }))
  .filter((catalog) => catalog.items.length > 0)

const generatedAt = new Date().toISOString()
const compactCatalogs = bundledCatalogs.map(compactRuleSetCatalog)
const formattedSnapshots = await Promise.all(
  compactCatalogs.map((catalog) => format(JSON.stringify(catalog), { ...prettierOptions, parser: 'json' })),
)
const definitionImports = definitionIndex.catalogFiles
  .map((path, index) => `import definition${index} from '../../../../../resources/${path}'`)
  .join('\n')
const definitionReferences = definitions.map((_, index) => `definition${index}`).join(', ')
const definitionsSource = await format(
  `${definitionImports}

export const bundledRuleSetCatalogDefinitions = [${definitionReferences}] as const
`,
  { ...prettierOptions, parser: 'typescript' },
)
const imports = bundledCatalogs
  .map((catalog, index) => `import catalog${index} from './${catalog.id}.snapshot.json'`)
  .join('\n')
const catalogReferences = bundledCatalogs
  .map((_, index) => `expandRuleSetCatalog(catalog${index} as CompactRuleSetCatalog)`)
  .join(', ')
const indexSource = await format(
  `${imports}
import type {
  RemoteRuleSetSourceOverrideTarget,
  RuleSetBehavior,
  RuleSetCatalog,
  RuleSetCatalogSnapshot,
  RuleSetFormat,
  UnmatchedTrafficPolicy,
} from '@uni-conf/types'

type CompactRuleSetCatalog = {
  id: string
  name: string
  repository: {
    url: string
    branch: string
    commit?: string
  }
  syncedAt: string
  sourceProfiles: Record<string, {
    urlTemplate: string
    format: RuleSetFormat
    behavior: RuleSetBehavior
    nativeTargets: RemoteRuleSetSourceOverrideTarget[]
  }>
  defaultSourceSet: string
  sourceSets: Record<string, {
    defaultSource: string
    sources: string[]
  }>
  routingGroups: Array<{
    sourceSet?: string
    routing: {
      category?: string
      target?: string
      provisioning?: 'foundation' | 'scenario' | 'optional'
      order?: number
      activeForUnmatchedPolicies?: UnmatchedTrafficPolicy[]
    }
    rules: Array<string | {
      id: string
      name?: string
      sourceSet?: string
    }>
  }>
}

export const bundledRuleSetCatalogSnapshot = {
  schemaVersion: 1,
  generatedAt: ${JSON.stringify(generatedAt)},
  catalogs: [${catalogReferences}],
} as RuleSetCatalogSnapshot

function expandRuleSetCatalog(catalog: CompactRuleSetCatalog): RuleSetCatalog {
  return {
    id: catalog.id,
    name: catalog.name,
    repositoryUrl: catalog.repository.url,
    branch: catalog.repository.branch,
    commitSha: catalog.repository.commit,
    syncedAt: catalog.syncedAt,
    items: catalog.routingGroups.flatMap(group =>
      group.rules.map(rule => {
        const ruleSet = typeof rule === 'string' ? { id: rule } : rule
        const sourceSetId = ruleSet.sourceSet ?? group.sourceSet ?? catalog.defaultSourceSet
        const sourceSet = catalog.sourceSets[sourceSetId]!
        return {
          id: ruleSet.id,
          name: ruleSet.name ?? ruleSet.id,
          category: group.routing.category,
          suggestedTarget: group.routing.target,
          provisioning: group.routing.provisioning,
          sortOrder: group.routing.order,
          activeForUnmatchedPolicies: group.routing.activeForUnmatchedPolicies,
          sources: sourceSet.sources.map(sourceId => {
          const { urlTemplate, nativeTargets, ...profile } = catalog.sourceProfiles[sourceId]!
          return {
            ...profile,
            sourceId,
            url: urlTemplate.replace('{id}', encodeURIComponent(ruleSet.id)),
              default: sourceId === sourceSet.defaultSource,
            nativeFor: nativeTargets,
          }
        }),
        }
      })),
  }
}
`,
  { ...prettierOptions, parser: 'typescript' },
)

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
await writeFile(resolve(outputDirectory, 'definitions.ts'), definitionsSource)
for (const [index, catalog] of bundledCatalogs.entries()) {
  await writeFile(resolve(outputDirectory, `${catalog.id}.snapshot.json`), formattedSnapshots[index])
}
await writeFile(resolve(outputDirectory, 'index.ts'), indexSource)
console.log(
  `Scanned ${catalogs.length} catalogs with ${catalogs.reduce((sum, item) => sum + item.items.length, 0)} rule sets; ` +
    `bundled ${bundledCatalogs.length} catalogs with ${bundledCatalogs.reduce((sum, item) => sum + item.items.length, 0)} managed rule sets`,
)

function isCatalogFilePath(value) {
  return typeof value === 'string' && /^rule-set-catalogs\/[A-Za-z0-9._-]+\.json$/.test(value)
}

async function scanCatalog(definition) {
  const repository = parseRepository(definition.repositoryUrl)
  const branch = definition.branch || 'main'
  const itemMap = new Map()
  const commit = await githubJson(
    `https://api.github.com/repos/${repository.owner}/${repository.name}/branches/${encodeURIComponent(branch)}`,
  )

  for (const source of definition.sources) {
    const sourceRepository = parseRepository(source.repositoryUrl ?? definition.repositoryUrl)
    const sourceBranch = source.branch ?? branch
    const entries = await listContentsEntries(sourceRepository, sourceBranch, source.path)
    if (entries.length === 0) throw new Error(`${definition.id}:${source.path} does not contain files`)
    for (const entry of entries) {
      const candidate = createEntryCandidate(source, entry)
      if (!candidate) continue
      const id = normalizeItemId(candidate.id)
      if (!id) continue
      if (definition.ignoredIds?.includes(id)) continue
      const item = itemMap.get(id) ?? createItem(definition, id, candidate.name)
      item.sources.push(createSource(definition, source, candidate.path))
      itemMap.set(id, item)
    }
  }

  for (const [id, override] of Object.entries(definition.overrides ?? {})) {
    if (definition.ignoredIds?.includes(id)) continue
    const existing = itemMap.get(id)
    if (!existing && !override.sources?.length) continue
    const item = existing ?? createItem(definition, id)
    if (override.name) item.name = override.name
    for (const source of override.sources ?? []) {
      appendSource(item, createOverrideSource(source))
    }
    itemMap.set(id, item)
  }

  const items = [...itemMap.values()]
    .map((item) => ensureDefaultSource(item))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
  if (items.length === 0) throw new Error(`${definition.id} did not produce any rule sets`)

  return {
    id: definition.id,
    name: definition.name,
    repositoryUrl: definition.repositoryUrl,
    branch,
    commitSha: commit.commit?.sha,
    syncedAt: new Date().toISOString(),
    items,
  }
}

function createItem(definition, id, name = humanize(id)) {
  const mapping = definition.mappings.find(
    (candidate) => candidate.ids?.includes(id) || matchesAny(id, candidate.match),
  )
  const values = { ...definition.defaults, ...mapping }
  return {
    id,
    name,
    category: values.category,
    suggestedTarget: values.provisioning === 'optional' ? undefined : values.target,
    provisioning: values.provisioning,
    sortOrder: values.sortOrder,
    activeForUnmatchedPolicies: values.activeForUnmatchedPolicies,
    sources: [],
  }
}

async function listContentsEntries(repository, branch, path) {
  const contents = await githubJson(
    `https://api.github.com/repos/${repository.owner}/${repository.name}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
  )
  return Array.isArray(contents) ? contents : contents?.type === 'file' ? [contents] : []
}

function createEntryCandidate(source, entry) {
  if (entry.type !== 'file' || typeof entry.name !== 'string' || typeof entry.path !== 'string') return null
  if (!matchesAny(entry.name, source.include)) return null
  const filename = stripExtension(entry.name)
  if (!filename) return null
  return {
    id: filename,
    name: filename,
    path: entry.path,
  }
}

function createSource(definition, source, path) {
  const repositoryUrl = source.repositoryUrl ?? definition.repositoryUrl
  const branch = source.branch ?? definition.branch
  return {
    sourceId: source.id,
    url: rawUrl(repositoryUrl, branch, path),
    format: source.format,
    behavior: source.behavior,
    default: source.default ?? source.id === definition.defaultSourceId,
    nativeFor: source.nativeFor ?? [],
  }
}

function ensureDefaultSource(item) {
  if (!item.sources.some((source) => source.default) && item.sources[0]) {
    item.sources[0].default = true
  }
  item.sources = item.sources.filter((source) => source.default || source.nativeFor.length > 0)
  return item
}

function appendSource(item, source) {
  if (source.default) {
    for (const existing of item.sources) existing.default = false
  }
  item.sources.push(source)
}

function compactRuleSetCatalog(catalog) {
  const sourceProfiles = {}
  const sourceSetByKey = new Map()
  const descriptors = catalog.items.map((item) => {
    for (const source of item.sources) {
      const profile = {
        urlTemplate: createUrlTemplate(source.url, item.id),
        format: source.format,
        behavior: source.behavior,
        nativeTargets: source.nativeFor,
      }
      const existingProfile = sourceProfiles[source.sourceId]
      if (existingProfile && JSON.stringify(existingProfile) !== JSON.stringify(profile)) {
        throw new Error(`${catalog.id}:${source.sourceId} resolves to multiple source profiles`)
      }
      sourceProfiles[source.sourceId] = profile
    }
    const defaultSource = item.sources.find((source) => source.default)?.sourceId
    if (!defaultSource) throw new Error(`${catalog.id}:${item.id} does not have a default source`)
    const sourceSet = {
      defaultSource,
      sources: item.sources.map((source) => source.sourceId),
    }
    const sourceSetKey = JSON.stringify(sourceSet)
    const existingSourceSet = sourceSetByKey.get(sourceSetKey)
    if (existingSourceSet) existingSourceSet.ruleIds.push(item.id)
    else sourceSetByKey.set(sourceSetKey, { value: sourceSet, ruleIds: [item.id] })
    return {
      id: item.id,
      ...(item.name === item.id ? {} : { name: item.name }),
      sourceSetKey,
      routing: {
        category: item.category,
        target: item.suggestedTarget,
        provisioning: item.provisioning,
        order: item.sortOrder,
        activeForUnmatchedPolicies: item.activeForUnmatchedPolicies,
      },
    }
  })

  const sourceSetEntries = [...sourceSetByKey.entries()]
  const defaultSourceSetKey = sourceSetEntries.sort(
    (left, right) => right[1].ruleIds.length - left[1].ruleIds.length || left[0].localeCompare(right[0]),
  )[0]?.[0]
  if (!defaultSourceSetKey) throw new Error(`${catalog.id} does not have a source set`)
  const defaultSources = sourceSetByKey.get(defaultSourceSetKey).value.sources
  const sourceSetIds = new Map()
  const usedSourceSetIds = new Set()
  sourceSetIds.set(defaultSourceSetKey, 'standard')
  usedSourceSetIds.add('standard')
  for (const [key, entry] of sourceSetEntries) {
    if (key === defaultSourceSetKey) continue
    const missingSources = defaultSources.filter((sourceId) => !entry.value.sources.includes(sourceId))
    const addedSources = entry.value.sources.filter((sourceId) => !defaultSources.includes(sourceId))
    const preferredId =
      addedSources.length === 0 && missingSources.length > 0
        ? `without-${missingSources.join('-')}`
        : entry.ruleIds.length === 1
          ? entry.ruleIds[0]
          : `sources-${sourceSetIds.size + 1}`
    sourceSetIds.set(key, uniqueIdentifier(preferredId, usedSourceSetIds))
  }
  const sourceSets = Object.fromEntries(
    [...sourceSetIds.entries()]
      .sort((left, right) =>
        left[1] === 'standard' ? -1 : right[1] === 'standard' ? 1 : left[1].localeCompare(right[1]),
      )
      .map(([key, id]) => [id, sourceSetByKey.get(key).value]),
  )

  const routingGroupsByKey = new Map()
  for (const descriptor of descriptors) {
    const key = JSON.stringify(descriptor.routing)
    const group = routingGroupsByKey.get(key)
    if (group) group.descriptors.push(descriptor)
    else routingGroupsByKey.set(key, { routing: descriptor.routing, descriptors: [descriptor] })
  }
  const routingGroups = [...routingGroupsByKey.values()].map((group) => {
    const groupSourceSetKey = mostFrequentValue(group.descriptors.map((item) => item.sourceSetKey))
    const groupSourceSet = sourceSetIds.get(groupSourceSetKey)
    const rules = group.descriptors.map((descriptor) => {
      const sourceSet = sourceSetIds.get(descriptor.sourceSetKey)
      const sourceSetOverride = sourceSet === groupSourceSet ? undefined : sourceSet
      if (!descriptor.name && !sourceSetOverride) return descriptor.id
      return {
        id: descriptor.id,
        ...(descriptor.name ? { name: descriptor.name } : {}),
        ...(sourceSetOverride ? { sourceSet: sourceSetOverride } : {}),
      }
    })
    return {
      ...(groupSourceSet === 'standard' ? {} : { sourceSet: groupSourceSet }),
      routing: group.routing,
      rules,
    }
  })

  return {
    id: catalog.id,
    name: catalog.name,
    repository: {
      url: catalog.repositoryUrl,
      branch: catalog.branch,
      ...(catalog.commitSha ? { commit: catalog.commitSha } : {}),
    },
    syncedAt: catalog.syncedAt,
    sourceProfiles,
    defaultSourceSet: 'standard',
    sourceSets,
    routingGroups,
  }
}

function mostFrequentValue(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
}

function uniqueIdentifier(preferredId, usedIds) {
  let candidate = preferredId
  let suffix = 2
  while (usedIds.has(candidate)) {
    candidate = `${preferredId}-${suffix}`
    suffix += 1
  }
  usedIds.add(candidate)
  return candidate
}

function createUrlTemplate(url, itemId) {
  const separatorIndex = url.lastIndexOf('/')
  const filename = url.slice(separatorIndex + 1)
  const encodedId = encodeURIComponent(itemId)
  return filename.startsWith(`${encodedId}.`)
    ? `${url.slice(0, separatorIndex + 1)}{id}${filename.slice(encodedId.length)}`
    : url
}

function createOverrideSource(source) {
  return {
    sourceId: source.id,
    url: rawUrl(source.repositoryUrl, source.branch, source.path),
    format: source.format,
    behavior: source.behavior,
    default: source.default !== false,
    nativeFor: source.nativeFor ?? [],
  }
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'UniConf-catalog-generator',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${url}`)
  return response.json()
}

function parseRepository(value) {
  const url = new URL(value)
  const [owner, name] = url.pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !owner || !name) {
    throw new Error(`Unsupported repository URL: ${value}`)
  }
  return { owner, name }
}

function rawUrl(repositoryUrl, branch, path) {
  const repository = parseRepository(repositoryUrl)
  return `https://raw.githubusercontent.com/${repository.owner}/${repository.name}/${encodeURIComponent(branch)}/${encodePath(path)}`
}

function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/')
}

function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => new RegExp(`^${globSource(pattern)}$`, 'i').test(value))
}

function globSource(pattern) {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[|\\{}()[\]^$+.]/g, '\\$&')
    }
  }
  return source
}

function stripExtension(value) {
  return /\.(?:ya?ml|json|list|txt|srs|mrs)$/i.test(value)
    ? value.replace(/\.(?:ya?ml|json|list|txt|srs|mrs)$/i, '')
    : null
}

function normalizeItemId(value) {
  return value
    .replace(/!/g, 'not-')
    .replace(/\+/g, '-plus')
    .replace(/@/g, '-at-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function humanize(value) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join(' ')
}
