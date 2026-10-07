/**
 * [INPUT]: 依赖 ../../../agent/applyCanvasToolCall 的 resolveCanvasToolNodeId、../model/directorPreviewState 的 readDirectorPreview、
 *          ../../../agent/generationCanvasTools 的快照类型、electron/shared/agentCapabilities/directorWrite 的操作名
 * [OUTPUT]: 对外提供 directorWriteCompensation（一步 director.write 的撤销补偿）
 * [POS]: 提议事务（proposalTxn.captureStepCompensation）里 3D-BOX 那一支：撤销 / 中途失败时把画布放回这一步之前。
 *        新建 → 删建出的导演节点；修订 → 导演节点 meta / prompt 原样放回；两者都把预演要挂的视频节点放回之前——
 *        预演是事后由常驻 Host 用同一笔提议的事务身份挂上去的，撤销连它一起退，不留半截挂接。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { isDirectorWriteOperation } from '../../../../../../electron/shared/agentCapabilities/directorWrite'
import { resolveCanvasToolNodeId } from '../../../agent/clientIdRegistry'
import type { GenerationCanvasSnapshot } from '../../../model/generationCanvasTypes'
import { readDirectorPreview } from '../model/directorPreviewState'

type Snapshot = Pick<GenerationCanvasSnapshot, 'nodes'>
type Op =
  | { kind: 'delete-nodes'; nodeIds: string[] }
  | { kind: 'restore-node-fields'; nodeId: string; meta: Record<string, unknown>; prompt: string }

function restoreFields(snapshot: Snapshot, nodeId: string | undefined): Op[] {
  if (!nodeId) return []
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return []
  return [{ kind: 'restore-node-fields', nodeId, meta: JSON.parse(JSON.stringify(node.meta ?? {})) as Record<string, unknown>, prompt: node.prompt ?? '' }]
}

export function directorWriteCompensation(toolName: string, args: Record<string, unknown>, before: Snapshot, after: Snapshot): Op[] {
  if (!isDirectorWriteOperation(toolName)) return []
  if (toolName === 'create_director_plan') {
    const existing = new Set(before.nodes.map((node) => node.id))
    const created = after.nodes.filter((node) => !existing.has(node.id)).map((node) => node.id)
    const target = typeof args.shotNodeId === 'string' ? resolveCanvasToolNodeId(args.shotNodeId) : undefined
    return [...restoreFields(before, target), ...(created.length ? [{ kind: 'delete-nodes' as const, nodeIds: created }] : [])]
  }
  const directorNodeId = typeof args.directorNodeId === 'string' ? resolveCanvasToolNodeId(args.directorNodeId) : undefined
  const changed = (snapshot: Snapshot) => JSON.stringify(snapshot.nodes.find((node) => node.id === directorNodeId)?.meta ?? null)
  // 补丁没改变计划（unchanged）= 这一步一个字没写，不留补偿。
  if (!directorNodeId || changed(before) === changed(after)) return []
  const target = readDirectorPreview(before.nodes.find((node) => node.id === directorNodeId))?.targetNodeId
  return [...restoreFields(before, target), ...restoreFields(before, directorNodeId)]
}
