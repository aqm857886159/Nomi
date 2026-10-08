// 画布节点上通往列表的两件小东西（样张板 E「画布角标」）：
//   - 分镜镜头左上角的「镜 03」角标：号就是分镜方案里的镜序，与列表那张卡同一个号；
//   - 选中时标题行右端的「在列表里看」：切到列表并打开这一张。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLayoutList } from '@tabler/icons-react'
import { useWorkbenchStore } from '../../workbenchStore'
import { stableShotId } from '../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { generationListRole } from './generationListModel'
import { useGenerationViewStore } from './generationViewStore'

/** 这个节点绑定的分镜镜序（不是分镜镜头 = null）。只读方案，不写任何东西。 */
function useStoryboardShotNumber(node: GenerationCanvasNode): number | null {
  const meta = node.meta as Record<string, unknown> | undefined
  const designId = typeof meta?.storyboardDesignId === 'string' ? meta.storyboardDesignId : ''
  const shotId = typeof meta?.shotId === 'string' ? meta.shotId : ''
  const keyframe = meta?.storyboardKeyframe === true
  return useWorkbenchStore((state) => {
    if (!designId || !shotId || keyframe || node.regeneratedFrom || node.derivedFrom) return null
    for (const designs of Object.values(state.storyboardDesignsByDocumentId)) {
      const design = designs.find((candidate) => candidate.id === designId)
      const shot = design?.plan.shots.find((candidate) => stableShotId(candidate) === shotId)
      if (shot) return shot.index
    }
    return null
  })
}

export function StoryboardShotBadge({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const number = useStoryboardShotNumber(node)
  if (number == null) return null
  return (
    <span
      data-storyboard-shot-badge={number}
      className="pointer-events-none absolute left-2 top-2 z-[3] rounded-pill bg-nomi-ink px-1.5 py-0.5 text-micro font-medium tabular-nums text-nomi-paper shadow-nomi-sm"
    >
      {t('generationList.shot', { index: String(number).padStart(2, '0') })}
    </span>
  )
}

export function ViewInListButton({ node }: { node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  if (generationListRole(node) === 'asset') return null
  return (
    <button
      type="button"
      data-view-in-list={node.id}
      className="nodrag ml-auto inline-flex shrink-0 items-center gap-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-1.5 py-0.5 text-caption text-nomi-accent hover:bg-nomi-accent-soft"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        useGenerationViewStore.getState().openListAt(node.id)
      }}
    >
      <IconLayoutList size={13} stroke={1.7} aria-hidden />
      {t('generationList.viewInList')}
    </button>
  )
}
