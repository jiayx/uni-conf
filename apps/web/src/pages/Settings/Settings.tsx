import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader/PageHeader'
import { Card } from '@/components/ui/Card/Card'
import { useSettingsStore } from '@/store/settings.store'
import type { Language, ThemePreference } from '@uni-conf/types'
import styles from './Settings.module.css'

export function Settings() {
  const { t, i18n } = useTranslation()
  const { language, theme, setLanguage, setTheme } = useSettingsStore()

  const handleLanguage = (lang: Language) => {
    setLanguage(lang)
    void i18n.changeLanguage(lang)
  }

  return (
    <div className={styles.page}>
      <PageHeader title={t('settings.title')} />

      {/* Language */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.language')}</h2>
        <div className={styles.optionGroup}>
          {(['zh', 'en'] as Language[]).map(lang => (
            <button
              key={lang}
              className={`${styles.optionBtn} ${language === lang ? styles.active : ''}`}
              onClick={() => handleLanguage(lang)}
            >
              {lang === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </Card>

      {/* Theme */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.theme')}</h2>
        <div className={styles.optionGroup}>
          {(['system', 'light', 'dark'] as ThemePreference[]).map(th => (
            <button
              key={th}
              className={`${styles.optionBtn} ${theme === th ? styles.active : ''}`}
              onClick={() => setTheme(th)}
            >
              {th === 'system' ? `🖥 ${t('settings.theme_system')}` : th === 'light' ? `☀️ ${t('settings.theme_light')}` : `🌙 ${t('settings.theme_dark')}`}
            </button>
          ))}
        </div>
      </Card>

      {/* About */}
      <Card className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('settings.about')}</h2>
        <div className={styles.aboutGrid}>
          <div className={styles.aboutItem}>
            <span className={styles.aboutLabel}>{t('settings.version')}</span>
            <span className={styles.aboutValue}>0.1.0</span>
          </div>
          <div className={styles.aboutItem}>
            <span className={styles.aboutLabel}>Slogan</span>
            <span className={styles.aboutValue}>Manage once, export everywhere.</span>
          </div>
        </div>
      </Card>
    </div>
  )
}
