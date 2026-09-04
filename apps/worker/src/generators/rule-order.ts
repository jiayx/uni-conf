type RuleRow = Record<string, unknown>

// Manual rules override remote policies. MATCH is a fallback regardless of its
// stored order and must not make later manual or remote rules unreachable.
export function splitOrderedRuleRows(rows: RuleRow[]): { rules: RuleRow[]; finalRule?: RuleRow } {
  const enabled = rows.filter(row => row['enabled']).sort((a, b) =>
    Number(a['sort_order'] ?? 0) - Number(b['sort_order'] ?? 0))
  return {
    rules: enabled.filter(row => row['type'] !== 'MATCH'),
    finalRule: enabled.find(row => row['type'] === 'MATCH'),
  }
}
