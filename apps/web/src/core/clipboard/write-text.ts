export async function writeClipboardText(text: string): Promise<void> {
  const clipboard = navigator.clipboard
  if (!clipboard?.writeText) throw new Error('Clipboard API unavailable')
  await clipboard.writeText(text)
}
