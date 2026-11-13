// 把库条目自带的参考图落到一个节点上（提示词库「放上画布」用；设计卡 Q9：总是新建 + 带参考图 + 选中）。
//
// 规则与节点生成框里「提示词预设」那一条是同一把尺子：
// 落哪一格按「放进去之后」现算的摆法（不写方式进节点），走 addAssetUrlToNode 单源写入（去重 / 上限同一处）；
// 模型任何模式都不吃图参考 → 返回 'unsupported'，由调用方诚实地说「只放了文字」，不写死数据。
// 刚建出来、还没挑模型的卡（模型在生成框第一次挂载时才挑，useNodeModelAutoSelect）：图先放进「图片参考」那一格（与手动上传同一个键），
// 挑模型时按「卡上已有参考图」读改图 / 图生视频的默认偏好；那些图本身就是输入，发送时方式按它们现算。
import type { NodeWriteAccess } from './nodeWriteAccess'
import { withUnplacedArrayReferences } from './controls/archetypeMeta'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { nodeSelectedModelAddress } from './controls/parameterControlModel'
import { addAssetUrlToNode } from './nodeAssetWrite'
import type { AspectRatioPlacementOutcome } from '../../../../electron/shared/aspectRatioValue'

export type PromptReferenceOutcome = AspectRatioPlacementOutcome

export function applyPromptReferenceImages(nodeId: string, referenceUrls: readonly string[], access: NodeWriteAccess): PromptReferenceOutcome {
  const urls = referenceUrls.filter(Boolean)
  if (!urls.length) return 'none'
  const target = access.latestNode(nodeId)
  if (!target) return 'unsupported'
  const meta = (target.meta || {}) as Record<string, unknown>
  // 与生成框「这张卡还没选模型 → 自动挑默认」同一个判据（useNodeModelAutoSelect 的 selectedModelValue）。
  if (!nodeSelectedModelAddress(meta).modelKey) {
    if (access.canWrite?.() === false) return 'unsupported'
    access.updateNode(nodeId, { meta: withUnplacedArrayReferences(meta, 'image', urls) })
    return 'placed'
  }
  const state = useGenerationCanvasStore.getState()
  const outcomes = urls.map((url) => addAssetUrlToNode(nodeId, 'image', url, access, { nodes: state.nodes, edges: state.edges }))
  return outcomes.every((outcome) => outcome.status === 'no-slot') ? 'unsupported' : 'placed'
}
