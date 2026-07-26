import { Outlet } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sidebar } from '../Sidebar/Sidebar'
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog/ConfirmDialog'
import { SetupGuideDialog } from '@/components/onboarding/SetupGuideDialog/SetupGuideDialog'
import { UnsavedChangesProvider } from '@/core/forms/UnsavedChangesProvider'
import styles from './Layout.module.css'

export function Layout() {
  const { t } = useTranslation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const restoreMenuFocus = useRef(false)

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen)
  const closeSidebar = () => setSidebarOpen(false)

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth <= 768
      setIsMobile(nextIsMobile)
      if (!nextIsMobile) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isMobile || !sidebarOpen) {
      if (restoreMenuFocus.current) {
        window.setTimeout(() => menuButtonRef.current?.focus(), 0)
      }
      restoreMenuFocus.current = false
      return
    }

    restoreMenuFocus.current = true
    const sidebar = document.getElementById('primary-navigation')
    const focusable = Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
    const focusTimer = window.setTimeout(() => focusable[0]?.focus(), 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSidebar()
        return
      }
      if (event.key !== 'Tab' || focusable.length === 0) return

      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMobile, sidebarOpen])

  return (
    <ConfirmDialogProvider>
      <UnsavedChangesProvider>
        <div className={styles.layout}>
          <Sidebar isMobile={isMobile} isOpen={sidebarOpen} onClose={closeSidebar} />

          {/* Mobile overlay */}
          {sidebarOpen && (
            <div
              className={styles.overlay}
              onClick={closeSidebar}
              aria-hidden="true"
            />
          )}

          <main className={styles.main} inert={isMobile && sidebarOpen}>
            {/* Mobile header with menu button */}
            <div className={styles.mobileHeader}>
              <button
                type="button"
                ref={menuButtonRef}
                className={styles.menuButton}
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? t('nav.close_menu') : t('nav.open_menu')}
                aria-controls="primary-navigation"
                aria-expanded={sidebarOpen}
              >
                <MenuIcon />
              </button>
              <div className={styles.mobileLogoText}>UniConf</div>
            </div>

            <div className={styles.mainContent}>
              <Outlet />
            </div>
          </main>
        </div>
        <SetupGuideDialog />
      </UnsavedChangesProvider>
    </ConfirmDialogProvider>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}
