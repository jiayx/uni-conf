import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { ProxyRule } from '@uni-conf/types'
import i18n from '@/i18n'
import { Rules } from './Rules'

const stores = vi.hoisted(() => ({
  rules: {
    rules: [] as ProxyRule[],
    loading: false,
    error: null as string | null,
    fetchRules: vi.fn(async () => undefined),
    addRule: vi.fn(async () => undefined),
    updateRule: vi.fn(async () => undefined),
    setRulesEnabled: vi.fn(async () => undefined),
    deleteRule: vi.fn(async () => undefined),
    reorderRules: vi.fn(async () => undefined),
    batchAddRules: vi.fn(async () => undefined),
  },
  groups: {
    groups: [
      {
        id: 'builtin-proxy', name: 'PROXY', type: 'select', collectionIds: [], groupIds: [], builtins: [],
        enabled: true, order: 0, isBuiltin: true,
      },
      {
        id: 'builtin-direct', name: 'DIRECT', type: 'direct', collectionIds: [], groupIds: [], builtins: [],
        enabled: true, order: 1, isBuiltin: true,
      },
    ],
    fetchGroups: vi.fn(async () => undefined),
  },
}))

vi.mock('@/store/rules.store', () => ({ useRulesStore: () => stores.rules }))
vi.mock('@/store/groups.store', () => ({ useGroupsStore: () => stores.groups }))

describe('Rules filters', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
    stores.rules.rules = [
      makeRule('github', 'GitHub API', 'DOMAIN-SUFFIX', 'github.com', 'builtin-proxy', true, 0),
      makeRule('lan', 'Private LAN', 'IP-CIDR', '192.168.0.0/16', 'builtin-direct', true, 1),
      makeRule('legacy', 'Legacy Service', 'DOMAIN', 'legacy.example.com', 'builtin-proxy', false, 2),
    ]
  })

  it('combines rule type and status filters while preserving global order numbers', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    expect(await screen.findByText(/showing 3 of 3/)).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rule Type' }), 'DOMAIN')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'disabled')

    expect(screen.getByText('legacy.example.com')).toBeInTheDocument()
    expect(screen.queryByText('github.com')).not.toBeInTheDocument()
    expect(screen.getByText(/showing 1 of 3/)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    for (const button of screen.getAllByTitle('Clear filters before changing global rule priority.')) {
      expect(button).toBeDisabled()
    }

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('github.com')).toBeInTheDocument()
    expect(screen.getByText('192.168.0.0/16')).toBeInTheDocument()
  })

  it('searches names, targets, payloads, and notes and shows a filtered empty state', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    const search = await screen.findByRole('textbox', { name: 'Search' })
    await user.type(search, 'DIRECT')
    expect(screen.getByText('192.168.0.0/16')).toBeInTheDocument()
    expect(screen.queryByText('github.com')).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'does-not-exist')
    expect(screen.getByRole('heading', { name: 'No matching manual rules' })).toBeInTheDocument()
    expect(screen.getByText('Try another match value, rule type, policy, or status.')).toBeInTheDocument()
  })

  it('selects the current filtered result and applies one batch enable update', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status' }), 'disabled')
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible manual rules' }))

    expect(screen.getByText('Selected manual rules: 1')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Legacy Service' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Enable selected' }))

    expect(stores.rules.setRulesEnabled).toHaveBeenCalledWith(['legacy'], true)
    expect(screen.queryByText('Selected manual rules: 1')).not.toBeInTheDocument()
  })

  it('blocks a mixed valid/invalid batch and identifies the invalid line', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Batch Add Manual Rules' }))
    const textbox = screen.getByRole('textbox', { name: 'Rule Text' })
    await user.type(
      textbox,
      'DOMAIN-SUFFIX,ok.example,PROXY{enter}UNKNOWN,bad.example,PROXY{enter}DOMAIN,sensitive.example,TYPO-DIRECT{enter}DOMAIN,option.example,PROXY,script',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Line 2: unsupported rule type “UNKNOWN”.')
    expect(alert).toHaveTextContent('Line 3: target policy “TYPO-DIRECT” does not exist or is disabled.')
    expect(alert).toHaveTextContent('Line 4: unsupported option “script”.')
    expect(alert).toHaveTextContent('Fix or remove every invalid line before saving.')
    expect(stores.rules.batchAddRules).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Batch target-client impact' }))
      .toHaveTextContent('4 candidate lines: 1 valid, 3 invalid')
  })

  it('summarizes batch conversions, omissions, and unsupported rules by client', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Batch Add Manual Rules' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Rule Text' }),
      'PORT,443,PROXY,no-resolve{enter}DOMAIN-SUFFIX,example.com,PROXY{enter}NETWORK,icmp,PROXY',
    )

    const impact = screen.getByRole('region', { name: 'Batch target-client impact' })
    expect(impact).toHaveTextContent('3 candidate lines: 3 valid, 0 invalid')
    expect(within(within(impact).getByRole('row', { name: /Mihomo \/ Clash \/ OpenClash/ }))
      .getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1', '1', '0', '1', '1'])
    expect(within(within(impact).getByRole('row', { name: /sing-box/ }))
      .getAllByRole('cell').map(cell => cell.textContent)).toEqual(['3', '0', '0', '0', '1'])
    expect(within(within(impact).getByRole('row', { name: /QuantumultX/ }))
      .getAllByRole('cell').map(cell => cell.textContent)).toEqual(['0', '1', '0', '2', '1'])
  })

  it('validates semantic payloads before single or batch API calls', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Add Manual Rule' }))
    const editor = screen.getByRole('dialog', { name: 'Add Manual Rule' })
    await user.selectOptions(within(editor).getByLabelText('Rule Type'), 'PORT')
    await user.type(within(editor).getByLabelText('Match Value'), '70000')
    await user.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(within(editor).getByRole('alert')).toHaveTextContent(
      'Enter a port from 1 to 65535 or an ascending range such as 8000-9000.',
    )
    expect(stores.rules.addRule).not.toHaveBeenCalled()

    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Batch Add Manual Rules' }))
    await user.type(screen.getByRole('textbox', { name: 'Rule Text' }), 'IP-CIDR,999.1.1.1/24,DIRECT')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Line 1: Enter a valid IPv4 CIDR, such as 10.0.0.0/8.',
    )
    expect(stores.rules.batchAddRules).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('previews exact target-client conversions and omissions before saving', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Add Manual Rule' }))
    const editor = screen.getByRole('dialog', { name: 'Add Manual Rule' })
    await user.selectOptions(within(editor).getByLabelText('Rule Type'), 'PORT')
    await user.type(within(editor).getByLabelText('Match Value'), '443')

    expect(within(editor).getByRole('region', { name: 'Target client result' })).toBeInTheDocument()
    expect(within(editor).getByRole('article', { name: 'Mihomo / Clash / OpenClash: Convert' }))
      .toHaveTextContent('PORT,443 → DST-PORT,443')
    expect(within(editor).getByRole('article', { name: 'Surge: Convert' }))
      .toHaveTextContent('PORT,443 → DEST-PORT,443')
    expect(within(editor).getByRole('article', { name: 'QuantumultX: Unsupported' }))
      .toHaveTextContent('PORT,443 → Not exported')

    await user.selectOptions(within(editor).getByLabelText('Rule Type'), 'DOMAIN-SUFFIX')
    await user.clear(within(editor).getByLabelText('Match Value'))
    await user.type(within(editor).getByLabelText('Match Value'), 'example.com')
    expect(within(editor).getByRole('article', { name: 'QuantumultX: Convert' }))
      .toHaveTextContent('DOMAIN-SUFFIX,example.com → HOST-SUFFIX,example.com')

    await user.selectOptions(within(editor).getByLabelText('Rule Type'), 'IP-CIDR')
    await user.clear(within(editor).getByLabelText('Match Value'))
    await user.type(within(editor).getByLabelText('Match Value'), '10.0.0.0/8')
    await user.click(within(editor).getByRole('checkbox', { name: 'No Resolve' }))
    expect(within(editor).getByRole('article', { name: 'QuantumultX: Partial' }))
      .toHaveTextContent('The no-resolve option is omitted for this target.')
  })

  it('keeps unsaved rule edits until discarding is confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Add Manual Rule' }))
    const editor = screen.getByRole('dialog', { name: 'Add Manual Rule' })
    await user.type(within(editor).getByLabelText('Match Value'), 'example.com')
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Your current edits have not been saved. Discard them and leave?',
    )
    expect(editor).toBeInTheDocument()
    expect(within(editor).getByLabelText('Match Value')).toHaveValue('example.com')

    confirmSpy.mockReturnValue(true)
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Add Manual Rule' })).not.toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('keeps the batch dialog open and shows an API failure', async () => {
    stores.rules.batchAddRules.mockRejectedValueOnce(new Error('database unavailable'))
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Batch Add Manual Rules' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Rule Text' }),
      'DOMAIN-SUFFIX,ok.example,PROXY',
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('database unavailable')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Batch Add Manual Rules' })).toBeInTheDocument()
  })

  it('blocks more than 500 valid rules before calling the API', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Batch Add Manual Rules' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Rule Text' }), {
      target: {
        value: Array.from({ length: 501 }, (_, index) =>
          `DOMAIN-SUFFIX,batch-${index}.example,PROXY`
        ).join('\n'),
      },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert')).toHaveTextContent('A batch can contain at most 500 manual rules.')
    expect(stores.rules.batchAddRules).not.toHaveBeenCalled()
  })

  it('keeps the editor open and reports a save failure', async () => {
    stores.rules.updateRule.mockRejectedValueOnce(new Error('save conflict'))
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('save conflict')
    expect(screen.getByRole('dialog', { name: 'Edit Manual Rule' })).toBeInTheDocument()
  })

  it('reports row and reorder failures without changing the rendered order', async () => {
    stores.rules.updateRule.mockRejectedValueOnce(new Error('toggle failed'))
    stores.rules.reorderRules.mockRejectedValueOnce(new Error('stale order'))
    const user = userEvent.setup()
    render(<MemoryRouter><Rules /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Disable' }))[0]!)
    expect(await screen.findByRole('alert')).toHaveTextContent('toggle failed')

    await user.click(screen.getAllByTitle('Move down')[0]!)
    expect(await screen.findByRole('alert')).toHaveTextContent('stale order')
    const orderCells = screen.getAllByText(/^[123]$/).map(cell => cell.textContent)
    expect(orderCells).toEqual(expect.arrayContaining(['1', '2', '3']))
    expect(screen.getByRole('button', { name: 'Delete GitHub API' })).toBeInTheDocument()
  })
})

function makeRule(
  id: string,
  name: string,
  type: ProxyRule['type'],
  payload: string,
  targetGroupId: string,
  enabled: boolean,
  order: number,
): ProxyRule {
  return {
    id,
    name,
    type,
    payload,
    targetGroupId,
    noResolve: false,
    enabled,
    order,
    compatibility: [],
    notes: name === 'Private LAN' ? 'Local network' : '',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  }
}
