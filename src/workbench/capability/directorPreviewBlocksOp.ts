import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { directorPreviewBlocksForOperation, directorPreviewSpendBlock, type DirectorPreviewOperationBlock } from '../generationCanvas/nodes/director/model/directorPreviewState'

/**
 * 3D-BOX 花钱闸：Agent 的 generate 出卡前问「这次的镜头里哪些被预演挡着」。
 * 判据只住 directorPreviewState；这里只把线上的入参收成干净形状。
 * candidateReferences / candidateDurations 是主进程同一次只读出的「每一镜候选带了哪些素材、要生成多长」。
 * 画布单节点 ↑ 的主进程准入（appIntegrationCanvasShot）问的是 nodeIds：同一个判据，按节点问。
 */
export function directorPreviewBlocksOp(data: Record<string, unknown>): { blocks: DirectorPreviewOperationBlock[] } {
  const nodeIds = Array.isArray(data.nodeIds) ? data.nodeIds.filter((value): value is string => typeof value === 'string') : undefined
  if (nodeIds) {
    const nodes = useGenerationCanvasStore.getState().nodes
    return { blocks: nodeIds.flatMap((nodeId) => { const block = directorPreviewSpendBlock(nodeId, nodes); return block ? [{ nodeId, reason: block.reason, ...(block.failure ? { failure: block.failure } : {}) }] : [] }) }
  }
  const operationId = typeof data.operationId === 'string' ? data.operationId : ''
  const shotIds = Array.isArray(data.shotIds) ? data.shotIds.filter((value): value is string => typeof value === 'string') : undefined
  const raw = data.candidateReferences && typeof data.candidateReferences === 'object' && !Array.isArray(data.candidateReferences) ? data.candidateReferences as Record<string, unknown> : undefined
  const candidateReferences = raw ? Object.fromEntries(Object.entries(raw).map(([shotId, ids]) => [shotId, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []])) : undefined
  const rawDurations = data.candidateDurations && typeof data.candidateDurations === 'object' && !Array.isArray(data.candidateDurations) ? data.candidateDurations as Record<string, unknown> : {}
  const candidateDurations = Object.fromEntries(Object.entries(rawDurations).flatMap(([shotId, seconds]) => (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? [[shotId, seconds]] : [])))
  return { blocks: operationId ? directorPreviewBlocksForOperation(useGenerationCanvasStore.getState().nodes, operationId, shotIds, candidateReferences, candidateDurations) : [] }
}
