// 视觉锚「定妆」（写 meta.frozen）的**唯一操作者**（纯 action，别塞进 BaseGenerationNode 巨壳）。
//
// 冻结门（dependencyWaves W2 / productionRun / core 单镜提醒）三处都读 `meta.frozen` 来拦下游镜头，
// 但在此之前**全仓没有任何生产代码写它**——门造了、门把手从来没装（F15 死锁根因）。这里补上那个把手：
// 用户在锚卡上点「定妆」= 视觉确认这张参考卡的形象定了 → 写 `{ at, by:'user' }` → 下游镜头才放行。
//
// 判据/键名走 anchorBibleKeys 单一镜像（与 headless 冻结门同语义，electron equivalence 钉死）。
// 写入务必**全量 spread 旧 meta**：漏了 `referenceSheet` 这张卡就不再是「视觉锚」，冻结门直接对它失明
// （F15 破案 case D：半个 meta spread 是隐形的第二个坑）。

import { ANCHOR_META_KEYS, isVisualAnchorNode, isAnchorFrozen, type AnchorFrozenMark } from '../model/anchorBibleKeys'
import { hasUsableResult } from '../runner/generationScopeFacts'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/** 这个节点现在是不是「已定妆」的视觉锚（供 UI 决定按钮态；非锚恒 false）。 */
export function isAnchorLookConfirmed(node: GenerationCanvasNode | undefined | null): boolean {
  return isVisualAnchorNode(node) && isAnchorFrozen(node)
}

/** 定妆：把这张视觉锚标记为「形象已确认」。非视觉锚 = no-op（防误调）。返回是否真的写入。 */
export function confirmAnchorLook(nodeId: string): boolean {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!isVisualAnchorNode(node) || !node) return false
  if (isAnchorFrozen(node)) return true // 幂等：已定妆
  const frozen: AnchorFrozenMark = { at: Date.now(), by: 'user' }
  // 全量 spread 旧 meta —— 别丢 referenceSheet（否则这张卡不再算锚，冻结门失明）。
  store.updateNode(nodeId, { meta: { ...(node.meta || {}), [ANCHOR_META_KEYS.frozen]: frozen } })
  return true
}

/** 撤销定妆：删掉 frozen 标记（改了参考图要重新确认形象时用）。非锚/未冻结 = no-op。 */
export function undoAnchorLook(nodeId: string): boolean {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!isVisualAnchorNode(node) || !node || !isAnchorFrozen(node)) return false
  const nextMeta = { ...(node.meta || {}) }
  delete nextMeta[ANCHOR_META_KEYS.frozen]
  store.updateNode(nodeId, { meta: nextMeta })
  return true
}

/** 定妆开关（按当前态翻转）：UI 一个按钮承载「定妆 / 撤销定妆」。 */
export function toggleAnchorLook(nodeId: string): void {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (isAnchorFrozen(node)) undoAnchorLook(nodeId)
  else confirmAnchorLook(nodeId)
}

/**
 * 节点 `meta.frozen` 统一开关（分镜行 / 参考卡 / 画布与列表节点工具栏唯一写口）：
 * - 视觉锚：确认形象（放行引用它的下游镜头进批量）；
 * - 普通已生成镜头：标记定稿（跳过批量重跑，仍可单独重生成；非编辑锁）。
 */
export function toggleNodeBatchFrozen(nodeId: string): void {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  if (isAnchorFrozen(node)) {
    const nextMeta = { ...(node.meta || {}) }
    delete nextMeta[ANCHOR_META_KEYS.frozen]
    store.updateNode(nodeId, { meta: nextMeta })
    return
  }
  if (!hasUsableResult(node)) return
  const frozen: AnchorFrozenMark = { at: Date.now(), by: 'user' }
  store.updateNode(nodeId, { meta: { ...(node.meta || {}), [ANCHOR_META_KEYS.frozen]: frozen } })
}

const NON_BATCH_FREEZE_KINDS = new Set(['asset', 'panorama', 'whiteboard', 'agent-artifact', 'director', 'clip', 'shot_table'])

/**
 * 节点工具栏的「定妆（视觉锚）/ 定稿跳过批量（普通已出片节点）」属性集。
 * isAnchor 时最左显文字钮「定妆」；普通已出片节点显紧凑图标钮 `toggle-frozen`（守 4 颗文字钮行宽预算）。
 */
export function anchorFreezeToolbarProps(node: GenerationCanvasNode): {
  isAnchor: boolean
  canFreezeShot: boolean
  frozen: boolean
  onToggleFreeze?: () => void
} {
  const isAnchor = isVisualAnchorNode(node)
  const canFreezeShot = !isAnchor && hasUsableResult(node) && !NON_BATCH_FREEZE_KINDS.has(node.kind)
  return {
    isAnchor,
    canFreezeShot,
    frozen: isAnchorFrozen(node),
    onToggleFreeze: isAnchor
      ? () => toggleAnchorLook(node.id)
      : canFreezeShot
        ? () => toggleNodeBatchFrozen(node.id)
        : undefined,
  }
}
