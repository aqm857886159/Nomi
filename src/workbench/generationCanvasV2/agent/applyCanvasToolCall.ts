import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeDefaultTitle } from '../model/generationNodeKinds'
import { generationCanvasTools, type CreateGenerationNodeToolInput } from './generationCanvasTools'

/**
 * Single source of truth for turning an agent canvas tool call into a real
 * mutation against the renderer `generationCanvasTools` store. Returns the
 * structured result for the LLM; **throws** on failure / unknown tool (callers
 * map the throw to `{ ok: false, message }`).
 *
 * Used by BOTH the auto-execute path (`generationCanvasAgentClient`) and the
 * user-confirmed path (`CanvasAssistantPanel`) — there is no parallel
 * implementation anymore (P1). Tool execution does not depend on any panel
 * being mounted: the store + tools are global.
 */
export async function applyCanvasToolCall(toolName: string, args: unknown): Promise<unknown> {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}

  if (toolName === 'read_canvas_state') {
    return generationCanvasTools.read_canvas()
  }

  if (toolName === 'create_canvas_nodes') {
    const incoming = Array.isArray(record.nodes) ? record.nodes : []
    const inputs: CreateGenerationNodeToolInput[] = incoming.map((raw, index) => {
      const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const kind = (typeof node.kind === 'string' ? node.kind : 'image') as GenerationNodeKind
      const positionRecord =
        node.position && typeof node.position === 'object' ? (node.position as Record<string, unknown>) : null
      return {
        kind,
        title:
          typeof node.title === 'string' && node.title.trim()
            ? node.title.trim()
            : `${getGenerationNodeDefaultTitle(kind)} ${index + 1}`,
        prompt: typeof node.prompt === 'string' ? node.prompt : '',
        position: {
          x: typeof positionRecord?.x === 'number' ? positionRecord.x : 160 + index * 340,
          y: typeof positionRecord?.y === 'number' ? positionRecord.y : 260 + (index % 2) * 220,
        },
      }
    })
    const created = generationCanvasTools.create_nodes(inputs)
    const clientIdToNodeId: Record<string, string> = {}
    incoming.forEach((raw, index) => {
      const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const clientId = typeof node.clientId === 'string' ? node.clientId : ''
      if (clientId && created[index]) clientIdToNodeId[clientId] = created[index].id
    })
    return { createdNodeIds: created.map((node) => node.id), clientIdToNodeId }
  }

  if (toolName === 'connect_canvas_edges') {
    const rawEdges = Array.isArray(record.edges) ? record.edges : []
    const edges = rawEdges
      .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
      .map((edge) => ({
        source: String(edge.sourceClientId || edge.source || '').trim(),
        target: String(edge.targetClientId || edge.target || '').trim(),
      }))
      .filter((edge) => edge.source && edge.target)
    if (edges.length > 0) generationCanvasTools.connect_nodes(edges)
    return { connectedCount: edges.length }
  }

  if (toolName === 'set_node_prompt') {
    const nodeId = String(record.nodeId || '').trim()
    const prompt = typeof record.prompt === 'string' ? record.prompt : ''
    const node = generationCanvasTools.update_node_prompt(nodeId, prompt)
    if (!node) throw new Error('node_not_found')
    return { nodeId: node.id }
  }

  if (toolName === 'delete_canvas_nodes') {
    const nodeIds = Array.isArray(record.nodeIds)
      ? record.nodeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : []
    const deleted = generationCanvasTools.delete_nodes(nodeIds)
    return { deletedNodeIds: deleted }
  }

  throw new Error(`unknown tool ${toolName}`)
}
