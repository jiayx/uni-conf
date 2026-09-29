import { afterEach, expect, it, vi } from 'vitest'
import { clearStoredApiKey, getStoredApiKey, setStoredApiKey } from './auth'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

it('remembers an access key and forgets it when locking the browser', () => {
  expect(getStoredApiKey()).toBeNull()
  setStoredApiKey('test-key')
  expect(getStoredApiKey()).toBe('test-key')
  clearStoredApiKey()
  expect(getStoredApiKey()).toBeNull()
})

it('keeps authentication usable when browser storage is unavailable', () => {
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })
  }
  expect(getStoredApiKey()).toBeNull()
  expect(() => setStoredApiKey('test-key')).not.toThrow()
  expect(() => clearStoredApiKey()).not.toThrow()
})
