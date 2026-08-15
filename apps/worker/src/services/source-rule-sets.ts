import { load as parseYAML } from 'js-yaml'
import type {
  RuleSetBehavior,
  SourceFormat,
  SourceRemoteRuleSetCandidate,
} from '@uni-conf/types'
import { isSafeRemoteHttpUrl } from './safe-remote-fetch'
import { DEFAULT_WORKSPACE_ID } from './workspaces'

export function discoverSourceRemoteRuleSets(
  rawContent: string,
  format: SourceFormat,
  baseUrl?: string,
): SourceRemoteRuleSetCandidate[] {
  if (!['auto', 'clash', 'mihomo'].includes(format)) return []

  let document: Record<string, unknown>
  try {
    const parsed = parseYAML(rawContent)
    if (!isPlainRecord(parsed)) return []
    document = parsed
  } catch {
    return []
  }

  const targetsByProvider = new Map<string, string>()
  for (const rawRule of Array.isArray(document.rules) ? document.rules : []) {
    if (typeof rawRule !== 'string') continue
    const parts = rawRule.split(',').map(part => part.trim())
    if (parts[0]?.toUpperCase() !== 'RULE-SET') continue
    const providerName = parts[1]
    const target = parts[2]
    if (providerName && target && !targetsByProvider.has(providerName)) {
      targetsByProvider.set(providerName, target)
    }
  }

  const providers = isPlainRecord(document['rule-providers']) ? document['rule-providers'] : {}
  const candidates: SourceRemoteRuleSetCandidate[] = []
  for (const [key, rawProvider] of Object.entries(providers)) {
    if (!isPlainRecord(rawProvider) || rawProvider.type !== 'http' || typeof rawProvider.url !== 'string') continue
    const providerFormat = String(rawProvider.format ?? '').toLowerCase()
    if (providerFormat === 'mrs' && rawProvider.behavior !== 'domain' && rawProvider.behavior !== 'ipcidr') continue
    const url = resolveProviderUrl(rawProvider.url, baseUrl)
    if (!url) continue
    const behavior: RuleSetBehavior = rawProvider.behavior === 'domain' || rawProvider.behavior === 'ipcidr'
      ? rawProvider.behavior
      : 'classical'
    const intervalSeconds = Number(rawProvider.interval)
    const upstreamTarget = targetsByProvider.get(key)
    candidates.push({
      key,
      name: key,
      url,
      format: providerFormat === 'mrs' ? 'mrs' : providerFormat === 'text' ? 'text' : 'mihomo',
      behavior,
      updateInterval: Number.isFinite(intervalSeconds) && intervalSeconds > 0
        ? Math.max(1, Math.round(intervalSeconds / 3600))
        : 24,
      upstreamTarget,
      referenced: Boolean(upstreamTarget),
    })
  }
  return candidates
}

export async function listSourceRemoteRuleSets(
  db: D1Database,
  sourceId: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<SourceRemoteRuleSetCandidate[] | null> {
  const source = await db.prepare(
    'SELECT raw_content, format, url FROM sources WHERE id = ? AND workspace_id = ? AND type != ?'
  ).bind(sourceId, workspaceId, 'manual').first<{
    raw_content: string | null
    format: SourceFormat
    url: string | null
  }>()
  if (!source) return null
  return discoverSourceRemoteRuleSets(source.raw_content ?? '', source.format, source.url ?? undefined)
}

export async function syncSourceLinkedRemoteRuleSets(
  db: D1Database,
  sourceId: string,
  ts: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<void> {
  const candidates = await listSourceRemoteRuleSets(db, sourceId, workspaceId)
  if (candidates === null) return
  const candidateByKey = new Map(candidates.map(candidate => [candidate.key, candidate]))
  const { results } = await db.prepare(
    `SELECT id, source_rule_set_key, url, format, behavior, update_interval, source_missing
     FROM remote_rule_sets
     WHERE source_id = ? AND workspace_id = ?`
  ).bind(sourceId, workspaceId).all<{
    id: string
    source_rule_set_key: string | null
    url: string
    format: string
    behavior: RuleSetBehavior
    update_interval: number
    source_missing: number | null
  }>()
  if (results.length === 0) return

  const statements: D1PreparedStatement[] = []
  for (const row of results) {
    const candidate = row.source_rule_set_key ? candidateByKey.get(row.source_rule_set_key) : undefined
    if (!candidate) {
      if (row.source_missing !== 1) {
        statements.push(
          db.prepare('UPDATE remote_rule_sets SET source_missing = 1, updated_at = ? WHERE id = ? AND source_id = ? AND source_missing IS NOT 1')
            .bind(ts, row.id, sourceId),
        )
      }
      continue
    }
    if (
      row.url === candidate.url
      && row.format === candidate.format
      && row.behavior === candidate.behavior
      && row.update_interval === candidate.updateInterval
      && row.source_missing === 0
    ) continue
    statements.push(
      db.prepare(
        `UPDATE remote_rule_sets SET
          url = ?, format = ?, behavior = ?, update_interval = ?, source_missing = 0, updated_at = ?
         WHERE id = ? AND source_id = ?`
      ).bind(
        candidate.url,
        candidate.format,
        candidate.behavior,
        candidate.updateInterval,
        ts,
        row.id,
        sourceId,
      ),
    )
  }
  if (statements.length > 0) await db.batch(statements)
}

function resolveProviderUrl(value: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(value.trim(), baseUrl).toString() : value.trim()
    return isSafeRemoteHttpUrl(url) ? url : null
  } catch {
    return null
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
