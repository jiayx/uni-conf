export function resolveCreateSourceUserAgent(selection: string, customValue: string): string | undefined {
  if (selection === 'custom') return customValue.trim() || undefined;
  return selection || undefined;
}

export function resolveUpdateSourceUserAgent(selection: string, customValue: string): string {
  if (selection === 'custom') return customValue.trim();
  return selection;
}
