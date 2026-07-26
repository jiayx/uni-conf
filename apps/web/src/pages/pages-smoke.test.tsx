import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import i18n from '@/i18n'
import { Dashboard } from './Dashboard/Dashboard'
import { Export } from './Export/Export'
import { Preview } from './Preview/Preview'
import { Collections } from './Collections/Collections'
import { Groups } from './Groups/Groups'
import { Nodes } from './Nodes/Nodes'
import { Rules } from './Rules/Rules'
import { RemoteRuleSets } from './RemoteRuleSets/RemoteRuleSets'

const hooks = vi.hoisted(() => {
  const fn = () => vi.fn(async () => undefined)
  return ({
  collections: { collections: [], previews: {}, loading: false, error: null, fetchCollections: fn(), addCollection: fn(), updateCollection: fn(), deleteCollection: fn(), previewCollection: fn() },
  groups: { groups: [], loading: false, error: null, fetchGroups: fn(), addGroup: fn(), updateGroup: fn(), deleteGroup: fn(), reorderGroups: fn() },
  nodes: { nodes: [], loading: false, error: null, fetchNodes: fn(), addNode: fn(), updateNode: fn(), setNodesEnabled: fn(), deleteNode: fn() },
  rules: { rules: [], loading: false, error: null, fetchRules: fn(), addRule: fn(), updateRule: fn(), setRulesEnabled: fn(), deleteRule: fn(), reorderRules: fn(), batchAddRules: fn() },
  sources: { sources: [], loading: false, error: null, refreshResults: {}, refreshErrors: {}, fetchSources: fn(), addSource: fn(), importSource: fn(), updateSource: fn(), deleteSource: fn(), refreshSource: fn() },
  settings: { language: 'en', theme: 'system', unmatchedTrafficPolicy: 'proxy', routingPolicyTemplate: 'common', exportNodeNamingMode: 'smart', showCompatibilityWarnings: true, ruleSetConversionPolicy: 'compatible', enableAutoRefresh: true, autoRefreshInterval: 1440, autoNodeGroupsEnabled: true, autoNodeGroupTypes: ['url-test'], autoNodeGroupIncludeFlag: true, applySettings: vi.fn() },
  })
})

vi.mock('@/store/collections.store', () => ({ useCollectionsStore: () => hooks.collections }))
vi.mock('@/store/groups.store', () => ({ useGroupsStore: () => hooks.groups }))
vi.mock('@/store/nodes.store', () => ({ useNodesStore: () => hooks.nodes }))
vi.mock('@/store/rules.store', () => ({ useRulesStore: () => hooks.rules }))
vi.mock('@/store/sources.store', () => ({ useSourcesStore: () => hooks.sources }))
vi.mock('@/store/settings.store', () => ({
  useSettingsStore: (selector?: (state: typeof hooks.settings) => unknown) => selector ? selector(hooks.settings) : hooks.settings,
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  const settings = { ...hooks.settings }
  return {
    ...actual,
    api: {
      ...actual.api,
      dashboard: { stats: vi.fn(async () => ({ sources: 0, nodes: 0, enabledNodes: 0, rules: 0 })) },
      settings: { get: vi.fn(async () => settings), update: vi.fn(async () => settings) },
      sources: { list: vi.fn(async () => []), create: vi.fn() },
      nodes: { get: vi.fn() },
      collections: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn() },
      groups: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn() },
      rules: { list: vi.fn(async () => []) },
      remoteRuleSets: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
      export: { listConfigs: vi.fn(async () => []), previewFormat: vi.fn(), downloadFormat: vi.fn(), createConfig: vi.fn(), updateConfig: vi.fn(), deleteConfig: vi.fn() },
    },
  }
})

describe('main page smoke rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void i18n.changeLanguage('en')
  })

  for (const [name, Component, title] of [
    ['Dashboard', Dashboard, 'Dashboard'],
    ['Export', Export, 'Config Export'],
    ['Preview', Preview, 'Config Preview'],
    ['Collections', Collections, 'Node Groups'],
    ['Groups', Groups, 'Routing Plan'],
    ['Nodes', Nodes, 'Node List'],
    ['Rules', Rules, 'Manual Traffic Rules'],
    ['Remote rule sets', RemoteRuleSets, 'Rule Set Management'],
  ] as const) {
    it(`renders ${name} without existing data`, async () => {
      render(<MemoryRouter><Component /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    })
  }

  for (const [name, Component, action] of [
    ['advanced export', Export, 'New Advanced Export Profile'],
    ['node group', Collections, 'New Node Group'],
    ['policy group', Groups, 'Add Custom Policy Group'],
    ['manual node', Nodes, 'Manual Entry'],
    ['manual rule', Rules, 'Add Manual Rule'],
    ['supplemental rule set', RemoteRuleSets, 'Add Supplemental Rule Set'],
  ] as const) {
    it(`opens the ${name} creation flow`, async () => {
      const user = userEvent.setup()
      render(<MemoryRouter><Component /></MemoryRouter>)

      await user.click((await screen.findAllByRole('button', { name: action }))[0])

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })
  }
})
