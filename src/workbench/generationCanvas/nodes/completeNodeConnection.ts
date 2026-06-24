// 完成一次「画布连线」到 targetNode（拖把柄 / 点输入口共用，捷径 B）。
//
// 地基收口（audit 2026-06-16 §1d）：**所有参考连线一律建持久边**——含数组参考槽（image_ref，
// characterIndexed，按序 character1..N）。此前数组槽走 meta-only（写 referenceImageUrls + cancelConnection
// 早退、不画线），是因为 GenerationCanvasEdge 无 order 字段、N 条边无序、丢「谁是 character1」；
// 现在边带 order（connectNodes 按放入顺序赋值），数组参考用**有序的边**表达 → 线画得出、显示=生成
// 同一真相源（resolveReferenceSlots / resolveGenerationReferences 都按 order 落槽），不再分裂。
// 旧的权宜 toast「已作为参考图添加（不画连线）」随 meta-only 路径一并删除（P1：不留并行版）。
//
// 连边能力校验（validateReferenceEdge）仍在 connectToNode 里做总闸——文本→图、错配参考槽等盲连
// 在创建期就拦，不落库到生成期才被丢。本函数只负责把校验失败的人话反馈给手动连线的用户。
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { showInfoToast } from '../../../utils/showInfoToast'
import { resolveReferenceSlots } from '../runner/referenceSlots'

export function completeNodeConnection(targetNodeId: string): void {
  // 连接成功后会清空 pendingConnectionSourceId，先存下来（用于 D4 槽满检测）。
  const sourceNodeId = useGenerationCanvasStore.getState().pendingConnectionSourceId
  const verdict = useGenerationCanvasStore.getState().connectToNode(targetNodeId)
  // 连边能力校验失败:给手动连线的用户即时反馈,而非静默不连(或落库后到生成期才被丢)。
  if (!verdict.ok && verdict.reason === 'source_not_referenceable') {
    showInfoToast('这个节点没有可作为参考的图/视频，先生成它或换个来源')
    return
  }
  if (!verdict.ok && verdict.reason === 'unsupported_reference') {
    showInfoToast('目标模型不支持这种参考连线')
    return
  }
  // D4：边建了，但目标参考槽已满 → placeAt 把它丢弃（显示/发送都不含它）= 连了等于没连。
  // 用 resolveReferenceSlots(单源)判断这条新边有没有落进任一槽 fill；没落=槽满，明着提示而非静默。
  if (verdict.ok && sourceNodeId) {
    const { nodes, edges } = useGenerationCanvasStore.getState()
    const target = nodes.find((n) => n.id === targetNodeId)
    if (target) {
      const slots = resolveReferenceSlots(target, nodes, edges)
      const landed = slots.some((s) => s.fills.some((f) => f.origin.type === 'edge' && f.origin.sourceNodeId === sourceNodeId))
      const hasEdge = edges.some((e) => e.source === sourceNodeId && e.target === targetNodeId)
      if (hasEdge && !landed) {
        const maxOfSlots = slots.reduce((m, s) => Math.max(m, s.max), 0)
        showInfoToast(maxOfSlots > 0 ? `参考槽已满（最多 ${maxOfSlots} 个），多出的连线不会被使用` : '该参考已满，多出的连线不会被使用')
      }
    }
  }
}
