import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const protocolsPath = path.join(root, 'src/protocols.ts')
const generatedPath = path.join(root, 'src/generated/protocol-schema-metadata.ts')

const protocolsSource = fs.readFileSync(protocolsPath, 'utf8')
const generatedSource = fs.readFileSync(generatedPath, 'utf8')

const generatedJson = generatedSource
  .replace(/^.*?export const GENERATED_PROTOCOL_SCHEMA_METADATA = /s, '')
  .replace(/ as const\s*$/s, '')
const metadata = JSON.parse(generatedJson)

const registrySource = protocolsSource.match(/export const PROXY_PROTOCOL_REGISTRY = \{([\s\S]*?)\n\} as const/)?.[1]
if (!registrySource) throw new Error('Unable to locate PROXY_PROTOCOL_REGISTRY')

const missing = []
const entryPattern = /\n  ([a-z0-9]+): \{([\s\S]*?)\n  \}/g
let match
while ((match = entryPattern.exec(registrySource))) {
  const protocol = match[1]
  const body = match[2]
  const singboxType = body.match(/singboxType: '([^']+)'/)?.[1]
  const mihomoType = body.match(/mihomoType: '([^']+)'/)?.[1]

  if (singboxType && !metadata.singboxOutbounds[singboxType]) {
    missing.push(`${protocol}: sing-box type "${singboxType}" is not present in generated metadata`)
  }
  if (mihomoType && !metadata.mihomoProxies[mihomoType]) {
    missing.push(`${protocol}: mihomo type "${mihomoType}" is not present in generated metadata`)
  }
}

if (missing.length > 0) {
  console.error(missing.join('\n'))
  process.exit(1)
}

console.log('Protocol metadata is consistent with the registry.')
