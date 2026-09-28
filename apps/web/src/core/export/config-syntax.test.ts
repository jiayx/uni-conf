import { describe, expect, it } from 'vitest'
import { highlightExportContent } from './config-syntax'

describe('config syntax highlighting', () => {
  it('highlights configuration without treating content as markup', async () => {
    const html = await highlightExportContent('proxies:\n  - name: "<node>"\n', 'mihomo')
    const container = document.createElement('div')
    container.innerHTML = html ?? ''

    expect(html).toContain('class="shiki')
    expect(container.textContent).toContain('<node>')
    expect(container.querySelector('node')).toBeNull()
  })
})
