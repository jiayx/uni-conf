export function parseSubscriptionUrls(input: string): string[] {
  const urls = input
    .split(/[\s,，]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter(isHttpUrl)

  return [...new Set(urls)]
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
