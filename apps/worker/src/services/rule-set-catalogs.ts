import type {
  RemoteRuleSetSourceOverrideTarget,
  RuleSetBehavior,
  RuleSetCatalog,
  RuleSetCatalogItem,
  RuleSetCatalogItemSource,
  RuleSetCatalogSnapshot,
  RuleSetFormat,
  UnmatchedTrafficPolicy,
} from '@uni-conf/types'
import { bundledRuleSetCatalogSnapshot } from '../generated/rule-set-catalogs'
import { bundledRuleSetCatalogDefinitions } from '../generated/rule-set-catalogs/definitions'
import { safeRemoteFetch } from './safe-remote-fetch'
import type { Env } from '../types'

const CATALOG_CACHE_KEY = 'rule-set-catalogs:latest'
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
export const RULE_SET_CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

interface CatalogDefinition {
  id: string
  name: string
  repositoryUrl: string
  branch: string
  defaultSourceId: string
  sources: CatalogSourceDefinition[]
  defaults: CatalogMapping
  mappings: CatalogMapping[]
  overrides?: Record<string, CatalogItemOverride>
}

interface CatalogSourceDefinition {
  id: string
  repositoryUrl?: string
  branch?: string
  path: string
  include: string[]
  default?: boolean
  format: RuleSetFormat
  behavior: RuleSetBehavior
  nativeFor: RemoteRuleSetSourceOverrideTarget[]
}

interface CatalogMapping {
  ids?: string[]
  match?: string[]
  category?: string
  target?: string
  provisioning?: RuleSetCatalogItem['provisioning']
  sortOrder?: number
  activeForUnmatchedPolicies?: UnmatchedTrafficPolicy[]
}

interface CatalogItemOverride {
  name?: string
  sources?: Array<{
    id: string
    repositoryUrl: string
    branch: string
    path: string
    format: RuleSetFormat
    behavior: RuleSetBehavior
    nativeFor?: RemoteRuleSetSourceOverrideTarget[]
    default?: boolean
  }>
}

interface GitHubContentsEntry {
  type?: string
  name?: string
  path?: string
}

interface GitHubBranch {
  commit?: { sha?: string }
}

const bundledSnapshot = bundledRuleSetCatalogSnapshot
const currentCatalogIds = bundledSnapshot.catalogs.map(catalog => catalog.id).sort()

export async function getRuleSetCatalogSnapshot(kv?: KVNamespace): Promise<RuleSetCatalogSnapshot> {
  if (!kv) return bundledSnapshot
  try {
    const cached = await kv.get<RuleSetCatalogSnapshot>(CATALOG_CACHE_KEY, 'json')
    return isCatalogSnapshot(cached) && hasCurrentCatalogs(cached) ? cached : bundledSnapshot
  } catch {
    return bundledSnapshot
  }
}

function hasCurrentCatalogs(snapshot: RuleSetCatalogSnapshot): boolean {
  const ids = snapshot.catalogs.map(catalog => catalog.id).sort()
  return ids.length === currentCatalogIds.length
    && ids.every((id, index) => id === currentCatalogIds[index])
}

export async function refreshRuleSetCatalogSnapshot(
  env: Pick<Env, 'KV'>,
  fetcher: typeof fetch = fetch,
): Promise<RuleSetCatalogSnapshot> {
  const definitions = bundledRuleSetCatalogDefinitions
    .map(definition => structuredClone(definition)) as unknown as CatalogDefinition[]
  const catalogs: RuleSetCatalog[] = []
  for (const definition of definitions) {
    catalogs.push(await scanCatalog(definition, fetcher))
  }
  const snapshot: RuleSetCatalogSnapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    catalogs,
  }
  await env.KV.put(CATALOG_CACHE_KEY, JSON.stringify(snapshot))
  return snapshot
}

export async function refreshRuleSetCatalogSnapshotIfDue(
  env: Pick<Env, 'KV'>,
  nowMs = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<RuleSetCatalogSnapshot | null> {
  const current = await getRuleSetCatalogSnapshot(env.KV)
  if (current === bundledSnapshot) {
    return refreshRuleSetCatalogSnapshot(env, fetcher)
  }
  const generatedAt = Date.parse(current.generatedAt)
  if (Number.isFinite(generatedAt) && nowMs - generatedAt < RULE_SET_CATALOG_REFRESH_INTERVAL_MS) {
    return null
  }
  return refreshRuleSetCatalogSnapshot(env, fetcher)
}

async function scanCatalog(
  definition: CatalogDefinition,
  fetcher: typeof fetch,
): Promise<RuleSetCatalog> {
  const repository = parseGitHubRepository(definition.repositoryUrl)
  const branchUrl = `https://api.github.com/repos/${repository.owner}/${repository.name}/branches/${encodeURIComponent(definition.branch)}`
  const branch = await fetchGitHubJson<GitHubBranch>(fetcher, branchUrl)
  const items = new Map<string, RuleSetCatalogItem>()

  for (const source of definition.sources) {
    const sourceRepositoryUrl = source.repositoryUrl ?? definition.repositoryUrl
    const sourceRepository = parseGitHubRepository(sourceRepositoryUrl)
    const sourceBranch = source.branch ?? definition.branch
    const entries = await listContentsEntries(fetcher, sourceRepository, sourceBranch, source.path)
    if (entries.length === 0) throw new Error(`${definition.id}:${source.path} does not contain files`)
    for (const entry of entries) {
      const candidate = createEntryCandidate(source, entry)
      if (!candidate) continue
      const id = normalizeCatalogItemId(candidate.id)
      if (!id) continue
      const item = items.get(id) ?? createCatalogItem(definition, id, candidate.name)
      item.sources.push(createCatalogSource(
        sourceRepositoryUrl,
        sourceBranch,
        source.id,
        candidate.path,
        source.format,
        source.behavior,
        source.nativeFor,
        source.default ?? source.id === definition.defaultSourceId,
      ))
      items.set(id, item)
    }
  }

  for (const [id, override] of Object.entries(definition.overrides ?? {})) {
    const existing = items.get(id)
    if (!existing && !override.sources?.length) continue
    const item = existing ?? createCatalogItem(definition, id)
    if (override.name) item.name = override.name
    for (const source of override.sources ?? []) {
      appendCatalogSource(item, createCatalogSource(
        source.repositoryUrl,
        source.branch,
        source.id,
        source.path,
        source.format,
        source.behavior,
        source.nativeFor ?? [],
        source.default !== false,
      ))
    }
    items.set(id, item)
  }

  const catalogItems = [...items.values()]
    .map(ensureDefaultCatalogSource)
    .sort((left, right) => (left.sortOrder ?? 900) - (right.sortOrder ?? 900) || left.id.localeCompare(right.id))
  if (catalogItems.length === 0) throw new Error(`${definition.id} did not produce any rule sets`)
  return {
    id: definition.id,
    name: definition.name,
    repositoryUrl: definition.repositoryUrl,
    branch: definition.branch,
    commitSha: branch.commit?.sha,
    syncedAt: new Date().toISOString(),
    items: catalogItems,
  }
}

function ensureDefaultCatalogSource(item: RuleSetCatalogItem): RuleSetCatalogItem {
  if (!item.sources.some(source => source.default) && item.sources[0]) {
    item.sources[0].default = true
  }
  item.sources = item.sources.filter(source => source.default || source.nativeFor.length > 0)
  return item
}

function appendCatalogSource(item: RuleSetCatalogItem, source: RuleSetCatalogItemSource): void {
  if (source.default) {
    for (const existing of item.sources) existing.default = false
  }
  item.sources.push(source)
}

function createCatalogItem(
  definition: CatalogDefinition,
  id: string,
  name = humanizeCatalogItemName(id),
): RuleSetCatalogItem {
  const mapping = definition.mappings.find(candidate =>
    candidate.ids?.includes(id) || matchesAny(id, candidate.match ?? []))
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

async function listContentsEntries(
  fetcher: typeof fetch,
  repository: { owner: string; name: string },
  branch: string,
  path: string,
): Promise<GitHubContentsEntry[]> {
  const contentsUrl = `https://api.github.com/repos/${repository.owner}/${repository.name}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`
  const contents = await fetchGitHubJson<GitHubContentsEntry | GitHubContentsEntry[]>(fetcher, contentsUrl)
  return Array.isArray(contents) ? contents : contents.type === 'file' ? [contents] : []
}

function createEntryCandidate(
  source: CatalogSourceDefinition,
  entry: GitHubContentsEntry,
): { id: string; name: string; path: string } | null {
  if (entry.type !== 'file' || !entry.name || !entry.path) return null
  if (!matchesAny(entry.name, source.include)) return null
  const filename = stripKnownExtension(entry.name)
  if (!filename) return null
  return {
    id: filename,
    name: filename,
    path: entry.path,
  }
}

function createCatalogSource(
  repositoryUrl: string,
  branch: string,
  sourceId: string,
  path: string,
  format: RuleSetFormat,
  behavior: RuleSetBehavior,
  nativeFor: RemoteRuleSetSourceOverrideTarget[],
  isDefault: boolean,
): RuleSetCatalogItemSource {
  const repository = parseGitHubRepository(repositoryUrl)
  return {
    sourceId,
    url: `https://raw.githubusercontent.com/${repository.owner}/${repository.name}/${encodeURIComponent(branch)}/${encodePath(path)}`,
    format,
    behavior,
    default: isDefault,
    nativeFor,
  }
}

async function fetchGitHubJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await safeRemoteFetch(fetcher, url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'UniConf',
    },
  }, { timeoutMs: 15_000 })
  if (!response.ok) throw new Error(`GitHub catalog scan returned HTTP ${response.status}`)
  return JSON.parse(await readResponseTextLimited(response, MAX_RESPONSE_BYTES)) as T
}

function isCatalogSnapshot(value: unknown): value is RuleSetCatalogSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<RuleSetCatalogSnapshot>
  return snapshot.schemaVersion === 1
    && typeof snapshot.generatedAt === 'string'
    && Array.isArray(snapshot.catalogs)
    && snapshot.catalogs.length > 0
}

function parseGitHubRepository(value: string): { owner: string; name: string } {
  try {
    const url = new URL(value)
    const [owner, name] = url.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean)
    if (
      url.protocol !== 'https:'
      || url.hostname.toLowerCase() !== 'github.com'
      || !owner
      || !name
      || !isSafeIdentifier(owner)
      || !/^[A-Za-z0-9._-]+$/.test(name)
    ) throw new Error()
    return { owner, name }
  } catch {
    throw new Error(`Unsupported GitHub repository URL: ${value}`)
  }
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]+$/.test(value)
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(value))
}

function globToRegExp(pattern: string): RegExp {
  let output = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]!
    if (char === '*' && pattern[index + 1] === '*') {
      index += 1
      output += '.*'
    } else if (char === '*') {
      output += '[^/]*'
    } else if (char === '?') {
      output += '[^/]'
    } else {
      output += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`${output}$`, 'i')
}

function stripKnownExtension(value: string): string | null {
  return /\.(?:ya?ml|json|list|txt|srs|mrs)$/i.test(value)
    ? value.replace(/\.(?:ya?ml|json|list|txt|srs|mrs)$/i, '')
    : null
}

function normalizeCatalogItemId(value: string): string {
  return value
    .replace(/!/g, 'not-')
    .replace(/\+/g, '-plus')
    .replace(/@/g, '-at-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function humanizeCatalogItemName(id: string): string {
  return id.split(/[-_]+/).filter(Boolean)
    .map(part => part.length <= 3 ? part.toUpperCase() : `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function encodePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/')
}

async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw new Error('Rule catalog response is too large')
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error('Rule catalog response is too large')
  }
  return text
}
