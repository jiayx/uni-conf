import { describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from './write-text'

function installClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

describe('writeClipboardText', () => {
  it('resolves only after the browser confirms the write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    installClipboard(writeText)

    await expect(writeClipboardText('config')).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledWith('config')
  })

  it('propagates permission failures to the calling UI', async () => {
    const denied = new Error('permission denied')
    const writeText = vi.fn().mockRejectedValue(denied)
    installClipboard(writeText)

    await expect(writeClipboardText('secret')).rejects.toBe(denied)
  })

  it('fails clearly when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })

    await expect(writeClipboardText('config')).rejects.toThrow('Clipboard API unavailable')
  })
})
