// 「把一个 URL 加进目标节点的数组参考槽」的**统一写入入口**（拖入 / 连线共用，规则 1 / §2.4：
// 不另开第 N 条写路径）。读 store 最新 meta（连续多次写时不丢前一次）→ appendArchetypeArrayValue
// 单源去重/上限 → updateNode 单帧持久化。toast 由调用方按返回状态决定（UI 关注点不进这里）。
import type { NodeWriteAccess } from './nodeWriteAccess'
import type { ModeGraph } from './controls/archetypeMeta'
import { appendArchetypeArrayValue, archetypeArrayWrite } from './controls/archetypeMeta'
import { readParkedReferences, readReferenceList, REFERENCE_LIST_KEY, withReferenceList } from './controls/referenceList'
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
export function addAssetUrlToNode(nodeId: string, kind: AssetDropKind, url: string, access: NodeWriteAccess, graph?: ModeGraph): AddAssetOutcome {
  if (access.canWrite?.() === false) return { status: 'empty' }
  const node = access.latestNode(nodeId)
  if (!node) return { status: 'no-slot' }
  const meta = node.meta || {}
  // 落哪一格按「放进去之后的输入」现算；连线也是输入，调用方给得出画布就给（不给只按节点自己的上传算）。
  const slot = findArraySlotForKind(resolveNodeArraySlots(node, graph ?? { nodes: [node], edges: [] }, kind), kind)
  if (!slot) return { status: 'no-slot' }
  const result = appendArchetypeArrayValue(meta, slot, url)
  if (result.status === 'full') return { status: 'full', max: result.max, label: slot.label }
  // 拖进来的正是列表里「先放一边」的那张（旧工程残留）：用户主动放 = 要用它，放回在用（#1269 条件 4）。
  if (result.status === 'duplicate' && slot.metaKey === REFERENCE_LIST_KEY && readParkedReferences(meta).includes(url.trim())) {
    access.updateNode(nodeId, { meta: withReferenceList(meta, readReferenceList(meta), { unpark: [url.trim()] }) })
    return { status: 'added' }
  }
  if (result.status !== 'added') return { status: result.status }
  access.updateNode(nodeId, { meta: archetypeArrayWrite(meta, slot.metaKey, result.next) })
  return { status: 'added' }
}
