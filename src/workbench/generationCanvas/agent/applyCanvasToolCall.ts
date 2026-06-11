import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { getDefaultCategoryForNodeKind, getGenerationNodeDefaultTitle } from '../model/generationNodeKinds'
import { generationCanvasTools, type CreateGenerationNodeToolInput } from './generationCanvasTools'
import { listAvailableModelsForAgent, type AgentModelEntry } from './availableModels'
import { buildPlannedNodeMeta } from './plannedNodeMeta'

// 批量创建节点的布局由渲染层 derive，而不是信任 LLM 发来的像素坐标（prompt 里硬编码
// 单行坐标会让 6+ 节点横向溢出视口、适应视图后节点变得极小）。按节点数算近似正方网格，
// 列数 = ceil(sqrt(n))，行列定距铺开，保证任意数量都紧凑不溢出。
const GRID_ORIGIN_X = 160
const GRID_ORIGIN_Y = 160
const GRID_STEP_X = 360
const GRID_STEP_Y = 260
export function gridPosition(index: number, total: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, total))))
  return {
    x: GRID_ORIGIN_X + (index % cols) * GRID_STEP_X,
    y: GRID_ORIGIN_Y + Math.floor(index / cols) * GRID_STEP_Y,
  }
}

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
/**
 * clientId(LLM 在 create_canvas_nodes 里自取的临时号,如 "n1")→ 真实节点 id 注册表。
 * 映射除了回给 LLM,渲染层必须自己留一份:后续 connect/set_prompt/delete 里 LLM
 * 仍会用 clientId 指代节点——曾因为只回不存,clientId 原样进了 store,落盘出
 * "n1→n2" 吊边(指向不存在的节点,连线静默丢失,评测 sb-001 抓出)。
 */
const clientIdRegistry = new Map<string, string>()

function resolveNodeId(id: string): string {
  return clientIdRegistry.get(id) ?? id
}

export async function applyCanvasToolCall(toolName: string, args: unknown): Promise<unknown> {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}

  if (toolName === 'read_canvas_state') {
    return generationCanvasTools.read_canvas()
  }

  if (toolName === 'create_canvas_nodes') {
    const incoming = Array.isArray(record.nodes) ? record.nodes : []
    // 任一节点带 modelKey 才加载可用模型清单（校验+补全 agent 选的模型/参数，否则零 IPC）。
    const needsModels = incoming.some(
      (raw) => raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).modelKey === 'string',
    )
    const entryByKey = new Map<string, AgentModelEntry>(
      needsModels ? (await listAvailableModelsForAgent()).map((entry) => [entry.modelKey, entry]) : [],
    )
    const total = incoming.length
    const inputs: CreateGenerationNodeToolInput[] = incoming.map((raw, index) => {
      const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const kind = (typeof node.kind === 'string' ? node.kind : 'image') as GenerationNodeKind
      const positionRecord =
        node.position && typeof node.position === 'object' ? (node.position as Record<string, unknown>) : null
      const meta = buildPlannedNodeMeta(node, entryByKey)
      // 多节点批量：渲染层网格排布（忽略 LLM 像素坐标，避免单行溢出）。
      // 单节点：尊重 agent 指定位置（增量添加可能要贴近某节点），否则落网格首格。
      const position =
        total > 1
          ? gridPosition(index, total)
          : {
              x: typeof positionRecord?.x === 'number' ? positionRecord.x : gridPosition(index, total).x,
              y: typeof positionRecord?.y === 'number' ? positionRecord.y : gridPosition(index, total).y,
            }
      return {
        kind,
        // 按 kind 归类：镜头(image/video…)→分镜，角色→cast，场景→scene。让待生成卡拿到
        // 「镜头 N」编号、角色/场景不被误归分镜（schema 不收 LLM 的 categoryId，纯渲染层 derive）。
        categoryId: getDefaultCategoryForNodeKind(kind),
        title:
          typeof node.title === 'string' && node.title.trim()
            ? node.title.trim()
            : `${getGenerationNodeDefaultTitle(kind)} ${index + 1}`,
        prompt: typeof node.prompt === 'string' ? node.prompt : '',
        position,
        ...(meta ? { meta } : {}),
      }
    })
    const created = generationCanvasTools.create_nodes(inputs)
    const clientIdToNodeId: Record<string, string> = {}
    incoming.forEach((raw, index) => {
      const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const clientId = typeof node.clientId === 'string' ? node.clientId : ''
      if (clientId && created[index]) {
        clientIdToNodeId[clientId] = created[index].id
        clientIdRegistry.set(clientId, created[index].id)
      }
    })
    return { createdNodeIds: created.map((node) => node.id), clientIdToNodeId }
  }

  if (toolName === 'connect_canvas_edges') {
    const rawEdges = Array.isArray(record.edges) ? record.edges : []
    const edges = rawEdges
      .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
      .map((edge) => ({
        source: resolveNodeId(String(edge.sourceClientId || edge.source || '').trim()),
        target: resolveNodeId(String(edge.targetClientId || edge.target || '').trim()),
      }))
      .filter((edge) => edge.source && edge.target)
    const { connected, skipped } = generationCanvasTools.connect_nodes(edges)
    // 诚实回报:被跳过的吊边如实告诉 LLM(它可以纠正),不静默吞。
    return { connectedCount: connected, ...(skipped.length > 0 ? { skippedEdges: skipped } : {}) }
  }

  if (toolName === 'set_node_prompt') {
    const nodeId = resolveNodeId(String(record.nodeId || '').trim())
    const prompt = typeof record.prompt === 'string' ? record.prompt : ''
    const node = generationCanvasTools.update_node_prompt(nodeId, prompt)
    if (!node) throw new Error('node_not_found')
    return { nodeId: node.id }
  }

  if (toolName === 'delete_canvas_nodes') {
    const nodeIds = Array.isArray(record.nodeIds)
      ? record.nodeIds.map((id) => resolveNodeId(String(id || '').trim())).filter(Boolean)
      : []
    const deleted = generationCanvasTools.delete_nodes(nodeIds)
    return { deletedNodeIds: deleted }
  }

  throw new Error(`unknown tool ${toolName}`)
}
