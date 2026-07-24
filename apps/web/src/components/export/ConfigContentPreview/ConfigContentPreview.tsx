import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button/Button'
import { createContentPreviewExcerpt, type ContentPreviewLimits } from '@/core/export/content-preview'
import styles from './ConfigContentPreview.module.css'

interface ConfigContentPreviewProps extends ContentPreviewLimits {
  content: string
  codeClassName: string
}

export function ConfigContentPreview({
  content,
  codeClassName,
  maxLines,
  maxCharacters,
}: ConfigContentPreviewProps) {
  const { t } = useTranslation()
  const [expandedContent, setExpandedContent] = useState<string | null>(null)
  const excerpt = useMemo(
    () => createContentPreviewExcerpt(content, { maxLines, maxCharacters }),
    [content, maxCharacters, maxLines],
  )
  const expanded = expandedContent === content

  return (
    <>
      <pre className={codeClassName}>{expanded ? content : excerpt.content}</pre>
      {excerpt.truncated && (
        <div className={styles.controls}>
          <span>{expanded
            ? t('preview.full_content_shown', { lineCount: excerpt.totalLines, characterCount: excerpt.totalCharacters })
            : t('preview.content_truncated', {
              shownLines: excerpt.shownLines,
              totalLines: excerpt.totalLines,
              shownCharacters: excerpt.shownCharacters,
              totalCharacters: excerpt.totalCharacters,
            })}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpandedContent(expanded ? null : content)}
          >
            {t(expanded ? 'preview.show_compact' : 'preview.show_full')}
          </Button>
        </div>
      )}
    </>
  )
}
