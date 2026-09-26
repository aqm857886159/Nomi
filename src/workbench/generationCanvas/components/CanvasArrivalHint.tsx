import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUp } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore } from '../../workbenchStore'
import { categoryDisplayName } from '../../project/projectCategories'
import type { TranslationKey } from '../../../i18n/translationKey'
import type { ArrivalDirection, ArrivalHint } from './canvasArrivalModel'

const ARROW: Record<ArrivalDirection, typeof IconArrowRight> = { right: IconArrowRight, left: IconArrowLeft, up: IconArrowUp, down: IconArrowDown }

const LABEL_ONE = {
  right: 'generationCommon.canvas.arrival.one.right',
  left: 'generationCommon.canvas.arrival.one.left',
  up: 'generationCommon.canvas.arrival.one.up',
  down: 'generationCommon.canvas.arrival.one.down',
} as const satisfies Record<ArrivalDirection, TranslationKey>

const LABEL_MANY = {
  right: 'generationCommon.canvas.arrival.many.right',
  left: 'generationCommon.canvas.arrival.many.left',
  up: 'generationCommon.canvas.arrival.many.up',
  down: 'generationCommon.canvas.arrival.many.down',
} as const satisfies Record<ArrivalDirection, TranslationKey>

/**
 * 画布边缘提示（2026-09-25 用户拍板，样张 v1：一颗胶囊，方向 + 几个 + 箭头；点了过去、自己消失）。
 *
 * 任务卡：刚让 Agent / 导入 / 复制建了东西的人，在新东西不在屏幕里的那一刻，知道它在哪、点一下到那儿，就走。
 * 刻意没放：缩略图（新节点多半还没出图）、× 关闭（看见了 / 点了 / 被删了它自己消失）、「不再提示」
 * （关掉它就回到「找不到」）、逐个列出（一批一颗；侧栏节点树仍能逐个定位）。
 *
 * 位置：贴在新东西所在那一侧的画布边缘。左边让开左缘工具条，底边抬到底部缩放条 / 时间轴胶囊 / 批量条之上。
 */
export function CanvasArrivalHint({ hint, onGo }: { hint: ArrivalHint; onGo: () => void }): JSX.Element {
  const { t } = useTranslation()
  const categories = useWorkbenchStore((state) => state.categories)
  const many = hint.count > 1
  let label: string
  let Arrow = IconArrowRight
  if (hint.kind === 'category') {
    const category = categories.find((entry) => entry.id === hint.categoryId)
    const name = categoryDisplayName(category ?? { id: hint.categoryId, name: hint.categoryId })
    label = many
      ? t('generationCommon.canvas.arrival.categoryMany', { count: hint.count, category: name })
      : t('generationCommon.canvas.arrival.categoryOne', { category: name })
  } else {
    Arrow = ARROW[hint.direction]
    label = many
      ? t(LABEL_MANY[hint.direction], { count: hint.count })
      : t(LABEL_ONE[hint.direction])
  }
  const side = hint.kind === 'category' ? 'right' : hint.direction
  return (
    <button
      type="button"
      data-canvas-arrival-hint={side}
      data-arrival-count={hint.count}
      title={t('generationCommon.canvas.arrival.go')}
      onClick={(event) => { event.stopPropagation(); onGo() }}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'absolute z-[9] inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-nomi-line bg-nomi-paper px-3',
        'text-caption font-medium text-nomi-ink shadow-nomi-md cursor-pointer',
        'transition-[background] duration-nomi-fast ease-nomi-fast hover:bg-nomi-ink-05',
        side === 'right' && 'right-3 top-1/2 -translate-y-1/2',
        side === 'left' && 'left-16 top-1/2 -translate-y-1/2',
        side === 'up' && 'left-1/2 top-3 -translate-x-1/2',
        side === 'down' && 'bottom-20 left-1/2 -translate-x-1/2',
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-nomi-accent" />
      <span>{label}</span>
      <Arrow size={14} stroke={1.6} aria-hidden="true" />
    </button>
  )
}
