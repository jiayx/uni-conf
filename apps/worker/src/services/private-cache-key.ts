export async function buildPrivateCacheKey(
  namespace: string,
  version: number,
  value: string
): Promise<string> {
  if (!/^[a-z0-9-]+$/i.test(namespace)) throw new Error('Invalid cache-key namespace')
  if (!Number.isInteger(version) || version <= 0) throw new Error('Invalid cache-key version')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return `${namespace}:v${version}:${hash}`
}
