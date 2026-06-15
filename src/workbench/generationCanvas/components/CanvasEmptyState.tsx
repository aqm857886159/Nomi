// 画布空状态 CTA（E.2C-24，从 GenerationCanvas 抽出，R9/R12 防巨壳）。
// 分类感知的引导按钮：根据当前分类显示「这里还没有 X / + 新建 X」，点一下落一个空节点。
import React from 'react'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'

const CATEGORY_NAME_BY_ID: Record<string, string> = {
  shots: '画面',
  cast: '角色',
  scene: '场景',
  prop: '道具',
  audio: '声音',
}

type CanvasEmptyStateProps = {
  activeCategoryId: string
  onCreate: () => void
}

export function CanvasEmptyState({ activeCategoryId, onCreate }: CanvasEmptyStateProps): JSX.Element {
  const activeCategoryName = CATEGORY_NAME_BY_ID[activeCategoryId] || '节点'
  return (
    <div className={cn(
      'absolute top-[44%] left-1/2 grid gap-3 place-items-center',
      'text-workbench-muted text-body-sm text-center',
      '-translate-x-1/2 -translate-y-1/2',
    )}>
      <strong className="text-body text-nomi-ink">这里还没有{activeCategoryName}</strong>
      <span className="text-caption text-nomi-ink-60 max-w-[300px]">
        添加第一个节点开始创作，之后可以拖动、分组、跨分类复制。
      </span>
      <WorkbenchButton
        className={cn(
          'mt-2 inline-flex items-center gap-1.5 min-h-[28px] px-4',
          'rounded-full border-0 bg-nomi-ink text-nomi-paper',
          'font-[inherit] text-caption font-medium',
          'hover:enabled:bg-nomi-accent',
        )}
        aria-label={`新建一个${activeCategoryName}节点`}
        onClick={onCreate}
      >
        + 新建{activeCategoryName}
      </WorkbenchButton>
    </div>
  )
}
