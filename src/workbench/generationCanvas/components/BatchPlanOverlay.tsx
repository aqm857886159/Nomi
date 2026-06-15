// 执行计划画布原位预览(harness S2b,获批样张方案 A):
// 波次徽标盖在节点左上角(① 先跑、②③ 等前置),被拦节点标 ⚠;顶部确认条一句话+两个键。
// 外挂 overlay,不喂 GenerationCanvas/BaseGenerationNode 两个白名单巨壳(R12);
// 坐标随 store 的 zoom/offset 实时换算(screen = pos*zoom + offset),徽标不随缩放变大。
import React from 'react'
import { cn } from '../../../utils/cn'
import { IconListCheck } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { waveIndexByNode } from '../runner/dependencyWaves'
import { useBatchPlanPreviewStore } from './batchPlanPreview'

export function BatchPlanOverlay() {
  const plan = useBatchPlanPreviewStore((state) => state.plan)
  const cancel = useBatchPlanPreviewStore((state) => state.cancel)
  const confirm = useBatchPlanPreviewStore((state) => state.confirm)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const zoom = useGenerationCanvasStore((state) => state.canvasZoom)
  const offset = useGenerationCanvasStore((state) => state.canvasOffset)
  if (!plan) return null

  const waveByNode = waveIndexByNode(plan)
  const blockedById = new Map(plan.blocked.map((item) => [item.nodeId, item]))
  const planCount = plan.waves.flat().length
  const firstWaveCount = plan.waves[0]?.length ?? 0

  return (
    <div className={cn('absolute inset-0 z-40 pointer-events-none')} data-batch-plan-overlay>
      {nodes.map((node) => {
        const wave = waveByNode.get(node.id)
        const blockedInfo = blockedById.get(node.id)
        if (!wave && !blockedInfo) return null
        const left = node.position.x * zoom + offset.x
        const top = node.position.y * zoom + offset.y
        return (
          <span
            key={node.id}
            className={cn(
              'absolute flex h-6 min-w-6 items-center justify-center rounded-full px-1',
              'text-micro font-medium border -translate-x-1/2 -translate-y-1/2',
              blockedInfo
                ? 'bg-workbench-danger-soft text-workbench-danger border-workbench-danger'
                : 'bg-nomi-accent-soft text-nomi-accent border-nomi-accent',
            )}
            style={{ left, top }}
            title={blockedInfo ? blockedInfo.detail : `第 ${wave} 波执行`}
          >
            {blockedInfo ? '⚠' : wave}
          </span>
        )
      })}
      <div
        className={cn(
          'pointer-events-auto absolute left-1/2 top-3 -translate-x-1/2',
          'flex items-center gap-3 rounded-nomi border border-nomi-line bg-nomi-paper py-2 px-3 shadow-nomi-md',
        )}
      >
        <IconListCheck size={16} className={cn('shrink-0 text-nomi-accent')} aria-hidden />
        <span className={cn('text-body-sm font-medium text-nomi-ink whitespace-nowrap')}>
          执行计划 · {planCount} 个节点 · {plan.waves.length} 波
        </span>
        <span className={cn('text-caption text-nomi-ink-60 whitespace-nowrap')}>
          第 1 波 {firstWaveCount} 个并行,确认前不调用不扣费
          {plan.blocked.length > 0 ? ` · ${plan.blocked.length} 个被拦(看 ⚠)` : ''}
        </span>
        <WorkbenchButton className={cn('h-7 min-h-7 px-3 cursor-pointer')} onClick={cancel}>
          取消
        </WorkbenchButton>
        <WorkbenchButton
          className={cn('h-7 min-h-7 px-3 cursor-pointer bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-ink hover:text-nomi-paper')}
          onClick={() => void confirm()}
          disabled={planCount === 0}
        >
          按计划生成
        </WorkbenchButton>
      </div>
    </div>
  )
}
