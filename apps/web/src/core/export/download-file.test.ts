import { describe, expect, it } from 'vitest'
import { parseContentDispositionFilename } from './download-file'

describe('export download filename helpers', () => {
  it('parses quoted and plain content-disposition filenames', () => {
    expect(parseContentDispositionFilename('attachment; filename="mihomo.yaml"', 'fallback.txt')).toBe('mihomo.yaml')
    expect(parseContentDispositionFilename('attachment; filename=singbox.json', 'fallback.txt')).toBe('singbox.json')
  })

  it('parses utf8 content-disposition filenames', () => {
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''%E9%85%8D%E7%BD%AE.yaml", 'fallback.txt')).toBe('配置.yaml')
  })

  it('falls back when filename is missing or invalid', () => {
    expect(parseContentDispositionFilename(null, 'fallback.txt')).toBe('fallback.txt')
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''%E0%A4%A", 'fallback.txt')).toBe('fallback.txt')
  })
})
