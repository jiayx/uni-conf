import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import {
  GLOBAL_NODE_OUTLET_GROUP_IDS,
  RULE_TARGET_FOUNDATION_GROUP_IDS,
} from '@uni-conf/shared'
import type { AppSettings, ProxyGroup } from '@uni-conf/types'
import i18n from '@/i18n'
import { Groups } from './Groups'

const mocks = vi.hoisted(() => ({
  fetchGroups: vi.fn(async () => undefined),
  addGroup: vi.fn(async () => undefined),
  updateGroup: vi.fn(async () => undefined),
  deleteGroup: vi.fn(async () => undefined),
  reorderGroups: vi.fn(async () => undefined),
  applySettings: vi.fn(),
  updateSettings: vi.fn(),
}))

const outlet = makeGroup(GLOBAL_NODE_OUTLET_GROUP_IDS[0]!, 'Node Select', false, [])
outlet.outletRef = 'global:node-select'
outlet.collectionIds = ['collection-1']
const groups: ProxyGroup[] = [
  makeGroup(RULE_TARGET_FOUNDATION_GROUP_IDS[0]!, 'PROXY', true, [outlet.id]),
  outlet,
  makeGroup('builtin-ai', 'AI', true, [outlet.id]),
  makeGroup('custom-one', 'Custom One', false, []),
  makeGroup('custom-two', 'Custom Two', false, []),
]

const settings: AppSettings = {
      language: 'en', theme: 'system', unmatchedTrafficPolicy: 'proxy', routingPolicyTemplate: 'common', dnsMode: 'smart',
  exportNodeNamingMode: 'smart', showCompatibilityWarnings: true, enableAutoRefresh: true,
  ruleSetConversionPolicy: 'compatible',
  autoRefreshInterval: 1440, autoNodeGroupsEnabled: true, autoNodeGroupTypes: ['url-test'],
  autoNodeGroupIncludeFlag: true, routingOutletPreferences: {},
}

vi.mock('@/store/groups.store', () => ({
  useGroupsStore: () => ({ groups, loading: false, error: null, ...mocks }),
}))
vi.mock('@/store/settings.store', () => ({
  useSettingsStore: (selector: (state: { applySettings: typeof mocks.applySettings }) => unknown) => selector({ applySettings: mocks.applySettings }),
}))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: {
        ...actual.api.settings,
        get: vi.fn(async () => settings),
        update: mocks.updateSettings,
      },
      remoteRuleSets: {
        ...actual.api.remoteRuleSets,
        list: vi.fn(async () => [{
          id: 'proxy-list',
          name: 'Proxy List',
          url: 'https://example.com/proxy.list',
          format: 'text' as const,
          behavior: 'domain' as const,
          sourceOverrides: {},
          targetGroupId: RULE_TARGET_FOUNDATION_GROUP_IDS[0]!,
          updateInterval: 24,
          enabled: true,
          sortOrder: 1,
          compatibility: [],
          createdAt: '',
          updatedAt: '',
        }]),
      },
    },
  }
})

describe('Groups information hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateSettings.mockResolvedValue(settings)
    void i18n.changeLanguage('en')
  })

  it('keeps foundation details collapsed and exposes the default outlet directly', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><Groups /></MemoryRouter>)

    const foundation = await screen.findByText('Foundation Targets and Node Outlets')
    expect(foundation.closest('details')).not.toHaveAttribute('open')
    const outlet = screen.getByRole('combobox', { name: 'Default outlet' })
    expect(outlet).toBeVisible()
    await user.selectOptions(outlet, 'global:node-select')
    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledWith({
      routingOutletPreferences: { 'builtin-ai': 'global:node-select' },
    }))
    expect(document.querySelector('[aria-pressed="true"]')).toBeInTheDocument()
  })

  it('shows rule sets targeting the base PROXY policy in the effective summary', async () => {
    render(<MemoryRouter><Groups /></MemoryRouter>)

    expect((await screen.findByText('1 rule sets')).closest('summary')).toHaveTextContent('PROXY')
  })

  it('keeps the edit dialog open and shows the write error when saving fails', async () => {
    const user = userEvent.setup()
    mocks.updateGroup.mockRejectedValueOnce(new Error('group update failed'))
    render(<MemoryRouter><Groups /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Changed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('group update failed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Type' })).toBeInTheDocument()
  })

  it('preserves the visible order and reports a reorder failure', async () => {
    const user = userEvent.setup()
    mocks.reorderGroups.mockRejectedValueOnce(new Error('stale group order'))
    render(<MemoryRouter><Groups /></MemoryRouter>)

    await user.click((await screen.findAllByTitle('Move down'))[0]!)

    expect(await screen.findByRole('alert')).toHaveTextContent('stale group order')
    expect(screen.getByText('Custom One')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Custom One' })).toBeInTheDocument()
  })

  it('preserves a changed custom policy when discard is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<MemoryRouter><Groups /></MemoryRouter>)

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!)
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Draft Policy')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(confirmSpy).toHaveBeenCalledWith(
      'Your current edits have not been saved. Discard them and leave?',
    )
    expect(screen.getByRole('dialog', { name: 'Edit' })).toBeInTheDocument()
    expect(name).toHaveValue('Draft Policy')
    confirmSpy.mockRestore()
  })
})

function makeGroup(id: string, name: string, isBuiltin: boolean, groupIds: string[]): ProxyGroup {
  return {
    id, name, type: 'select', collectionIds: [], groupIds, builtins: [], enabled: true, order: 1,
    isBuiltin, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
