// 节点的「执行面孔」：属于某个 Agent 批次的镜，把 Run 里的执行态投影到节点上（见 `projectShotExecution`）。
//
// 唯一的读口是 `useGenerationFeedback`（等待面 / 状态行 / 时间轴都经它）和节点的错误卡——
// Agent 派出去的镜因此与普通节点长得一模一样（2026-09-24 用户拍板：此前它走一层 8-25 的旧遮罩，
// 9-08 普通节点换成像素动画时没跟上）。
import React from 'react'
import { useTranslation } from 'react-i18next'

import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { deriveShotPlaceholderState, projectShotExecution, type ShotPlaceholderState } from './shotPlaceholderState'

export function productionRunIdOf(node: GenerationCanvasNode | null | undefined): string | null {
  const meta = node?.meta as Record<string, unknown> | undefined
  return typeof meta?.productionRunId === 'string' && meta.productionRunId ? meta.productionRunId : null
}

/** 这个节点在它所属 Run 里的执行态；不属于任何 Run、或 store 里缓存的不是这个 Run → null。 */
export function useProductionShotState(node: GenerationCanvasNode | null | undefined): ShotPlaceholderState | null {
  const runId = productionRunIdOf(node)
  const nodeId = node?.id ?? ''
  // 选出一个字符串而不是对象：store 每 1.5s 换一份 Run，派生出的对象每次都是新的；字符串相同就不重渲染。
  const key = useProductionCanvasLandingStore((store) => {
    const state = runId && store.run?.runId === runId ? deriveShotPlaceholderState(store.run, nodeId) : null
    return state ? JSON.stringify(state) : ''
  })
  return React.useMemo(() => (key ? JSON.parse(key) as ShotPlaceholderState : null), [key])
}

export function useProductionExecutionNode<T extends GenerationCanvasNode | null | undefined>(node: T): T {
  const { t } = useTranslation()
  const state = useProductionShotState(node)
  const failureFallback = t('generationCommon.production.canvasLanding.failedFallback')
  return React.useMemo(() => (node ? projectShotExecution(node, state, failureFallback) : node) as T, [node, state, failureFallback])
}
