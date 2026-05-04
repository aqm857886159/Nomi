import { getServerFlow } from '../../api/server'
import { CanvasService } from '../../ai/canvasService'
import { useRFStore } from '../../canvas/store'
import { useUIStore } from '../uiStore'
import {
  isWorkspaceImageNode,
  readNodeDataRecord,
  readTrimmedRecordString,
} from './workspaceAssets'

export type ReloadCanvasFlowResult = {
  reloaded: boolean
  newNodeIds: string[]
}

export async function reloadCanvasFlowFromServer(input: {
  flowId: string
  expectedProjectId?: string
  expectedFlowId?: string
}): Promise<ReloadCanvasFlowResult> {
  const flowId = String(input.flowId || '').trim()
  if (!flowId) return { reloaded: false, newNodeIds: [] }

  const uiState = useUIStore.getState()
  const liveProjectId = String(uiState.currentProject?.id || '').trim()
  const liveFlowId = String(uiState.currentFlow?.id || '').trim()
  const expectedProjectId = String(input.expectedProjectId || '').trim()
  const expectedFlowId = String(input.expectedFlowId || '').trim()

  if (expectedProjectId && liveProjectId && liveProjectId !== expectedProjectId) {
    return { reloaded: false, newNodeIds: [] }
  }
  if (expectedFlowId && liveFlowId && liveFlowId !== expectedFlowId) {
    return { reloaded: false, newNodeIds: [] }
  }

  const localNodeIds = new Set(
    useRFStore.getState().nodes
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  )
  const flow = await getServerFlow(flowId)
  const flowData = flow?.data || { nodes: [], edges: [] }
  const nextNodes = Array.isArray(flowData.nodes) ? flowData.nodes : []
  const newNodeIds = nextNodes
    .map((node) => String(node?.id || '').trim())
    .filter((nodeId) => Boolean(nodeId) && !localNodeIds.has(nodeId))
  useRFStore.getState().load({
    nodes: nextNodes,
    edges: Array.isArray(flowData.edges) ? flowData.edges : [],
  })
  useUIStore.getState().setRestoreViewport(
    flowData.viewport && typeof flowData.viewport.zoom === 'number' ? flowData.viewport : null,
  )
  useUIStore.getState().setCurrentFlow({ id: flow.id, name: flow.name, source: 'server' })
  useUIStore.getState().setDirty(false)
  return { reloaded: true, newNodeIds }
}

export async function syncWorkspaceVideoReferenceEdges(input: {
  projectId: string
  targetNodeId: string
  sourceNodeIds: readonly string[]
}): Promise<void> {
  const targetNodeId = String(input.targetNodeId || '').trim()
  if (!targetNodeId) return

  const desiredSourceNodeIds = Array.from(
    new Set(input.sourceNodeIds.map((nodeId) => String(nodeId || '').trim()).filter(Boolean)),
  )

  const initialState = useRFStore.getState()
  const nodeById = new Map(
    initialState.nodes
      .map((node) => [String(node.id || '').trim(), node] as const)
      .filter(([nodeId]) => Boolean(nodeId)),
  )
  const staleEdgeIds = initialState.edges
    .filter((edge) => String(edge.target || '').trim() === targetNodeId)
    .filter((edge) => {
      const sourceNode = nodeById.get(String(edge.source || '').trim())
      if (!sourceNode) return false
      const record = readNodeDataRecord(sourceNode)
      if (!isWorkspaceImageNode(record)) return false
      const sourceProjectId = readTrimmedRecordString(record, 'sourceProjectId')
      if (sourceProjectId !== input.projectId) return false
      return !desiredSourceNodeIds.includes(sourceNode.id)
    })
    .map((edge) => String(edge.id || '').trim())
    .filter(Boolean)

  for (const edgeId of staleEdgeIds) {
    const result = await CanvasService.disconnectNodes({ edgeId })
    if (!result.success) {
      throw new Error(result.error || `断开参考边失败：${edgeId}`)
    }
  }

  const edgeKeySet = new Set(
    useRFStore.getState().edges
      .filter((edge) => String(edge.target || '').trim() === targetNodeId)
      .map((edge) => `${String(edge.source || '').trim()}=>${String(edge.target || '').trim()}`),
  )

  for (const sourceNodeId of desiredSourceNodeIds) {
    const edgeKey = `${sourceNodeId}=>${targetNodeId}`
    if (edgeKeySet.has(edgeKey)) continue
    const result = await CanvasService.connectNodes({
      sourceNodeId,
      targetNodeId,
      sourceHandle: 'out-image',
      targetHandle: 'in-any',
    })
    if (!result.success) {
      throw new Error(result.error || `连接参考边失败：${sourceNodeId} -> ${targetNodeId}`)
    }
    edgeKeySet.add(edgeKey)
  }
}
