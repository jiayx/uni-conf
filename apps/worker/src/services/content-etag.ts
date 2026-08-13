export async function buildContentEtag(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return `"${hash}"`
}

export function requestMatchesEtag(request: Request, etag: string): boolean {
  const candidates = request.headers.get('if-none-match')
  if (!candidates) return false
  return candidates.split(',').some((candidate) => {
    const normalized = candidate.trim()
    return normalized === '*' || normalized === etag || normalized === `W/${etag}`
  })
}
