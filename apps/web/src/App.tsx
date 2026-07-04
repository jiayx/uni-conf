import { RouterProvider } from 'react-router'
import { useEffect } from 'react'
import { router } from '@/app/router'
import { AuthGate } from '@/app/AuthGate'
import { useSettingsStore } from '@/store'
import i18n from '@/i18n'

export default function App() {
  const { theme, language, applyTheme } = useSettingsStore()

  useEffect(() => {
    applyTheme(theme)
  }, [theme, applyTheme])

  useEffect(() => {
    void i18n.changeLanguage(language)
  }, [language])

  return (
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  )
}
