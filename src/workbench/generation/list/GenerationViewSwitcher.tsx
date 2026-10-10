// 顶栏里的「画布 | 列表」小分段（外壳 #1136 在 40px 顶栏留的 viewSwitcher 槽，样张板 List 的 .seg.sm：24px 高、药丸槽）。
// 只在生成页出现（ShellTopBar 自己判）。两态同一个位置、各占一格，当前视图高亮；点另一格切过去。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { useGenerationViewStore, type GenerationView } from './generationViewStore'

export function GenerationViewSwitcher(): JSX.Element {
  const { t } = useTranslation()
  const view = useGenerationViewStore((state) => state.view)
  const setView = useGenerationViewStore((state) => state.setView)
  const tabs: Array<{ value: GenerationView; label: string }> = [
    { value: 'canvas', label: t('generationList.view.canvas') },
    { value: 'list', label: t('generationList.view.list') },
  ]
  return (
    <nav className="inline-flex h-6 items-center gap-0.5 rounded-full bg-nomi-ink-10 p-0.5" aria-label={t('generationList.view.aria')} data-generation-view-switcher={view}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={view === tab.value}
          data-view={tab.value}
          onClick={() => setView(tab.value)}
          className={cn(
            'inline-flex h-5 items-center rounded-full px-2.5 text-caption text-nomi-ink-60 transition-[background,color,box-shadow] hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent',
            view === tab.value && 'bg-nomi-paper font-medium text-nomi-ink shadow-nomi-sm',
          )}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
