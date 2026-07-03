import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SOURCE_FORMATS } from '@uni-conf/shared'

const i18nDir = join(process.cwd(), 'src/i18n')

describe('source i18n keys', () => {
  it('has labels for every supported subscription source format', () => {
    for (const locale of ['zh', 'en']) {
      const messages = readMessages(locale)
      for (const format of SOURCE_FORMATS) {
        expect(messages.sources[`format_${format}`], `${locale}: sources.format_${format}`).toBeTruthy()
      }
    }
  })
})

function readMessages(locale: string): { sources: Record<string, string> } {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8')) as { sources: Record<string, string> }
}
