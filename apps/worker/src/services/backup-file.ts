import { MAX_BACKUP_FILE_BYTES, MAX_BACKUP_JSON_BYTES } from '@uni-conf/shared'
import { HTTPException } from 'hono/http-exception'

export async function encodeBackup(payload: unknown): Promise<Blob> {
  const json = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  if (json.size <= MAX_BACKUP_FILE_BYTES) return json
  if (json.size > MAX_BACKUP_JSON_BYTES) throw backupTooLarge()
  const compressed = await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob()
  if (compressed.size > MAX_BACKUP_FILE_BYTES) throw backupTooLarge()
  return compressed.slice(0, compressed.size, 'application/gzip')
}

export async function decodeBackup(request: Request): Promise<unknown> {
  try {
    if (request.headers.get('content-type') !== 'application/gzip') return await request.json()
    if (!request.body) throw new Error('Missing body')
    const reader = request.body.pipeThrough(new DecompressionStream('gzip')).getReader()
    const decoder = new TextDecoder()
    const parts: string[] = []
    let size = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_BACKUP_JSON_BYTES) {
          await reader.cancel()
          throw backupTooLarge()
        }
        parts.push(decoder.decode(chunk.value, { stream: true }))
      }
      parts.push(decoder.decode())
      return JSON.parse(parts.join('')) as unknown
    } finally {
      reader.releaseLock()
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error
    throw new HTTPException(400, { message: 'Invalid backup file' })
  }
}

function backupTooLarge(): HTTPException {
  return new HTTPException(413, { message: 'Backup exceeds the 48 MiB JSON or 25 MiB compressed size limit' })
}
