const baseUrl = (process.env.UNICONF_BASE_URL ?? '').replace(/\/$/, '')
const apiKey = process.env.UNICONF_API_KEY ?? ''

if (!baseUrl) throw new Error('UNICONF_BASE_URL is required')

await check('/api/health', (response, body) => {
  if (!response.ok || body?.success !== true || body?.data?.status !== 'ok') {
    throw new Error(`health check failed (${response.status})`)
  }
})

await check('/api/ready', (response, body) => {
  if (!response.ok || body?.success !== true || body?.data?.status !== 'ready') {
    const checks = JSON.stringify(body?.data?.checks ?? {})
    throw new Error(`readiness check failed (${response.status}): ${checks}`)
  }
})

await check('/', (response, body, text) => {
  if (!response.ok || !text.includes('<div id="root">')) {
    throw new Error(`SPA smoke check failed (${response.status})`)
  }
})

if (apiKey) {
  await check('/api/auth/check', (response, body) => {
    if (!response.ok || body?.data?.ok !== true) throw new Error(`authenticated API check failed (${response.status})`)
  }, { Authorization: `Bearer ${apiKey}` })
}

console.log(`Smoke checks passed for ${baseUrl}`)

async function check(path, assertResponse, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers, redirect: 'error' })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = undefined }
  assertResponse(response, body, text)
}
