import { describe, expect, it } from 'vitest'
import { ruleDownloadUrl } from './rule-download-url'

const cdn = 'https://testingcf.jsdelivr.net/gh/owner/repo@main/path/rules.list'

describe('rule download URLs', () => {
  it.each([
    'https://raw.githubusercontent.com/owner/repo/main/path/rules.list',
    'https://raw.githubusercontent.com/owner/repo/refs/heads/main/path/rules.list',
    'https://raw.githubusercontent.com/owner/repo/refs/tags/main/path/rules.list',
    'https://github.com/owner/repo/raw/main/path/rules.list',
    'https://github.com/owner/repo/raw/refs/heads/main/path/rules.list',
    'https://cdn.jsdelivr.net/gh/owner/repo@main/path/rules.list',
  ])('preserves the repository, ref and file when mapping %s', (url) => {
    expect(ruleDownloadUrl(url)).toBe(cdn)
  })
  it.each([
    'https://example.com/rules.list', cdn,
    'https://raw.githubusercontent.com/owner/repo/main/rules.list?token=private',
    'https://user:pass@raw.githubusercontent.com/owner/repo/main/rules.list',
    'https://github.com/owner/repo/releases/download/v1/rules.list',
    'https://raw.githubusercontent.com/owner/repo',
    'https://raw.githubusercontent.com.evil.example/owner/repo/main/rules.list',
  ])('does not rewrite unrelated, authenticated or unsupported URLs: %s', (url) => {
    expect(ruleDownloadUrl(url)).toBe(url)
  })
})
