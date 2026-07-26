import type {
  RemoteRuleSet,
  RemoteRuleSetSourceHealthResult,
  RemoteRuleSetSourceHealthSnapshot,
  RemoteRuleSetSourceOverrideTarget,
  RuleSetFormat,
} from '@uni-conf/types'
import { mapWithConcurrency } from './async-pool'
import { validateRemoteRuleSetContent } from './remote-rule-set-validation'

interface RemoteRuleSetSourceHealthRow {
  remote_rule_set_id: string
  expires_at: string
  result: string
}

export async function validateAndPersistRuleSetSources(
  db: D1Database,
  ruleSet: RemoteRuleSet,
): Promise<RemoteRuleSetSourceHealthSnapshot> {
  const checkedAt = new Date().toISOString()
  const sources: Array<{
    targetFormat: RemoteRuleSetSourceOverrideTarget | null
    url: string
    format: RuleSetFormat
  }> = [
    { targetFormat: null, url: ruleSet.url, format: ruleSet.format },
    ...Object.entries(ruleSet.sourceOverrides).flatMap(([target, url]) => url
      ? [{ targetFormat: target as RemoteRuleSetSourceOverrideTarget, url, format: target as RuleSetFormat }]
      : []),
  ]
  const validations = await mapWithConcurrency(sources, 3, source => validateRemoteRuleSetContent({
    url: source.url,
    format: source.format,
    behavior: ruleSet.behavior,
  }, { checkedAt }))
  const defaultSource = validations[0]!
  const sourceOverrides = sources.slice(1).map((source, index) => ({
    targetFormat: source.targetFormat!,
    result: validations[index + 1]!,
  }))
  const summary = validations.reduce((counts, result) => ({
    ...counts,
    [result.status]: counts[result.status] + 1,
  }), { total: validations.length, valid: 0, warning: 0, invalid: 0 })
  const result: RemoteRuleSetSourceHealthResult = {
    status: summary.invalid > 0 ? 'invalid' : summary.warning > 0 ? 'warning' : 'valid',
    checkedAt,
    defaultSource,
    sourceOverrides,
    summary,
  }
  const expiresAt = new Date(Date.parse(checkedAt) + Math.max(1, ruleSet.updateInterval) * 60 * 60 * 1000).toISOString()
  await db.prepare(
    `INSERT INTO remote_rule_set_source_health (remote_rule_set_id, checked_at, expires_at, result)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(remote_rule_set_id) DO UPDATE SET checked_at = excluded.checked_at, expires_at = excluded.expires_at, result = excluded.result`
  ).bind(ruleSet.id, checkedAt, expiresAt, JSON.stringify(result)).run()
  return { ...result, expiresAt, stale: false }
}

export async function listSourceHealthSnapshots(db: D1Database): Promise<Map<string, RemoteRuleSetSourceHealthSnapshot>> {
  const { results } = await db.prepare(
    'SELECT remote_rule_set_id, expires_at, result FROM remote_rule_set_source_health'
  ).all<RemoteRuleSetSourceHealthRow>()
  const snapshots = new Map<string, RemoteRuleSetSourceHealthSnapshot>()
  for (const row of results) {
    const snapshot = parseSourceHealthSnapshot(row)
    if (snapshot) snapshots.set(row.remote_rule_set_id, snapshot)
  }
  return snapshots
}

export async function getSourceHealthSnapshot(db: D1Database, id: string): Promise<RemoteRuleSetSourceHealthSnapshot | undefined> {
  const row = await db.prepare(
    'SELECT remote_rule_set_id, expires_at, result FROM remote_rule_set_source_health WHERE remote_rule_set_id = ?'
  ).bind(id).first<RemoteRuleSetSourceHealthRow>()
  return row ? parseSourceHealthSnapshot(row) : undefined
}

function parseSourceHealthSnapshot(row: RemoteRuleSetSourceHealthRow): RemoteRuleSetSourceHealthSnapshot | undefined {
  try {
    const result = JSON.parse(row.result) as Partial<RemoteRuleSetSourceHealthResult>
    if (!result || !['valid', 'warning', 'invalid'].includes(result.status ?? '')) return undefined
    if (typeof result.checkedAt !== 'string' || !result.defaultSource || !Array.isArray(result.sourceOverrides) || !result.summary) return undefined
    return {
      ...result as RemoteRuleSetSourceHealthResult,
      expiresAt: row.expires_at,
      stale: !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now(),
    }
  } catch {
    return undefined
  }
}
