// 完成一次「画布连线」到 targetNode（拖把柄 / 点输入口共用，捷径 B）。
// 设计要点（不碰 store.connectToNode 的边逻辑 → 边语义可证不变）：
// - target 当前模式有「匹配 source kind 的数组参考槽」→ **meta-only 写入数组、不画持久边**
//   （评审 M6：数组绝不变持久边，否则崩 (target,mode) 唯一性 / 回归全能参考）。
// - 否则原样调 store.connectToNode（首/尾帧等单帧连线的边语义完全不动）。
// - source 还没生成（无结果 URL）→ 提示先生成，不写空串、不建死边。
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { resultPreviewUrl } from './controls/parameterControlModel'
import { showInfoToast } from '../../../utils/showInfoToast'
import { dropKindFromNodeKind } from '../model/nodeAssetDrop'
import { addAssetUrlToNode } from './nodeAssetWrite'

export function completeNodeConnection(targetNodeId: string): void {
  const state = useGenerationCanvasStore.getState()
  const sourceId = state.pendingConnectionSourceId
  const source = sourceId ? state.nodes.find((n) => n.id === sourceId) : undefined
  if (source && sourceId !== targetNodeId) {
    const kind = dropKindFromNodeKind(source.kind)
    if (kind) {
      const outcome = addAssetUrlToNode(targetNodeId, kind, resultPreviewUrl(source))
      if (outcome.status !== 'no-slot') {
        // 是数组参考目标：meta-only，绝不落边。
        if (outcome.status === 'empty') showInfoToast('请先生成该节点，再连线为参考')
        else if (outcome.status === 'full') showInfoToast(`最多 ${outcome.max} 个${outcome.label}`)
        state.cancelConnection()
        return
      }
    }
  }
  const verdict = state.connectToNode(targetNodeId)
  // 连边能力校验失败:给手动连线的用户即时反馈,而非静默不连(或落库后到生成期才被丢)。
  if (!verdict.ok && verdict.reason === 'source_not_referenceable') {
    showInfoToast('这个节点没有可作为参考的图/视频，先生成它或换个来源')
  } else if (!verdict.ok && verdict.reason === 'unsupported_reference') {
    showInfoToast('目标模型不支持这种参考连线')
  }
}
