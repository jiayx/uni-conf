export function maskSubscriptionUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}/••••${url.search ? '?••••' : ''}`
  } catch {
    return '••••••••'
  }
}

export function maskSubscriptionTokenUrl(value: string): string {
  try {
    const url = new URL(value)
    const parts = url.pathname.split('/')
    const subIndex = parts.indexOf('sub')
    if (subIndex >= 0 && parts[subIndex + 1]) parts[subIndex + 1] = '••••••••'
    return `${url.protocol}//${url.host}${parts.join('/')}`
  } catch {
    return '••••••••'
  }
}
