// 拆解收起态（视图 07）：源视频节点上的「已拆解 · N 镜」角标 + 可点回的「拆解结果」浮条。
//
// 为什么落节点：拆解结果本就属于那条源视频，收起态挂回它身上是最自然的家
// （一功能一个家，nomi-design-system.md §1.5；R-C-2）。点浮条 = 展开右槽那张表（状态不丢，R-C-3）。
//
// 只在「这条视频有拆解结果 且 面板当前没为它占槽」时渲染——面板开着时它自己就是那张表，不需要收起浮条。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronRight, IconScissors } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { NODE_DECONSTRUCTION_META_KEY, readNodeDeconstruction } from './deconstructionTypes'

type Props = { node: GenerationCanvasNode }

export default function NodeDeconstructionBadge({ node }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const nodeId = node.id
  const openNodeId = useGenerationCanvasStore((state) => state.videoDeconstructionOpenNodeId)
  const open = useGenerationCanvasStore((state) => state.openVideoDeconstruction)

  // 结果既可能已回填进 store 槽，也可能只在节点 meta（收起 / 重开项目）——两处都认。
  const entryResult = useGenerationCanvasStore((state) => state.videoDeconstructions[nodeId]?.result)
  const metaResult = React.useMemo(
    () => readNodeDeconstruction(node.meta as Record<string, unknown> | undefined),
    [node.meta],
  )
  const result = entryResult ?? metaResult
  const shotCount = result?.shots.length ?? 0

  // 只有视频节点、有拆解结果、且面板没为本节点占槽时才显示收起浮条。
  if (node.result?.type !== 'video' || shotCount === 0 || openNodeId === nodeId) return null

  const reopen = () =>
    open(nodeId, { title: node.title || '', videoUrl: node.result?.url || '' })

  return (
    <>
      {/* 节点头角标：已拆解 · N 镜（节点级可见性锚点，点它也能叫回面板）。 */}
      <button
        type="button"
        className={cn(
          'absolute -top-2.5 right-3 z-[3] inline-flex items-center gap-1 rounded-pill px-2 py-0.5 cursor-pointer',
          'bg-nomi-accent text-micro font-medium text-nomi-paper shadow-nomi-sm',
        )}
        data-decon-node-badge={nodeId}
        aria-label={t('generationCommon.node.deconstruct.reopenResult', { count: shotCount })}
        onClick={reopen}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <IconScissors size={11} stroke={2} aria-hidden />
        {t('generationCommon.node.deconstruct.resultBadge', { count: shotCount })}
      </button>

      {/* 收起浮条：随时点回、状态不丢。落节点左下角，不遮画面主体。 */}
      <button
        type="button"
        className={cn(
          'absolute bottom-3 left-3 z-[4] inline-flex items-center gap-2 rounded-full cursor-pointer',
          'border border-nomi-line bg-nomi-paper py-1 pl-2.5 pr-1.5 shadow-nomi-md hover:shadow-nomi-lg',
          'text-body-sm text-nomi-ink-80',
        )}
        data-decon-node-stub={nodeId}
        aria-label={t('generationCommon.node.deconstruct.reopenResult', { count: shotCount })}
        onClick={reopen}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="grid size-[18px] place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent">
          <IconScissors size={11} stroke={2} aria-hidden />
        </span>
        <span className="font-medium text-nomi-ink">{t('generationCommon.node.deconstruct.stubLabel')}</span>
        <span className="inline-flex items-center rounded-pill bg-nomi-accent px-1.5 py-0.5 text-micro tabular-nums text-nomi-paper">
          {t('generationCommon.node.deconstruct.shotCountBadge', { count: shotCount })}
        </span>
        <span className="grid size-5 place-items-center rounded-full text-nomi-ink-40">
          <IconChevronRight size={13} stroke={1.8} aria-hidden />
        </span>
      </button>
    </>
  )
}

// meta key 复用（供未来 Agent 入口写同一处）；此处仅引用点保持编译面一致。
void NODE_DECONSTRUCTION_META_KEY
