// 物化幂等章的**唯一 owner**（P1：此前 capabilityApplyHandler 与 multiShotCanvasLanding 各手写了一份）。
//
// 守的不变量：**同一个 (materializationOperationId, materializationClientId) 在画布上最多一个节点。**
// 判据归写边界所有，不归调用方——这跟 HTTP 的 `Idempotency-Key` 是同一条道理：调用方只负责给一个
// 稳定 key，「这次要不要真建」由被调用方说了算。少了这条，每多一个落地入口就多一份去重实现，
// 而其中任何一份漏了，用户看到的就是 agent 重试堆出的重复节点。
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/** 章的两个 meta 键名（节点上持久化的就是这两个）。 */
export const MATERIALIZATION_OPERATION_META_KEY = 'materializationOperationId'
export const MATERIALIZATION_CLIENT_META_KEY = 'materializationClientId'

export type MaterializationStamp = { operationId: string; clientId: string }

/** operationId 的合法形状（跨 RPC 来的串要挡住脏值，避免脏 op 章污染画布 meta）。 */
const OPERATION_ID_RE = /^[A-Za-z0-9._:-]{1,240}$/

export function sanitizeMaterializationOperationId(value: unknown): string | undefined {
  return typeof value === 'string' && OPERATION_ID_RE.test(value) ? value : undefined
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 从一个 create_canvas_nodes 的节点入参里读章（章住在 `metadata`，与节点 meta 的键名一致）。 */
export function readNodeInputStamp(raw: unknown): MaterializationStamp | null {
  const node = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}
  const operationId = sanitizeMaterializationOperationId(trimmed(metadata[MATERIALIZATION_OPERATION_META_KEY]))
  const clientId = trimmed(metadata[MATERIALIZATION_CLIENT_META_KEY])
  return operationId && clientId ? { operationId, clientId } : null
}

/** 章的复合键。两段一起才是身份：同一 clientId 在不同 operation 下是两个节点。 */
export function materializationKey(stamp: MaterializationStamp): string {
  return `${stamp.operationId} ${stamp.clientId}`
}

/** 画布上已带章的节点：复合键 → 节点 id。纯函数（喂快照即可单测）。 */
export function indexMaterializedNodes(
  nodes: readonly Pick<GenerationCanvasNode, 'id' | 'meta'>[],
): Map<string, string> {
  const index = new Map<string, string>()
  for (const node of nodes) {
    const meta = node.meta as Record<string, unknown> | undefined
    if (!meta) continue
    const operationId = trimmed(meta[MATERIALIZATION_OPERATION_META_KEY])
    const clientId = trimmed(meta[MATERIALIZATION_CLIENT_META_KEY])
    if (!operationId || !clientId) continue
    // 先到先得：同章重复（历史脏数据）时保留最早那个，绑定才稳定。
    const key = materializationKey({ operationId, clientId })
    if (!index.has(key)) index.set(key, node.id)
  }
  return index
}

/** 某一次物化 operation 已经落过的 clientId → 节点 id。 */
export function materializedNodeIdsByClientId(
  nodes: readonly Pick<GenerationCanvasNode, 'id' | 'meta'>[],
  operationId: string,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const node of nodes) {
    const meta = node.meta as Record<string, unknown> | undefined
    if (!meta || trimmed(meta[MATERIALIZATION_OPERATION_META_KEY]) !== operationId) continue
    const clientId = trimmed(meta[MATERIALIZATION_CLIENT_META_KEY])
    if (clientId && !out.has(clientId)) out.set(clientId, node.id)
  }
  return out
}
