import { describe, expect, it } from 'vitest'
import { countContentLines } from './content-preview'

describe('countContentLines', () => {
  it('counts lines without materializing a split array', () => {
    expect(countContentLines('')).toBe(0)
    expect(countContentLines('a')).toBe(1)
    expect(countContentLines('a\nb\n')).toBe(3)
  })
})
