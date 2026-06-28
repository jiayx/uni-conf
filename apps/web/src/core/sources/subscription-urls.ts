export function parseSubscriptionUrls(input: string): string[] {
  const urls = Array.from(input.matchAll(/https?:\/\/[^\s,，；;。、）)\]}]+/gi))
    .map(match => trimUrlPunctuation(match[0]))
    .filter(isHttpUrl)

  return [...new Set(urls)]
}

function trimUrlPunctuation(value: string): string {
  return value.replace(/[。；;，,、）)\]}]+$/g, '')
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
