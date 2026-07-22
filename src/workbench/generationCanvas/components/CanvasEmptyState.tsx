// 画布空状态 CTA（E.2C-24，从 GenerationCanvas 抽出，R9/R12 防巨壳）。
// 分类感知的引导按钮：根据当前分类显示「这里还没有 X / + 新建 X」，点一下落一个空节点。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'

type CanvasEmptyStateProps = {
  activeCategoryId: string
  onCreate: () => void
}

export function CanvasEmptyState({ activeCategoryId, onCreate }: CanvasEmptyStateProps): JSX.Element {
  const { t } = useTranslation()
  const supportedCategories = new Set(['shots', 'cast', 'scene', 'prop', 'audio'])
  const categoryKey = supportedCategories.has(activeCategoryId) ? activeCategoryId : 'fallback'
  const activeCategoryName = t(`generationCommon.canvas.empty.categories.${categoryKey}`)
  return (
    <div
      className={cn(
        'absolute top-[44%] left-1/2 grid gap-3 place-items-center',
        'text-workbench-muted text-body-sm text-center',
        '-translate-x-1/2 -translate-y-1/2',
      )}
    >
      <strong className="text-body text-nomi-ink">
        {t('generationCommon.canvas.empty.title', { category: activeCategoryName })}
      </strong>
      <span className="text-caption text-nomi-ink-60 max-w-[300px]">
        {t('generationCommon.canvas.empty.description')}
      </span>
      <WorkbenchButton
        className={cn(
          'mt-2 inline-flex items-center gap-1.5 min-h-[28px] px-4',
          'rounded-full border-0 bg-nomi-ink text-nomi-paper',
          'font-[inherit] text-caption font-medium',
          'hover:enabled:bg-nomi-accent',
        )}
        aria-label={t('generationCommon.canvas.empty.createAria', { category: activeCategoryName })}
        onClick={onCreate}
      >
        {t('generationCommon.canvas.empty.create', { category: activeCategoryName })}
      </WorkbenchButton>
    </div>
  )
}
