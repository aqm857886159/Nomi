// 「把一个 URL 加进目标节点的数组参考槽」的**统一写入入口**（拖入 / 连线共用，规则 1 / §2.4：
// 不另开第 N 条写路径）。读 store 最新 meta（连续多次写时不丢前一次）→ appendArchetypeArrayValue
// 单源去重/上限 → updateNode 单帧持久化。toast 由调用方按返回状态决定（UI 关注点不进这里）。
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { appendArchetypeArrayValue } from './controls/archetypeMeta'
import { type AssetDropKind, findArraySlotForKind, resolveNodeArraySlots } from '../model/nodeAssetDrop'

export type AddAssetOutcome =
  | { status: 'added' | 'duplicate' | 'empty' | 'no-slot' }
  | { status: 'full'; max: number; label: string }

/**
 * - `no-slot`：目标当前模式没有匹配该 kind 的数组槽 → 调用方可回退（如连线落普通边）。
 * - `empty`：有槽但 URL 为空（如 source 还没生成）→ 调用方提示，不写空串。
 * - `duplicate`：已存在，静默。
 * - `full`：到上限，调用方 toast。
 * - `added`：已写入。
 */
export function addAssetUrlToNode(nodeId: string, kind: AssetDropKind, url: string): AddAssetOutcome {
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((n) => n.id === nodeId)
  if (!node) return { status: 'no-slot' }
  const meta = node.meta || {}
  const slot = findArraySlotForKind(resolveNodeArraySlots(meta), kind)
  if (!slot) return { status: 'no-slot' }
  const result = appendArchetypeArrayValue(meta, slot, url)
  if (result.status === 'full') return { status: 'full', max: slot.max, label: slot.label }
  if (result.status !== 'added') return { status: result.status }
  state.updateNode(nodeId, { meta: { ...meta, [slot.metaKey]: result.next } })
  return { status: 'added' }
}
