import { describe, expect, it } from 'vitest'
import en from './en.json'
import zh from './zh.json'

function messages(value: object, prefix = ''): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, text]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof text === 'string' ? [[path, text]] : Object.entries(messages(text, path))
  }))
}

describe('translations', () => {
  it('provides matching non-empty messages and interpolation variables in both languages', () => {
    const english = messages(en)
    const chinese = messages(zh)
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort())
    for (const [key, text] of Object.entries(english)) {
      expect(text.trim(), `en: ${key}`).not.toBe('')
      expect(chinese[key]?.trim(), `zh: ${key}`).not.toBe('')
      expect(chinese[key]?.match(/{{[^}]+}}/g)?.sort(), key).toEqual(text.match(/{{[^}]+}}/g)?.sort())
    }
  })
})
