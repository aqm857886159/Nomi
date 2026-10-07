import React from 'react'
import type { ModelOption } from '../../../config/models'
import { requiredModeForGenerationNode, useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { buildNodeModelChangePatch } from './buildNodeModelChangePatch'
import { nodeSelectedModelAddress } from './controls/parameterControlModel'
import { useNodeWriteAccess } from './nodeWriteAccess'
import { pickSameCapabilityAlternative } from './sameCapabilityAlternative'

/**
 * 「这个模型此刻上游用不了」时，失败卡上那颗「换成〈同能力的另一个〉」（2026-10-06 用户拍板：不自动换，点一下才换）。
 *
 * 同能力 = 同一个节点种类、同一个请求类型（文生图 / 改图 / 图生视频…，节点此刻要的那一档，`requiredModeForGenerationNode`）；
 * 当前是放大模型的，只在放大模型里找，反之不拿放大模型去顶普通改图。候选来自模型下拉同一份清单（已经只剩此刻可用的），
 * 取第一个——下拉的排序本来就是偏好 / 健康优先。
 *
 * 换模型走 `buildNodeModelChangePatch`（与用户在下拉里手动换同一条写入路径，参数按新档案重置、可撤销）；
 * 只换不跑：重新生成是花钱，由用户自己点。一个都没有就返回 null，失败卡退回「换个模型」（打开下拉）。
 */
export function useSameCapabilityAlternative(nodeId: string | undefined): { option: ModelOption; apply: () => void } | null {
  const node = useGenerationCanvasStore((state) => (nodeId ? state.nodes.find((candidate) => candidate.id === nodeId) : undefined))
  const { updateNode, latestNode } = useNodeWriteAccess()
  const requiredMode = React.useMemo(() => {
    if (!node) return undefined
    const { nodes, edges } = useGenerationCanvasStore.getState()
    return requiredModeForGenerationNode(node, { nodes, edges })
  }, [node])
  const options = useGenerationModelOptionsState(node?.kind ?? 'image', requiredMode).options

  const option = React.useMemo(() => {
    if (!node) return null
    return pickSameCapabilityAlternative(options, nodeSelectedModelAddress((node.meta ?? {}) as Record<string, unknown>))
  }, [node, options])

  const apply = React.useCallback(() => {
    if (!nodeId || !option) return
    const latest = latestNode(nodeId)
    if (!latest) return
    const { nodes, edges } = useGenerationCanvasStore.getState()
    updateNode(nodeId, buildNodeModelChangePatch({ node: latest, nodes, edges, modelOptions: options, value: option.modelKey || option.value, vendor: option.vendor }))
  }, [latestNode, nodeId, option, options, updateNode])

  return option ? { option, apply } : null
}
