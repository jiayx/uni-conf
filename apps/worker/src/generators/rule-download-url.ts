export const RULE_DOWNLOAD_CDN = 'https://testingcf.jsdelivr.net'

/** Use one public GitHub CDN for every client. */
export function ruleDownloadUrl(source: string): string {
  let url: URL
  try { url = new URL(source) } catch { return source }
  // Never send credentials or signed/private download parameters to a public CDN.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port) return source
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/gh/')) {
    return `${RULE_DOWNLOAD_CDN}${url.pathname}`
  }
  const parts = url.pathname.slice(1).split('/')
  const [owner, repo] = parts
  if (!owner || !repo) return source
  let rest: string[]
  if (url.hostname === 'raw.githubusercontent.com') rest = parts.slice(2)
  else if (url.hostname === 'github.com' && parts[2] === 'raw') rest = parts.slice(3)
  else return source
  if (rest[0] === 'refs' && (rest[1] === 'heads' || rest[1] === 'tags')) rest = rest.slice(2)
  const [ref, ...path] = rest
  if (!ref || path.length === 0 || path.some((part) => !part)) return source
  return `${RULE_DOWNLOAD_CDN}/gh/${owner}/${repo}@${ref}/${path.join('/')}`
}
