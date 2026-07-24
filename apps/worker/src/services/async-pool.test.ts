import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './async-pool'

describe('mapWithConcurrency', () => {
  it('bounds active work and preserves input order', async () => {
    let active = 0
    let maxActive = 0
    const results = await mapWithConcurrency([30, 5, 20, 1, 10], 2, async (delay, index) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, delay))
      active -= 1
      return `result-${index}`
    })

    expect(maxActive).toBe(2)
    expect(results).toEqual(['result-0', 'result-1', 'result-2', 'result-3', 'result-4'])
  })

  it('rejects invalid concurrency values', async () => {
    await expect(mapWithConcurrency([1], 0, async value => value)).rejects.toThrow(RangeError)
  })
})
