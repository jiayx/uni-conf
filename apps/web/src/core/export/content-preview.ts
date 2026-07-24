export interface ContentPreviewLimits {
  maxLines: number
  maxCharacters: number
}

export interface ContentPreviewExcerpt {
  content: string
  truncated: boolean
  shownLines: number
  totalLines: number
  shownCharacters: number
  totalCharacters: number
}

export const INLINE_CONTENT_PREVIEW_LIMITS: ContentPreviewLimits = {
  maxLines: 120,
  maxCharacters: 24_000,
}

export const FULL_CONTENT_PREVIEW_LIMITS: ContentPreviewLimits = {
  maxLines: 500,
  maxCharacters: 100_000,
}

export function countContentLines(content: string): number {
  if (content.length === 0) return 0
  let lines = 1
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) lines += 1
  }
  return lines
}

export function createContentPreviewExcerpt(
  content: string,
  limits: ContentPreviewLimits,
): ContentPreviewExcerpt {
  if (!Number.isInteger(limits.maxLines) || limits.maxLines <= 0) {
    throw new Error('maxLines must be a positive integer')
  }
  if (!Number.isInteger(limits.maxCharacters) || limits.maxCharacters <= 0) {
    throw new Error('maxCharacters must be a positive integer')
  }
  if (content.length === 0) {
    return {
      content: '', truncated: false, shownLines: 0, totalLines: 0,
      shownCharacters: 0, totalCharacters: 0,
    }
  }

  let totalLines = 1
  let totalCharacters = 0
  let lineBoundary = content.length
  let characterBoundary = content.length
  for (let index = 0; index < content.length;) {
    if (totalCharacters === limits.maxCharacters && characterBoundary === content.length) {
      characterBoundary = index
    }
    const codeUnit = content.charCodeAt(index)
    if (codeUnit === 10) {
      if (totalLines === limits.maxLines && lineBoundary === content.length) lineBoundary = index
      totalLines += 1
    }
    const isSurrogatePair = codeUnit >= 0xD800 && codeUnit <= 0xDBFF
      && index + 1 < content.length
      && content.charCodeAt(index + 1) >= 0xDC00
      && content.charCodeAt(index + 1) <= 0xDFFF
    index += isSurrogatePair ? 2 : 1
    totalCharacters += 1
  }

  let end = Math.min(content.length, lineBoundary, characterBoundary)
  if (end > 0 && end < content.length) {
    const previousCodeUnit = content.charCodeAt(end - 1)
    if (previousCodeUnit >= 0xD800 && previousCodeUnit <= 0xDBFF) end -= 1
  }
  const excerpt = content.slice(0, end)
  let shownLines = excerpt.length > 0 ? 1 : 0
  let shownCharacters = 0
  for (let index = 0; index < excerpt.length;) {
    const codeUnit = excerpt.charCodeAt(index)
    if (codeUnit === 10) shownLines += 1
    const isSurrogatePair = codeUnit >= 0xD800 && codeUnit <= 0xDBFF
      && index + 1 < excerpt.length
      && excerpt.charCodeAt(index + 1) >= 0xDC00
      && excerpt.charCodeAt(index + 1) <= 0xDFFF
    index += isSurrogatePair ? 2 : 1
    shownCharacters += 1
  }

  return {
    content: excerpt,
    truncated: end < content.length,
    shownLines,
    totalLines,
    shownCharacters,
    totalCharacters,
  }
}
