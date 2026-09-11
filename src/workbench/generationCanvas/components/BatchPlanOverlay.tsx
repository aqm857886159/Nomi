// 执行计划画布原位预览(harness S2b,获批样张方案 A):
// 波次徽标盖在节点左上角(① 先跑、②③ 等前置),被拦节点标 ⚠;顶部确认条一句话+价格+两个键。
// 外挂 overlay,不喂 GenerationCanvas/BaseGenerationNode 两个白名单巨壳(R12);
// 坐标随 React Flow 视口实时换算(screen = pos*zoom + offset),徽标不随缩放变大。
//
// F15 三缺补齐：
//   F11 价格——顶条显本波预估额度（解不出标「价格未知」，未知≠0）。
//   F10/F12 被拦可点下一步——⚠ 不再是裸符号：等待类（等定妆/等上游）走中性色 + 一句人话原因 + 点击聚焦
//     那张要处理的卡（去定妆/去生成上游）；真失败/环走 danger 色。
import React from 'react'
import { useViewport } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { IconListCheck } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { waveIndexByNode, type DependencyWavePlan } from '../runner/dependencyWaves'
import { FOCUS_GENERATION_NODE_EVENT } from '../nodes/nodeSizing'
import { useBatchPlanPreviewStore } from './batchPlanPreview'
import { useBatchPlanCost } from './useBatchPlanCost'

/** 等待类 blocked（在等一个还没做的前置，非失败）→ 中性/accent-soft 徽标；结构错误（环）→ danger。 */
function isWaitingReason(reason: DependencyWavePlan['blocked'][number]['reason']): boolean {
  return reason === 'unfrozen-anchor' || reason === 'missing-upstream'
}

/** unfrozen-anchor blocked 项 → 那张要去定妆的锚节点 id（sourceTitle 在 detail 里，但我们要的是节点，走边找）。 */
function anchorToFreezeForBlocked(
  blockedNodeId: string,
  edges: ReturnType<typeof useGenerationCanvasStore.getState>['edges'],
  nodes: ReturnType<typeof useGenerationCanvasStore.getState>['nodes'],
): string | null {
  // 该镜头的入边里，source 是「未定妆视觉锚」的那条。plan.edgesUsed 不含未冻结锚边，故直接扫 edges。
  for (const edge of edges) {
    if (edge.target !== blockedNodeId) continue
    const source = nodes.find((node) => node.id === edge.source)
    const meta = source?.meta as Record<string, unknown> | undefined
    if (meta?.referenceSheet === true) return edge.source
  }
  return null
}

export function BatchPlanOverlay() {
  const { t } = useTranslation()
  const plan = useBatchPlanPreviewStore((state) => state.plan)
  const cancel = useBatchPlanPreviewStore((state) => state.cancel)
  const confirm = useBatchPlanPreviewStore((state) => state.confirm)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  // 视口真相在 React Flow（框架自带 useViewport 按 x/y/zoom 三个标量浅比较，别在这里另写订阅）。
  // 迁移后这里读的是 store 里那两个没人写的字段，徽标恒画在 pos*1+0 —— 一缩放/平移就全错位。
  const { x: offsetX, y: offsetY, zoom } = useViewport()
  const planIds = React.useMemo(() => (plan ? plan.waves.flat() : []), [plan])
  const cost = useBatchPlanCost(planIds)
  if (!plan) return null

  const waveByNode = waveIndexByNode(plan)
  const blockedById = new Map(plan.blocked.map((item) => [item.nodeId, item]))
  const planCount = plan.waves.flat().length
  const firstWaveCount = plan.waves[0]?.length ?? 0

  // 点被拦徽标 → 聚焦「要处理的那张卡」：等定妆 → 选中并居中那张锚卡；其余 → 选中被拦镜头本身。
  // 走 FOCUS_GENERATION_NODE_EVENT（GenerationCanvas 监听：选中 + 居中，与副本角标「跳到源节点」同一机制）。
  const focusForBlocked = (blockedNodeId: string, reason: DependencyWavePlan['blocked'][number]['reason']): void => {
    const target =
      reason === 'unfrozen-anchor'
        ? anchorToFreezeForBlocked(blockedNodeId, edges, nodes) ?? blockedNodeId
        : blockedNodeId
    // 事件 handler 自己会切分类 + 选中 + 居中，这里只派发（别重复 selectNode，免得跨分类时闪一下）。
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: target } }))
    }
  }

  const costLabel =
    cost === null
      ? ''
      : cost.known
        ? t('generationCommon.batchPlan.estCost', { credits: cost.credits })
        : t('generationCommon.batchPlan.estCostUnknown')

  return (
    <div className={cn('absolute inset-0 z-40 pointer-events-none')} data-batch-plan-overlay>
      {nodes.map((node) => {
        const wave = waveByNode.get(node.id)
        const blockedInfo = blockedById.get(node.id)
        if (!wave && !blockedInfo) return null
        const left = node.position.x * zoom + offsetX
        const top = node.position.y * zoom + offsetY
        const waiting = blockedInfo ? isWaitingReason(blockedInfo.reason) : false
        return (
          <button
            type="button"
            key={node.id}
            className={cn(
              'absolute flex h-6 min-w-6 items-center justify-center rounded-full px-1',
              'text-micro font-medium border -translate-x-1/2 -translate-y-1/2',
              blockedInfo
                ? waiting
                  // 等待类：不穿红衣——中性 accent-soft，可点（去处理那张卡）。
                  ? 'bg-nomi-accent-soft text-nomi-accent border-nomi-accent cursor-pointer pointer-events-auto'
                  // 真失败/环：danger。
                  : 'bg-workbench-danger-soft text-workbench-danger border-workbench-danger cursor-pointer pointer-events-auto'
                : 'bg-nomi-accent-soft text-nomi-accent border-nomi-accent',
            )}
            style={{ left, top }}
            title={blockedInfo ? blockedInfo.detail : t('generationCommon.batchPlan.waveTitle', { wave })}
            onClick={blockedInfo ? () => focusForBlocked(node.id, blockedInfo.reason) : undefined}
            onPointerDown={(event) => event.stopPropagation()}
            disabled={!blockedInfo}
          >
            {blockedInfo ? (waiting ? '⏳' : '⚠') : wave}
          </button>
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
          {t('generationCommon.batchPlan.summary', { count: planCount, waves: plan.waves.length })}
        </span>
        <span className={cn('text-caption text-nomi-ink-60 whitespace-nowrap')}>
          {t('generationCommon.batchPlan.firstWave', { count: firstWaveCount })}
          {plan.blocked.length > 0 ? t('generationCommon.batchPlan.blocked', { count: plan.blocked.length }) : ''}
        </span>
        {costLabel ? (
          <span
            className={cn(
              'text-caption whitespace-nowrap',
              cost && cost.known ? 'text-nomi-ink-60' : 'text-nomi-ink-40',
            )}
            data-batch-plan-cost
          >
            {costLabel}
          </span>
        ) : null}
        <WorkbenchButton className={cn('h-7 min-h-7 px-3 cursor-pointer')} onClick={cancel}>
          {t('generationCommon.batchPlan.cancel')}
        </WorkbenchButton>
        <WorkbenchButton
          className={cn(
            'h-7 min-h-7 px-3 cursor-pointer bg-nomi-ink text-nomi-paper border-nomi-ink hover:bg-nomi-ink hover:text-nomi-paper',
          )}
          onClick={() => void confirm()}
          disabled={planCount === 0}
        >
          {t('generationCommon.batchPlan.generate')}
        </WorkbenchButton>
      </div>
    </div>
  )
}
