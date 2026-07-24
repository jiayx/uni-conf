import { describe, expect, it } from 'vitest'
import { countContentLines, createContentPreviewExcerpt } from './content-preview'

describe('createContentPreviewExcerpt', () => {
  it('counts lines without materializing a split array', () => {
    expect(countContentLines('')).toBe(0)
    expect(countContentLines('a')).toBe(1)
    expect(countContentLines('a\nb\n')).toBe(3)
  })

  it('keeps small content unchanged', () => {
    expect(createContentPreviewExcerpt('a\nb', { maxLines: 2, maxCharacters: 10 })).toEqual({
      content: 'a\nb', truncated: false, shownLines: 2, totalLines: 2,
      shownCharacters: 3, totalCharacters: 3,
    })
  })

  it('cuts at a complete line boundary', () => {
    expect(createContentPreviewExcerpt('a\nb\nc', { maxLines: 2, maxCharacters: 100 })).toEqual({
      content: 'a\nb', truncated: true, shownLines: 2, totalLines: 3,
      shownCharacters: 3, totalCharacters: 5,
    })
  })

  it('bounds huge single-line subscriptions by character count', () => {
    const result = createContentPreviewExcerpt('abcdefghij', { maxLines: 5, maxCharacters: 4 })
    expect(result).toMatchObject({ content: 'abcd', truncated: true, shownLines: 1, totalLines: 1 })
  })

  it('does not leave a dangling UTF-16 high surrogate', () => {
    const result = createContentPreviewExcerpt('a😀b', { maxLines: 5, maxCharacters: 1 })
    expect(result.content).toBe('a')
    expect(result.truncated).toBe(true)

    const twoCharacters = createContentPreviewExcerpt('a😀b', { maxLines: 5, maxCharacters: 2 })
    expect(twoCharacters.content).toBe('a😀')
    expect(twoCharacters.shownCharacters).toBe(2)
    expect(twoCharacters.totalCharacters).toBe(3)
  })

  it('rejects invalid limits', () => {
    expect(() => createContentPreviewExcerpt('x', { maxLines: 0, maxCharacters: 1 })).toThrow('maxLines')
    expect(() => createContentPreviewExcerpt('x', { maxLines: 1, maxCharacters: 1.5 })).toThrow('maxCharacters')
  })
})
