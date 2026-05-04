import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { useWorkbenchStore } from '../../workbenchStore'
import { collectNodeContext } from '../model/nodeContext'
import { runGenerationNode } from '../runner/generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  sendGenerationNodeToTimeline,
  type SendGenerationNodeToTimelineOptions,
} from './sendGenerationNodeToTimeline'

export type CreateGenerationNodeToolInput = {
  kind: GenerationNodeKind
  title?: string
  prompt?: string
  position?: { x: number; y: number }
}

export type GenerationCanvasToolResult<T = unknown> = {
  ok: boolean
  tool: string
  message: string
  data?: T
  error?: string
  requiresConfirmation?: boolean
  preview?: unknown
}

export type GenerationCanvasToolAction =
  | { tool: 'read_canvas' }
  | { tool: 'read_selected_nodes' }
  | { tool: 'read_node_context'; nodeId: string }
  | { tool: 'create_nodes'; nodes: CreateGenerationNodeToolInput[] }
  | { tool: 'connect_nodes'; edges: Array<Pick<GenerationCanvasEdge, 'source' | 'target'>> }
  | { tool: 'update_node_prompt'; nodeId: string; prompt: string }
  | { tool: 'set_node_references'; nodeId: string; references: string[] }
  | { tool: 'generate_image'; nodeId: string; confirmed?: boolean }
  | { tool: 'generate_video'; nodeId: string; confirmed?: boolean }
  | { tool: 'send_to_timeline'; nodeId: string; options?: SendGenerationNodeToTimelineOptions }

function toolResult<T>(input: GenerationCanvasToolResult<T>): GenerationCanvasToolResult<T> {
  return input
}

function findNode(nodeId: string): GenerationCanvasNode | null {
  const id = String(nodeId || '').trim()
  if (!id) return null
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === id) || null
}

export const generationCanvasTools = {
  read_canvas() {
    return useGenerationCanvasStore.getState().readSnapshot()
  },
  read_selected_nodes(): GenerationCanvasNode[] {
    const state = useGenerationCanvasStore.getState()
    const selected = new Set(state.selectedNodeIds)
    return state.nodes.filter((node) => selected.has(node.id))
  },
  create_nodes(nodes: CreateGenerationNodeToolInput[]): GenerationCanvasNode[] {
    return nodes.map((node) => useGenerationCanvasStore.getState().addNode(node))
  },
  connect_nodes(edges: Array<Pick<GenerationCanvasEdge, 'source' | 'target'>>) {
    edges.forEach((edge) => useGenerationCanvasStore.getState().connectNodes(edge.source, edge.target))
    return useGenerationCanvasStore.getState().edges
  },
  update_node_prompt(nodeId: string, prompt: string) {
    useGenerationCanvasStore.getState().updateNodePrompt(nodeId, prompt)
    return useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId) || null
  },
  read_node_context(nodeId: string) {
    const state = useGenerationCanvasStore.getState()
    return collectNodeContext(state.nodes, state.edges, nodeId)
  },
  set_node_references(nodeId: string, references: string[]) {
    const node = findNode(nodeId)
    if (!node) return null
    const normalizedReferences = Array.from(new Set(references.map((ref) => String(ref || '').trim()).filter(Boolean)))
    useGenerationCanvasStore.getState().updateNode(node.id, { references: normalizedReferences })
    return useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id) || null
  },
  send_to_timeline(nodeId: string, options?: SendGenerationNodeToTimelineOptions) {
    return sendGenerationNodeToTimeline({
      readGenerationNodes: () => useGenerationCanvasStore.getState().nodes,
      readTimeline: () => useWorkbenchStore.getState().timeline,
      addTimelineClipAtFrame: (clip, trackType, startFrame) => {
        useWorkbenchStore.getState().addTimelineClipAtFrame(clip, trackType, startFrame)
      },
      readTimelineAfterInsert: () => useWorkbenchStore.getState().timeline,
    }, nodeId, options)
  },
  async execute(action: GenerationCanvasToolAction): Promise<GenerationCanvasToolResult> {
    if (action.tool === 'read_canvas') {
      const snapshot = generationCanvasTools.read_canvas()
      return toolResult({ ok: true, tool: action.tool, message: `读取画布：${snapshot.nodes.length} 个节点`, data: snapshot })
    }
    if (action.tool === 'read_selected_nodes') {
      const nodes = generationCanvasTools.read_selected_nodes()
      return toolResult({ ok: true, tool: action.tool, message: `读取选中节点：${nodes.length} 个`, data: nodes })
    }
    if (action.tool === 'read_node_context') {
      const context = generationCanvasTools.read_node_context(action.nodeId)
      return toolResult({
        ok: Boolean(context.node),
        tool: action.tool,
        message: context.node ? `读取节点上下文：${context.upstream.length} 个上游节点` : '未找到节点',
        data: context,
        ...(context.node ? {} : { error: 'node_not_found' }),
      })
    }
    if (action.tool === 'create_nodes') {
      const nodes = generationCanvasTools.create_nodes(action.nodes)
      return toolResult({ ok: true, tool: action.tool, message: `创建节点：${nodes.length} 个`, data: nodes })
    }
    if (action.tool === 'connect_nodes') {
      const edges = generationCanvasTools.connect_nodes(action.edges)
      return toolResult({ ok: true, tool: action.tool, message: `连接节点：${action.edges.length} 条`, data: edges })
    }
    if (action.tool === 'update_node_prompt') {
      const node = generationCanvasTools.update_node_prompt(action.nodeId, action.prompt)
      return toolResult({
        ok: Boolean(node),
        tool: action.tool,
        message: node ? '已更新节点 prompt' : '未找到节点',
        data: node,
        ...(node ? {} : { error: 'node_not_found' }),
      })
    }
    if (action.tool === 'set_node_references') {
      const node = generationCanvasTools.set_node_references(action.nodeId, action.references)
      return toolResult({
        ok: Boolean(node),
        tool: action.tool,
        message: node ? `已设置 ${node.references?.length || 0} 个参考` : '未找到节点',
        data: node,
        ...(node ? {} : { error: 'node_not_found' }),
      })
    }
    if (action.tool === 'send_to_timeline') {
      const result = generationCanvasTools.send_to_timeline(action.nodeId, action.options)
      return toolResult({
        ok: result.ok,
        tool: action.tool,
        message: result.ok ? '已发送到时间轴' : '发送到时间轴失败',
        data: result,
        ...(result.ok ? {} : { error: result.error }),
      })
    }
    if (action.tool === 'generate_image' || action.tool === 'generate_video') {
      const node = findNode(action.nodeId)
      if (!node) return toolResult({ ok: false, tool: action.tool, message: '未找到节点', error: 'node_not_found' })
      const expectedKind = action.tool === 'generate_image' ? 'image' : 'video'
      if (node.kind !== expectedKind) {
        return toolResult({ ok: false, tool: action.tool, message: `当前工具需要 ${expectedKind} 节点`, error: 'kind_mismatch', data: node })
      }
      if (!action.confirmed) {
        return toolResult({
          ok: true,
          tool: action.tool,
          message: '需要确认后开始真实生成',
          requiresConfirmation: true,
          preview: {
            nodeId: node.id,
            title: node.title,
            kind: node.kind,
            prompt: node.prompt || '',
            references: node.references || [],
          },
        })
      }

      try {
        const result = await runGenerationNode(node.id)
        return toolResult({ ok: true, tool: action.tool, message: '生成完成', data: result })
      } catch (error: unknown) {
        const message = error instanceof Error && error.message ? error.message : '生成失败'
        return toolResult({ ok: false, tool: action.tool, message, error: message })
      }
    }
    return toolResult({ ok: false, tool: 'unknown', message: '未知工具', error: 'unknown_tool' })
  },
}
