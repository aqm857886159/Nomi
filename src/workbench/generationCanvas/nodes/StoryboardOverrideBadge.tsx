import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconX } from '../../../vendor/tablerIcons'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { nodeShotField, overriddenShotFields } from '../model/storyboardOverrides'

/** Resolution controls for canvas edits in the storyboard row. */
export function StoryboardOverrideBadge({ node, onResolve }: {
  node: GenerationCanvasNode
  onResolve: (field: string, action: 'adopt' | 'discard') => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const fields = overriddenShotFields(node)
  if (!fields.length) return null
  return (
    <div className="flex min-w-0 flex-col gap-1" data-storyboard-overrides={node.id}>
      {fields.map(field => {
        const value = String(nodeShotField(node, field) ?? '')
        return (
          <div key={field} className="flex min-w-0 flex-wrap items-center gap-2" data-storyboard-override-field={field}>
            <button type="button" onClick={() => onResolve(field, 'adopt')} className="inline-flex min-h-6 items-center gap-1 rounded-nomi-sm px-1.5 text-micro text-nomi-ink-60 hover:bg-nomi-ink-10">
              {t('storyboardEditor.overrides.adopt')}
            </button>
            <button type="button" onClick={() => onResolve(field, 'discard')} className="inline-flex min-h-6 items-center gap-1 rounded-nomi-sm px-1.5 text-micro text-nomi-ink-60 hover:bg-nomi-ink-10">
              <IconX size={12} stroke={1.5} aria-hidden />{t('storyboardEditor.overrides.discard')}
            </button>
            <span className="w-full truncate text-micro text-nomi-ink-40" title={value}>{t('storyboardEditor.overrides.effective', { value })}</span>
          </div>
        )
      })}
    </div>
  )
}
