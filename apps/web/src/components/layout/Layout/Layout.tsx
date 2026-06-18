import { Outlet } from 'react-router'
import { Sidebar } from '../Sidebar/Sidebar'
import styles from './Layout.module.css'

export function Layout() {
  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
