// 工具调用的人话摘要(时间线步骤标题 / committed 记录 stepLabels 共用单源)。
// 杀 toolName 原文与 raw JSON:面板里直接显示给用户看的只能是这套词表。
import { getDefaultCategoryForNodeKind, type GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeDefaultTitle, isGenerationNodeKind } from '../model/generationNodeKinds'
import { EDGE_MODE_LABEL } from '../model/graphOps'
import { BUILTIN_CATEGORIES } from '../../project/projectCategories'
import { CAMERA_MOVE_LABEL, CAMERA_SPEED_DURATION, type CameraMove, type CameraSpeed } from '../nodes/scene3d/cameraMoveVocab'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const CATEGORY_NAME = new Map(BUILTIN_CATEGORIES.map((category) => [category.id, category.name]))

/** id → 节点标题(把 n3/真实 id 这类机器串翻成「镜1」给用户看;查不到返回 null,调用方省略不灌 id)。 */
function nodeTitleById(id: string): string | null {
  const node = useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)
  const title = node?.title?.trim()
  return title ? title : null
}

/** 一串节点 id → 「镜1」「镜2」人话(最多列 3 个,多了「等 N 个」;全查不到返回空,由摘要的计数兜底)。 */
function joinNodeTitles(ids: string[]): string {
  const titles = ids.map(nodeTitleById).filter((t): t is string => Boolean(t))
  if (titles.length === 0) return ''
  const head = titles.slice(0, 3).map((t) => `「${t}」`).join('、')
  return titles.length > 3 ? `${head} 等 ${titles.length} 个` : head
}

function categoryLabelOf(categoryId: string): string {
  return CATEGORY_NAME.get(categoryId) ?? categoryId
}

function plannedNodeKind(raw: unknown): GenerationNodeKind {
  const kind = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).kind : undefined
  return isGenerationNodeKind(kind) ? kind : 'image'
}

export function summarizeToolCall(toolName: string, args: unknown): string {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (toolName === 'create_canvas_nodes') {
    const nodes = Array.isArray(record.nodes) ? record.nodes : []
    const summary = typeof record.summary === 'string' ? record.summary : ''
    return `创建 ${nodes.length} 个节点${summary ? `：${summary}` : ''}`
  }
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    return `连接 ${edges.length} 条引用线`
  }
  if (toolName === 'set_node_prompt') {
    const title = record.nodeId ? nodeTitleById(String(record.nodeId)) : null
    return title ? `改写「${title}」的提示词` : '改写节点提示词'
  }
  if (toolName === 'delete_canvas_nodes') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return `删除 ${ids.length} 个节点`
  }
  if (toolName === 'run_generation_batch') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return `批量生成 ${ids.length} 个节点（将产生生成费用）`
  }
  if (toolName === 'read_canvas_state') {
    return '读取画布当前状态'
  }
  if (toolName === 'arrange_storyboard_to_timeline') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return ids.length ? `把 ${ids.length} 个镜头按剧本时序排入时间轴` : '把整条故事板按剧本时序排入时间轴'
  }
  if (toolName === 'tidy_canvas') {
    const cat = typeof record.categoryId === 'string' && record.categoryId ? categoryLabelOf(record.categoryId) : '当前画布'
    return `整理${cat}（按镜序归位 · ⌘Z 可撤销）`
  }
  if (toolName === 'create_staging_reference') {
    const characters = Array.isArray(record.characters) ? record.characters : []
    const camera = record.camera && typeof record.camera === 'object' ? (record.camera as Record<string, unknown>) : {}
    const parts = [
      `${characters.length} 角色`,
      typeof record.layout === 'string' ? String(record.layout) : null,
      typeof camera.shot === 'string' ? String(camera.shot) : null,
    ].filter(Boolean)
    return `建站位参考图（${parts.join(' · ')}）`
  }
  if (toolName === 'create_camera_move') {
    const move = record.move as CameraMove
    const label = CAMERA_MOVE_LABEL[move] ?? String(record.move ?? '运镜')
    const speed = (typeof record.speed === 'string' ? record.speed : 'medium') as CameraSpeed
    const duration = CAMERA_SPEED_DURATION[speed] ?? CAMERA_SPEED_DURATION.medium
    const shot = typeof record.shot === 'string' ? record.shot : 'medium'
    return `建运镜参考（${label} · ${shot} · ≈${duration}s）`
  }
  return toolName
}

/**
 * 回执「查看步骤」的逐项明细行(审计 A16:此前与 summary 同句重复,明细形同虚设)。
 * - 创建节点 → 每节点一行「标题 → 落点分类」(落点回报,审计 A1)
 * - 连接边 → 按语义分组计数(id 串对用户无行动价值,不灌)
 * - 其余工具 → 沿用一行摘要
 */
export function buildStepDetailLabels(toolName: string, args: unknown): string[] {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (toolName === 'create_canvas_nodes') {
    const nodes = Array.isArray(record.nodes) ? record.nodes : []
    return nodes.map((raw, index) => {
      const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const kind = plannedNodeKind(raw)
      const title =
        typeof node.title === 'string' && node.title.trim()
          ? node.title.trim()
          : `${getGenerationNodeDefaultTitle(kind)} ${index + 1}`
      return `「${title}」→ ${categoryLabelOf(getDefaultCategoryForNodeKind(kind))}`
    })
  }
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    const byMode = new Map<string, number>()
    for (const raw of edges) {
      const mode = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).mode || 'reference') : 'reference'
      byMode.set(mode, (byMode.get(mode) ?? 0) + 1)
    }
    const parts = Array.from(byMode.entries()).map(([mode, count]) => {
      const label = (EDGE_MODE_LABEL as Record<string, string>)[mode] ?? mode
      return `${label} ${count}`
    })
    return [`连接 ${edges.length} 条引用线${parts.length ? `（${parts.join(' · ')}）` : ''}`]
  }
  return [summarizeToolCall(toolName, args)]
}

/** 落点回报(审计 A1):一笔提议创建的节点按分类分组计数,供回执跳转 chip 与 toast 用。 */
export function countCreatedNodesByCategory(
  steps: ReadonlyArray<{ toolName: string; effectiveArgs: unknown }>,
): Array<{ categoryId: string; label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const step of steps) {
    if (step.toolName !== 'create_canvas_nodes') continue
    const record = step.effectiveArgs && typeof step.effectiveArgs === 'object'
      ? (step.effectiveArgs as Record<string, unknown>)
      : {}
    const nodes = Array.isArray(record.nodes) ? record.nodes : []
    for (const raw of nodes) {
      const categoryId = getDefaultCategoryForNodeKind(plannedNodeKind(raw))
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries()).map(([categoryId, count]) => ({
    categoryId,
    label: categoryLabelOf(categoryId),
    count,
  }))
}

/** 单工具 pending 卡(非计划折叠)的副标题:把 args 翻成一行人话,不再直怼 raw id/JSON。 */
export function describeToolCallDetail(toolName: string, args: unknown): string {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (toolName === 'connect_canvas_edges') {
    // 把 sourceClientId → targetClientId 翻成「源标题 → 目标标题」;任一端查不到则跳过该对(不灌 id)。
    const edges = Array.isArray(record.edges) ? record.edges : []
    const lines = edges
      .map((edge) => {
        const e = edge && typeof edge === 'object' ? (edge as Record<string, unknown>) : {}
        const src = nodeTitleById(String(e.sourceClientId || e.source || ''))
        const tgt = nodeTitleById(String(e.targetClientId || e.target || ''))
        return src && tgt ? `「${src}」→「${tgt}」` : null
      })
      .filter((line): line is string => Boolean(line))
    return lines.join('，')
  }
  if (toolName === 'set_node_prompt') {
    const prompt = String(record.prompt || '')
    return prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt
  }
  if (toolName === 'delete_canvas_nodes' || toolName === 'run_generation_batch') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds.map((id) => String(id)) : []
    return joinNodeTitles(ids)
  }
  return ''
}
