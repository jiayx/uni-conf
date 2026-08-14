import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const settingsPath = resolve(root, 'cloudflare.production.json')
const templatePath = resolve(root, 'wrangler.jsonc')
const outputPath = resolve(root, 'wrangler.production.local.jsonc')

const fail = (message) => {
  throw new Error(`${message}\nCopy cloudflare.production.example.json to cloudflare.production.json and fill in your Cloudflare resources.`)
}

let settings
try {
  settings = JSON.parse(await readFile(settingsPath, 'utf8'))
} catch (error) {
  if (error?.code === 'ENOENT') fail('Missing cloudflare.production.json.')
  fail(`Invalid cloudflare.production.json: ${error instanceof Error ? error.message : String(error)}`)
}

const requiredString = (key) => {
  const value = settings[key]
  if (typeof value !== 'string' || !value.trim()) fail(`Missing ${key}.`)
  return value.trim()
}

const allowedOrigin = requiredString('allowedOrigin')
const d1DatabaseName = requiredString('d1DatabaseName')
const d1DatabaseId = requiredString('d1DatabaseId')
const kvNamespaceId = requiredString('kvNamespaceId')

let origin
try {
  origin = new URL(allowedOrigin)
} catch {
  fail('allowedOrigin must be a valid HTTP or HTTPS origin.')
}
if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== allowedOrigin) {
  fail('allowedOrigin must contain only the protocol, host, and optional port, without a path or trailing slash.')
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d1DatabaseId)) {
  fail('d1DatabaseId must be a valid UUID.')
}
if (!/^[0-9a-f]{32}$/i.test(kvNamespaceId)) {
  fail('kvNamespaceId must be a 32-character hexadecimal ID.')
}

const replacements = new Map([
  ['REPLACE_WITH_PRODUCTION_ORIGIN', allowedOrigin],
  ['REPLACE_WITH_PRODUCTION_D1_NAME', d1DatabaseName],
  ['REPLACE_WITH_PRODUCTION_D1_ID', d1DatabaseId],
  ['REPLACE_WITH_PRODUCTION_KV_ID', kvNamespaceId],
])

let config = await readFile(templatePath, 'utf8')
for (const [placeholder, value] of replacements) {
  const matches = config.split(placeholder).length - 1
  if (matches !== 1) fail(`Expected exactly one ${placeholder} placeholder in wrangler.jsonc, found ${matches}.`)
  config = config.replace(placeholder, value)
}

await writeFile(outputPath, config)
console.log('Generated wrangler.production.local.jsonc from local Cloudflare settings')
