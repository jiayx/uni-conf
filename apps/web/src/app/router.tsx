import { createBrowserRouter, type RouteObject } from 'react-router'
import { Layout } from '@/components/layout/Layout/Layout'
import { Dashboard } from '@/pages/Dashboard/Dashboard'
import { Sources } from '@/pages/Sources/Sources'
import { Nodes } from '@/pages/Nodes/Nodes'
import { Collections } from '@/pages/Collections/Collections'
import { Groups } from '@/pages/Groups/Groups'
import { Rules } from '@/pages/Rules/Rules'
import { RemoteRuleSets } from '@/pages/RemoteRuleSets/RemoteRuleSets'
import { Export } from '@/pages/Export/Export'
import { Settings } from '@/pages/Settings/Settings'
import { NotFound } from '@/pages/NotFound/NotFound'

export const appRoutes: RouteObject[] = [
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
      { path: 'export', element: <Export /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

export const router = createBrowserRouter(appRoutes)
