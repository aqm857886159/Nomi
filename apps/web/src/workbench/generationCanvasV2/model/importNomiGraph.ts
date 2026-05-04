import type { GenerationCanvasEdge, GenerationCanvasNode } from './generationCanvasTypes'
import { createGenerationNode } from './graphOps'

type NomiItem = {
  id?: unknown
  item_type?: unknown
  title?: unknown
  position_x?: unknown
  position_y?: unknown
  width?: unknown
  height?: unknown
  content?: Record<string, unknown>
}

type NomiConnection = {
  id?: unknown
  source_item_id?: unknown
  target_item_id?: unknown
}

export function importNomiGraph(input: { items?: NomiItem[]; connections?: NomiConnection[] }) {
  const nodes: GenerationCanvasNode[] = (input.items || []).map((item, index) => {
    const rawKind = String(item.item_type || 'text')
    const kind = rawKind === 'video' ? 'video' : rawKind === 'image' ? 'image' : 'text'
    const content = item.content || {}
    return {
      ...createGenerationNode({
        id: String(item.id || `nomi-node-${index + 1}`),
        kind,
        title: String(item.title || ''),
        x: Number(item.position_x || 80 + index * 24),
        y: Number(item.position_y || 80 + index * 24),
        prompt: String(content.prompt || content.text || ''),
      }),
      size: {
        width: Number(item.width || 300),
        height: Number(item.height || 200),
      },
    }
  })

  const edges: GenerationCanvasEdge[] = (input.connections || [])
    .map((connection, index) => ({
      id: String(connection.id || `nomi-edge-${index + 1}`),
      source: String(connection.source_item_id || ''),
      target: String(connection.target_item_id || ''),
    }))
    .filter((edge) => edge.source && edge.target)

  return { nodes, edges }
}

