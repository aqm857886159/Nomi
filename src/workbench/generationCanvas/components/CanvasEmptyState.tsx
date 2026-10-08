// 画布空状态（E.2C-24，从 GenerationCanvas 抽出，R9/R12 防巨壳）。
// 2026-10-08 用户拍板 ③ + Claude Design 拍板稿（EmptyStates）：一排起步格 = 图片 视频 声音 文字 剪辑 导入 更多，
// 种类 = 左缘工具条常驻那几样（canvasResidentAddIntents，同一张意图表、同一份用户显隐 / 排序偏好），点一个 = 工具条上同一个动作
// （canvasAddIntentActions）；「更多」点开 = 工具条最后那颗「+」同一个菜单（CanvasMoreAddMenu，「空间」一组）。
// 不新增种类，不加「双击画布」入口（Tab / 右键已有）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlus } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import { useCanvasMenuPreferenceStore } from '../store/canvasMenuPreferenceStore'
import { canvasResidentAddIntents } from './canvasToolbarModel'
import { intentActionLabel, intentCardLabel, intentIcon, useCanvasAddIntentAction } from './canvasAddIntentActions'
import { CanvasMoreAddMenu } from './CanvasToolbar'

type CanvasEmptyStateProps = {
  activeCategoryId: string
  /** 新卡的期望落点（同左缘工具条：视口锚换算的画布坐标，避让由 store.addNode 做）。 */
  getInsertionPosition: () => { x: number; y: number }
}

const TILE_CLASS = cn(
  'inline-flex h-16 w-[68px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-nomi border-0 bg-nomi-paper p-0',
  'font-[inherit] text-caption text-nomi-ink-80 shadow-nomi-sm ring-1 ring-inset ring-nomi-line',
  'transition-colors hover:bg-nomi-ink-05 active:bg-nomi-ink-10',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-nomi-accent',
  '[&>svg]:size-5 [&>svg]:text-nomi-ink-60',
)

export function CanvasEmptyState({ activeCategoryId, getInsertionPosition }: CanvasEmptyStateProps): JSX.Element {
  const { t } = useTranslation()
  const preference = useCanvasMenuPreferenceStore((state) => state.preference)
  const addIntent = useCanvasAddIntentAction({ getInsertionPosition, categoryId: activeCategoryId })
  const [moreOpen, setMoreOpen] = React.useState(false)
  const closeMore = React.useCallback(() => setMoreOpen(false), [])
  const supportedCategories = new Set(['shots', 'cast', 'scene', 'prop', 'audio'])
  const categoryKey = supportedCategories.has(activeCategoryId) ? activeCategoryId : 'fallback'
  const activeCategoryName = t(`generationCommon.canvas.empty.categories.${categoryKey}`)
  return (
    <div
      className={cn(
        'absolute top-[44%] left-1/2 flex flex-col items-center',
        '-translate-x-1/2 -translate-y-1/2',
      )}
    >
      <strong className="text-body font-semibold text-nomi-ink-80">
        {t('generationCommon.canvas.empty.title', { category: activeCategoryName })}
      </strong>
      {addIntent.pickerInput}
      <div data-empty-canvas-tasks="true" className="mt-4 flex max-w-[34rem] flex-wrap items-center justify-center gap-2">
        {canvasResidentAddIntents(preference).map((intent) => {
          const Icon = intentIcon(intent)
          return (
            <button
              key={intent.id}
              type="button"
              data-add-intent={intent.id}
              className={TILE_CLASS}
              aria-label={intentActionLabel(intent, t)}
              onClick={() => addIntent.run(intent)}
            >
              <Icon size={20} stroke={1.5} />
              <span>{intentCardLabel(intent, t)}</span>
            </button>
          )
        })}
        <div className="relative">
          <button
            type="button"
            data-canvas-add-more="true"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            className={cn(TILE_CLASS, moreOpen && 'bg-nomi-ink-05')}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <IconPlus size={20} stroke={1.5} />
            <span>{t('canvas.addSections.more')}</span>
          </button>
          {moreOpen ? (
            <CanvasMoreAddMenu
              className="absolute top-[calc(100%+8px)] right-0"
              onClose={closeMore}
              onPick={(intent) => { setMoreOpen(false); addIntent.run(intent) }}
            />
          ) : null}
        </div>
      </div>
      <span className="mt-3 text-caption text-nomi-ink-40">{t('generationCommon.canvas.empty.dropHint')}</span>
    </div>
  )
}
