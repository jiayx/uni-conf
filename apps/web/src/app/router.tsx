import { createBrowserRouter } from 'react-router'
import { Layout } from '@/components/layout/Layout/Layout'
import { Dashboard } from '@/pages/Dashboard/Dashboard'
import { Sources } from '@/pages/Sources/Sources'
import { Nodes } from '@/pages/Nodes/Nodes'
import { Collections } from '@/pages/Collections/Collections'
import { Groups } from '@/pages/Groups/Groups'
import { Rules } from '@/pages/Rules/Rules'
import { RemoteRuleSets } from '@/pages/RemoteRuleSets/RemoteRuleSets'
import { Templates } from '@/pages/Templates/Templates'
import { Export } from '@/pages/Export/Export'
import { Preview } from '@/pages/Preview/Preview'
import { Settings } from '@/pages/Settings/Settings'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'sources', element: <Sources /> },
      { path: 'nodes', element: <Nodes /> },
      { path: 'collections', element: <Collections /> },
      { path: 'groups', element: <Groups /> },
      { path: 'rules', element: <Rules /> },
      { path: 'remote-rule-sets', element: <RemoteRuleSets /> },
      { path: 'templates', element: <Templates /> },
      { path: 'export', element: <Export /> },
      { path: 'preview', element: <Preview /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
])
