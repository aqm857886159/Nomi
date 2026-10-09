import { notify } from '../../../ui/notificationPolicy'
import { FOCUS_GENERATION_NODE_EVENT } from './nodeSizing'
// 完成一次「画布连线」到 targetNode（拖把柄 / 点输入口共用，捷径 B）。
//
// 地基收口（audit 2026-06-16 §1d）：**所有参考连线一律建持久边**——含数组参考槽（image_ref，
// characterIndexed，按序 character1..N）。此前数组槽走 meta-only（写 referenceImageUrls + cancelConnection
// 早退、不画线），是因为 GenerationCanvasEdge 无 order 字段、N 条边无序、丢「谁是 character1」；
// 现在边带 order（connectNodes 按放入顺序赋值），数组参考用**有序的边**表达 → 线画得出、显示=生成
// 同一真相源（resolveReferenceSlots / resolveGenerationReferences 都按 order 落槽），不再分裂。
// 旧的权宜 toast「已作为参考图添加（不画连线）」随 meta-only 路径一并删除（P1：不留并行版）。
//
// 连边能力校验（validateReferenceEdge）仍在 connectToNode 里做总闸——错配参考槽等盲连
// 在创建期就拦；文本→图/视频的通用 reference 边作为 prompt 上下文放行。
// 本函数只负责把校验失败的人话反馈给手动连线的用户。
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { isTextPromptEdge } from '../agent/referenceEdgeCapability'
import { resolveReferenceSlots } from '../runner/referenceSlots'
import { readParameterReferenceSlots, resolveParameterReferenceAssignments } from '../model/parameterReferenceSlots'
import i18n from '../../../i18n'

export function completeNodeConnection(connectedNodeId: string, present?: (message: string) => void): void {
  const reportFeedback = (message: string) => {
    const feedback = { identity: `node-connection:${connectedNodeId}`, reason: 'connection-rejected', message }
    if (present) notify({ ...feedback, level: 'inline', present })
    else notify({ ...feedback, level: 'background', actionLabel: i18n.t('generationCommon.node.locateNode'), onAction: () => window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: connectedNodeId } })) })
  }
  // 连接成功后会清空待连态，先按端口方向算出真正 source/target（用于 D4 槽满检测）。
  const before = useGenerationCanvasStore.getState()
  const pendingNodeId = before.pendingConnectionSourceId
  const sourceNodeId = before.pendingConnectionSourceSide === 'left' ? connectedNodeId : pendingNodeId
  const targetNodeId = before.pendingConnectionSourceSide === 'left' ? pendingNodeId : connectedNodeId
  const verdict = before.connectToNode(connectedNodeId)
  if ('skipped' in verdict) {
    if (verdict.skipped > 0) reportFeedback(i18n.t(
      verdict.ok ? 'generationCommon.canvas.group.connectedWithSkips' : 'generationCommon.canvas.group.connectAllSkipped',
      { connected: verdict.connected, skipped: verdict.skipped, count: verdict.skipped },
    ))
    return
  }
  // 连边能力校验失败:给手动连线的用户即时反馈,而非静默不连(或落库后到生成期才被丢)。
  if (!verdict.ok && verdict.reason === 'source_not_referenceable') {
    reportFeedback(i18n.t('connection.sourceUnavailable'))
    return
  }
  if (!verdict.ok && verdict.reason === 'target_takes_no_input') {
    reportFeedback(i18n.t('connection.targetTakesNoInput'))
    return
  }
  if (!verdict.ok && verdict.reason === 'unsupported_reference') {
    const target = before.nodes.find((node) => node.id === targetNodeId)
    const declared = readParameterReferenceSlots(target?.meta)
    const filled = target && declared.length && resolveParameterReferenceAssignments(target, before.nodes, before.edges, declared)
      .every(({ slot, edge }) => edge || target.meta?.[slot.key])
    reportFeedback(filled ? i18n.t('connection.slotsFull', { max: declared.length }) : i18n.t('connection.unsupported'))
    return
  }
  // D4：边建了，但目标参考槽已满 → placeAt 把它丢弃（显示/发送都不含它）= 连了等于没连。
  // 用 resolveReferenceSlots(单源)判断这条新边有没有落进任一槽 fill；没落=槽满，明着提示而非静默。
  if (verdict.ok && sourceNodeId) {
    const { nodes, edges } = useGenerationCanvasStore.getState()
    const source = nodes.find((n) => n.id === sourceNodeId)
    const target = nodes.find((n) => n.id === targetNodeId)
    const hasPromptEdge = source && target && edges.some(
      (edge) => edge.source === sourceNodeId && edge.target === targetNodeId && isTextPromptEdge(source, target, edge.mode),
    )
    if (hasPromptEdge) return
    if (target) {
      if (resolveParameterReferenceAssignments(target, nodes, edges).some(({ edge }) => edge?.source === sourceNodeId)) return
      const slots = resolveReferenceSlots(target, nodes, edges)
      // 目标还没有模型档案（刚从连线菜单新建、模型稍后才挂上）= 没有声明任何槽，谈不上「满」：
      // 与 validateReferenceEdge「无档案一律放行」同口径。此前这里照报「该参考已满」，连线新建节点次次误报。
      if (slots.length === 0) return
      const landed = slots.some((s) => s.fills.some((f) => f.origin.type === 'edge' && f.origin.sourceNodeId === sourceNodeId))
      const hasEdge = edges.some((e) => e.source === sourceNodeId && e.target === targetNodeId)
      if (hasEdge && !landed) {
        const maxOfSlots = slots.some(s => s.max === undefined)
          ? 0
          : slots.reduce((m, s) => Math.max(m, s.max ?? 0), 0)
        reportFeedback(maxOfSlots > 0
            ? i18n.t('connection.slotsFull', { max: maxOfSlots })
            : i18n.t('connection.referenceFull'))
      }
    }
  }
}
