import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { useWorkbenchStore } from '../../workbenchStore'
import { collectNodeContext } from '../model/nodeContext'
import { analyzeSemanticSceneFromSource } from '../nodes/semanticScene/semanticSceneAnalyzer'
import {
  createEmptySemanticScene,
  normalizeSemanticScene,
} from '../nodes/semanticScene/semanticSceneSerializer'
import { semanticSceneToScene3D } from '../nodes/semanticScene/semanticSceneToScene3D'
import type { SemanticScene, SemanticSceneClass } from '../nodes/semanticScene/semanticSceneTypes'
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

export type CreateSemanticSceneToolInput = {
  sourceNodeId?: string
  title?: string
  position?: { x: number; y: number }
  scaleHint?: string
  sceneClass?: SemanticSceneClass
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
  | { tool: 'create_semantic_scene'; input?: CreateSemanticSceneToolInput }
  | { tool: 'analyze_semantic_scene_from_source'; nodeId: string }
  | { tool: 'convert_semantic_scene_to_scene3d'; nodeId: string; title?: string; position?: { x: number; y: number } }

function toolResult<T>(input: GenerationCanvasToolResult<T>): GenerationCanvasToolResult<T> {
  return input
}

function findNode(nodeId: string): GenerationCanvasNode | null {
  const id = String(nodeId || '').trim()
  if (!id) return null
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === id) || null
}

function sourceImageUrlForNode(node: GenerationCanvasNode): string {
  if (node.kind === 'panorama') {
    return node.result?.url || (typeof node.meta?.imageUrl === 'string' ? node.meta.imageUrl : '')
  }
  if (node.result?.type === 'image') return node.result.url || ''
  return ''
}

function sourceTypeForNode(node: GenerationCanvasNode): SemanticScene['sourceType'] {
  if (node.kind === 'panorama') return 'panorama'
  return node.result?.type === 'image' ? 'image' : 'manual'
}

function semanticSceneForNode(node: GenerationCanvasNode): SemanticScene {
  const state = useGenerationCanvasStore.getState()
  const current = normalizeSemanticScene(node.meta?.semanticScene || createEmptySemanticScene())
  if (current.sourceImageUrls.length) return current
  const incoming = state.edges.find((edge) => edge.target === node.id)
  const sourceNode = incoming ? state.nodes.find((candidate) => candidate.id === incoming.source) : undefined
  const sourceUrl = sourceNode ? sourceImageUrlForNode(sourceNode) : ''
  if (!sourceNode || !sourceUrl) return current
  return normalizeSemanticScene({
    ...current,
    sourceType: sourceTypeForNode(sourceNode),
    sourceNodeId: sourceNode.id,
    sourceImageUrls: [sourceUrl],
    updatedAt: Date.now(),
  })
}

function readUpdatedNode(nodeId: string): GenerationCanvasNode | null {
  return useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId) || null
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
  create_semantic_scene(input: CreateSemanticSceneToolInput = {}): GenerationCanvasNode | null {
    const sourceNode = input.sourceNodeId ? findNode(input.sourceNodeId) : null
    if (input.sourceNodeId && !sourceNode) return null
    const sourceUrl = sourceNode ? sourceImageUrlForNode(sourceNode) : ''
    const semanticScene = createEmptySemanticScene({
      sourceType: sourceNode ? sourceTypeForNode(sourceNode) : 'manual',
      sceneClass: input.sceneClass,
      sourceNodeId: sourceNode?.id,
      sourceImageUrls: sourceUrl ? [sourceUrl] : [],
      scaleHint: input.scaleHint,
    })
    const position = input.position || (
      sourceNode
        ? {
          x: sourceNode.position.x + (sourceNode.size?.width || 340) + 90,
          y: sourceNode.position.y,
        }
        : undefined
    )
    const node = useGenerationCanvasStore.getState().addNode({
      kind: 'semanticScene',
      title: input.title || (sourceNode ? `${sourceNode.title} 语义场景` : '语义场景'),
      prompt: '从全景图或图片提取空间、边界、对象、光照与相机语义。',
      position,
    })
    useGenerationCanvasStore.getState().updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        semanticScene,
      },
    })
    if (sourceNode) useGenerationCanvasStore.getState().connectNodes(sourceNode.id, node.id, 'reference')
    return readUpdatedNode(node.id)
  },
  async analyze_semantic_scene_from_source(nodeId: string): Promise<GenerationCanvasNode | null> {
    const node = findNode(nodeId)
    if (!node || node.kind !== 'semanticScene') return null
    const scene = semanticSceneForNode(node)
    useGenerationCanvasStore.getState().updateNode(node.id, {
      status: 'running',
      error: undefined,
      meta: {
        ...(node.meta || {}),
        semanticScene: scene,
      },
    })
    try {
      const analyzed = await analyzeSemanticSceneFromSource({
        node,
        scene,
        draftJson: JSON.stringify(scene, null, 2),
      })
      useGenerationCanvasStore.getState().updateNode(node.id, {
        status: 'success',
        error: undefined,
        meta: {
          ...(readUpdatedNode(node.id)?.meta || node.meta || {}),
          semanticScene: analyzed.scene,
          semanticSceneAnalysis: {
            modelVendor: analyzed.model.vendor,
            modelKey: analyzed.model.modelKey,
            modelAlias: analyzed.model.modelAlias,
            modelLabel: analyzed.model.label,
            analyzedAt: Date.now(),
            raw: analyzed.raw,
          },
        },
      })
      return readUpdatedNode(node.id)
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '语义场景分析失败'
      useGenerationCanvasStore.getState().updateNode(node.id, { status: 'error', error: message })
      throw new Error(message)
    }
  },
  convert_semantic_scene_to_scene3d(nodeId: string, options: { title?: string; position?: { x: number; y: number } } = {}): GenerationCanvasNode | null {
    const node = findNode(nodeId)
    if (!node || node.kind !== 'semanticScene') return null
    const semanticScene = semanticSceneForNode(node)
    const scene3dState = semanticSceneToScene3D(semanticScene)
    const scene3dNode = useGenerationCanvasStore.getState().addNode({
      kind: 'scene3d',
      title: options.title || `${node.title || '语义场景'} 3D`,
      prompt: '由语义场景图转换生成，可继续进入 3D 编辑器调整。',
      position: options.position || {
        x: node.position.x + (node.size?.width || 380) + 90,
        y: node.position.y,
      },
    })
    useGenerationCanvasStore.getState().updateNode(scene3dNode.id, {
      status: 'success',
      meta: {
        ...(scene3dNode.meta || {}),
        source: 'semantic-scene',
        sourceNodeId: node.id,
        scene3dState,
      },
    })
    useGenerationCanvasStore.getState().connectNodes(node.id, scene3dNode.id, 'reference')
    return readUpdatedNode(scene3dNode.id)
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
    if (action.tool === 'create_semantic_scene') {
      const node = generationCanvasTools.create_semantic_scene(action.input)
      return toolResult({
        ok: Boolean(node),
        tool: action.tool,
        message: node ? '已创建语义场景节点' : '未找到源图节点',
        data: node,
        ...(node ? {} : { error: 'source_node_not_found' }),
      })
    }
    if (action.tool === 'analyze_semantic_scene_from_source') {
      try {
        const node = await generationCanvasTools.analyze_semantic_scene_from_source(action.nodeId)
        return toolResult({
          ok: Boolean(node),
          tool: action.tool,
          message: node ? '语义场景分析完成' : '未找到语义场景节点',
          data: node,
          ...(node ? {} : { error: 'node_not_found_or_kind_mismatch' }),
        })
      } catch (error: unknown) {
        const message = error instanceof Error && error.message ? error.message : '语义场景分析失败'
        return toolResult({ ok: false, tool: action.tool, message, error: message })
      }
    }
    if (action.tool === 'convert_semantic_scene_to_scene3d') {
      const node = generationCanvasTools.convert_semantic_scene_to_scene3d(action.nodeId, {
        title: action.title,
        position: action.position,
      })
      return toolResult({
        ok: Boolean(node),
        tool: action.tool,
        message: node ? '已转换为 3D 场景节点' : '未找到语义场景节点',
        data: node,
        ...(node ? {} : { error: 'node_not_found_or_kind_mismatch' }),
      })
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
      if (getGenerationNodeExecutionKind(node.kind) !== expectedKind) {
        return toolResult({ ok: false, tool: action.tool, message: `当前工具需要可执行的 ${expectedKind} 节点`, error: 'kind_mismatch', data: node })
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
