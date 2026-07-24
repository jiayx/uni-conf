import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const i18nDir = join(process.cwd(), 'src/i18n')

describe('collection i18n keys', () => {
  it('keeps the complete node-group vocabulary aligned across locales', () => {
    const english = readCollections('en')
    const chinese = readCollections('zh')

    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort())
    for (const [key, value] of Object.entries(english)) {
      expect(value, `en: collections.${key}`).toBeTruthy()
      expect(chinese[key], `zh: collections.${key}`).toBeTruthy()
    }
  })
})

function readCollections(locale: string): Record<string, string> {
  const messages = JSON.parse(
    readFileSync(join(i18nDir, `${locale}.json`), 'utf8'),
  ) as { collections: Record<string, string> }
  return messages.collections
}
