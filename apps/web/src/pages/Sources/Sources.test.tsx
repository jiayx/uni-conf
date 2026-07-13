import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sources } from './Sources'
import { api } from '@/lib/api'
import i18n from '@/i18n'

const store = vi.hoisted(() => ({
  fetchSources: vi.fn(async () => undefined),
  addSource: vi.fn(),
  importSource: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  refreshSource: vi.fn(),
}))

vi.mock('@/store/sources.store', () => ({
  useSourcesStore: () => ({
    sources: [], loading: false, refreshResults: {}, refreshErrors: {}, ...store,
  }),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      sources: { ...actual.api.sources, previewImport: vi.fn() },
    },
  }
})

describe('Sources import flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void i18n.changeLanguage('en')
  })

  it('previews a config before committing the import', async () => {
    vi.mocked(api.sources.previewImport).mockResolvedValue({
      detectedFormat: 'mihomo', nodeCount: 1, excludedCount: 0, sourceGroupCount: 1,
      groups: [{ name: 'Auto', memberNames: ['HK 01'] }],
      nodes: [{ name: 'HK 01', protocol: 'trojan', server: 'hk.example.com', port: 443, tags: [] }],
      importedObjects: ['nodes', 'source-groups'],
      preservedOnly: ['rules', 'remote-rule-sets', 'dns', 'client-settings'],
      structured: { rules: 0, remoteRuleSets: 0, skippedRules: 0, hasDns: true, clientSettingKeys: [] },
    })
    store.importSource.mockResolvedValue({
      source: { id: 's1' }, refresh: { success: true },
    })
    const user = userEvent.setup()
    render(<Sources />)

    await user.click(screen.getByRole('button', { name: 'Import Config' }))
    await user.type(screen.getByPlaceholderText(/Paste Clash\/Mihomo YAML/), `proxies:\n  - name: HK 01`)
    await user.click(screen.getByRole('button', { name: 'Preview Import' }))

    expect(await screen.findByText('Import Preview')).toBeInTheDocument()
    expect(screen.getByText(/1 nodes and 1 upstream groups/)).toBeInTheDocument()
    expect(store.importSource).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm Import' }))
    expect(store.importSource).toHaveBeenCalledOnce()
    expect(store.importSource).toHaveBeenCalledWith(expect.objectContaining({ importStructured: true }))
  })
})
