export interface ExportDownloadFile {
  blob: Blob
  filename: string
}

export function parseContentDispositionFilename(value: string | null, fallback: string): string {
  if (!value) return fallback

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) return safeDecodeFilename(utf8Match[1], fallback)

  const quotedMatch = value.match(/filename="([^"]+)"/i)
  if (quotedMatch?.[1]) return quotedMatch[1]

  const plainMatch = value.match(/filename=([^;]+)/i)
  if (plainMatch?.[1]) return plainMatch[1].trim()

  return fallback
}

export function saveExportDownload(file: ExportDownloadFile): void {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function safeDecodeFilename(value: string, fallback: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return fallback
  }
}
