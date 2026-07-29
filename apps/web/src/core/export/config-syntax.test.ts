import { describe, expect, it } from 'vitest'
import { getExportSyntaxLanguage, highlightExportContent } from './config-syntax'

describe('config syntax highlighting', () => {
  it('maps export formats to the supported preview languages', () => {
    expect(getExportSyntaxLanguage('singbox')).toBe('json')
    expect(getExportSyntaxLanguage('mihomo')).toBe('yaml')
    expect(getExportSyntaxLanguage('surge')).toBe('ini')
    expect(getExportSyntaxLanguage('nodes_base64')).toBeNull()
    expect(getExportSyntaxLanguage('nodes_raw')).toBeNull()
  })

  it('highlights configuration without treating content as markup', async () => {
    const html = await highlightExportContent('proxies:\n  - name: "<node>"\n', 'mihomo')
    const container = document.createElement('div')
    container.innerHTML = html ?? ''

    expect(html).toContain('class="shiki')
    expect(container.textContent).toContain('<node>')
    expect(container.querySelector('node')).toBeNull()
  })
})
