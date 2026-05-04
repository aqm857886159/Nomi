import { z } from 'zod'
import { generationNodeKindSchema } from '../model/generationCanvasSchema'
import type { GenerationCanvasEdge, GenerationNodeKind } from '../model/generationCanvasTypes'
import type { CreateGenerationNodeToolInput } from './generationCanvasTools'

const plannedNodeSchema = z.object({
  clientId: z.string().min(1).optional(),
  kind: generationNodeKindSchema,
  title: z.string().min(1).optional(),
  prompt: z.string().optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
})

const plannedEdgeSchema = z.object({
  sourceClientId: z.string().min(1),
  targetClientId: z.string().min(1),
})

const generationCanvasAgentPlanSchema = z.object({
  action: z.literal('create_generation_canvas_nodes'),
  summary: z.string().optional(),
  nodes: z.array(plannedNodeSchema).min(1).max(24),
  edges: z.array(plannedEdgeSchema).max(48).optional(),
})

export type GenerationCanvasAgentPlannedNode = {
  clientId?: string
  kind: GenerationNodeKind
  title?: string
  prompt?: string
  position?: { x: number; y: number }
}

export type GenerationCanvasAgentPlan = {
  action: 'create_generation_canvas_nodes'
  summary?: string
  nodes: GenerationCanvasAgentPlannedNode[]
  edges?: Array<{
    sourceClientId: string
    targetClientId: string
  }>
}

export type AppliedGenerationCanvasAgentPlan = {
  createdNodes: CreateGenerationNodeToolInput[]
  requestedEdges: Array<Pick<GenerationCanvasEdge, 'source' | 'target'>>
}

const PLAN_BLOCK_RE = /<generation_canvas_plan>([\s\S]*?)<\/generation_canvas_plan>/i

function readPlanPayload(text: string): string {
  const trimmed = text.trim()
  const tagged = trimmed.match(PLAN_BLOCK_RE)?.[1]?.trim()
  if (tagged) return tagged
  return trimmed
}

export function parseGenerationCanvasAgentPlan(text: string): GenerationCanvasAgentPlan {
  const payload = readPlanPayload(text)
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(payload)
  } catch (error) {
    throw new Error(`生成区 Agent 没有返回可解析的节点计划 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = generationCanvasAgentPlanSchema.safeParse(parsedJson)
  if (!parsed.success) {
    throw new Error(`生成区 Agent 节点计划结构无效：${parsed.error.issues.map((issue) => issue.message).join('；')}`)
  }
  return parsed.data
}

export function toCreateNodeInputs(plan: GenerationCanvasAgentPlan): CreateGenerationNodeToolInput[] {
  return plan.nodes.map((node, index) => ({
    kind: node.kind,
    title: node.title || (node.kind === 'video' ? `视频 ${index + 1}` : node.kind === 'image' ? `图片 ${index + 1}` : `节点 ${index + 1}`),
    prompt: node.prompt || '',
    position: node.position || { x: 160 + index * 340, y: 260 + (index % 2) * 220 },
  }))
}

export function buildPlannedEdges(
  plan: GenerationCanvasAgentPlan,
  createdNodeIds: readonly string[],
): Array<Pick<GenerationCanvasEdge, 'source' | 'target'>> {
  if (!plan.edges?.length) return []
  const idMap = new Map<string, string>()
  plan.nodes.forEach((node, index) => {
    if (node.clientId && createdNodeIds[index]) idMap.set(node.clientId, createdNodeIds[index])
  })
  return plan.edges.flatMap((edge) => {
    const source = idMap.get(edge.sourceClientId)
    const target = idMap.get(edge.targetClientId)
    if (!source || !target) return []
    return [{ source, target }]
  })
}
