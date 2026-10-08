// 画布空状态（E.2C-24，从 GenerationCanvas 抽出，R9/R12 防巨壳）。
// 2026-10-08 用户拍板 ③：「添加第一个节点…」那句说明和单个「+ 新建图片」换成一排任务卡——
// 种类 = 左缘工具条常驻那几样（canvasResidentAddIntents，同一张意图表、同一份用户显隐 / 排序偏好），
// 点一张 = 工具条上同一个动作（canvasAddIntentActions）。不新增种类，不加「双击画布」入口（Tab / 右键已有）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionCard } from '../../../design'
import { cn } from '../../../utils/cn'
import { useCanvasMenuPreferenceStore } from '../store/canvasMenuPreferenceStore'
import { canvasResidentAddIntents } from './canvasToolbarModel'
import { intentActionLabel, intentCardLabel, intentIcon, useCanvasAddIntentAction } from './canvasAddIntentActions'

type CanvasEmptyStateProps = {
  activeCategoryId: string
  /** 新卡的期望落点（同左缘工具条：视口锚换算的画布坐标，避让由 store.addNode 做）。 */
  getInsertionPosition: () => { x: number; y: number }
}

export function CanvasEmptyState({ activeCategoryId, getInsertionPosition }: CanvasEmptyStateProps): JSX.Element {
  const { t } = useTranslation()
  const preference = useCanvasMenuPreferenceStore((state) => state.preference)
  const addIntent = useCanvasAddIntentAction({ getInsertionPosition, categoryId: activeCategoryId })
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
      {addIntent.pickerInput}
      <div data-empty-canvas-tasks="true" className="mt-2 flex w-max gap-2">
        {canvasResidentAddIntents(preference).map((intent) => {
          const Icon = intentIcon(intent)
          return (
            <ActionCard
              key={intent.id}
              data-add-intent={intent.id}
              icon={<Icon size={18} stroke={1.7} />}
              title={intentCardLabel(intent, t)}
              description=""
              aria-label={intentActionLabel(intent, t)}
              className="h-14 w-auto min-w-[112px] gap-2.5 px-3 [&>span:first-child]:size-8"
              onClick={() => addIntent.run(intent)}
            />
          )
        })}
      </div>
    </div>
  )
}
