// 工具调用的人话摘要(时间线步骤标题 / committed 记录 stepLabels 共用单源)。
// 杀 toolName 原文与 raw JSON:面板里直接显示给用户看的只能是这套词表。
// 这套词表是**用户可见文案**,一律走 i18n(R15):词汇(连接语义/运镜/内置分类)复用既有键,不另起第二份。
import i18n from '../../../i18n'
import { getDefaultCategoryForNodeKind, type GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeDefaultTitle, isGenerationNodeKind } from '../model/generationNodeKinds'
import { BUILTIN_CATEGORY_IDS } from '../../project/projectCategories'
import { CAMERA_SPEED_DURATION, type CameraMove, type CameraSpeed } from '../nodes/scene3d/cameraMoveVocab'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const T = 'generationCommon.assistant.toolCall'
const tt = (key: string, values?: Record<string, unknown>): string =>
  i18n.t(`${T}.${key}` as 'generationCommon.assistant.toolCall.createNodes', values ?? {})

/** 「标题」引号随语种走(中文直角引号 / 英文弯引号),不在代码里硬拼标点。 */
const quoted = (text: string): string => tt('quotedTitle', { text })

const BUILTIN_IDS = new Set<string>(BUILTIN_CATEGORY_IDS)

/** 分类名:内置分类走侧栏那份既有译名(单源),自定义分类用用户自己起的名(查不到回落 id)。 */
function categoryLabelOf(categoryId: string): string {
  if (!BUILTIN_IDS.has(categoryId)) return categoryId
  return i18n.t(
    `libraries.sidebar.builtinCategory.${categoryId}` as 'libraries.sidebar.builtinCategory.shots',
  )
}

/** 连接语义标签:复用连线菜单那份既有译名(单源),未知 mode 原样回落。 */
function edgeModeLabelOf(mode: string): string {
  const key = `generationCommon.canvas.edge.modes.${mode}` as 'generationCommon.canvas.edge.modes.reference'
  return i18n.exists(key) ? i18n.t(key) : mode
}

/** 运镜标签:复用运镜控件那份既有译名(单源)。 */
function cameraMoveLabelOf(move: string): string {
  const key = `generationCommon.cameraMove.move.${move}` as 'generationCommon.cameraMove.move.push_in'
  return i18n.exists(key) ? i18n.t(key) : tt('cameraMoveFallback')
}

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
  const head = titles.slice(0, 3).map(quoted).join(tt('listSeparator'))
  return titles.length > 3 ? tt('andMore', { head, n: titles.length }) : head
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
    return summary
      ? tt('createNodesWithSummary', { count: nodes.length, summary })
      : tt('createNodes', { count: nodes.length })
  }
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    return tt('connectEdges', { count: edges.length })
  }
  if (toolName === 'set_node_prompt') {
    const title = record.nodeId ? nodeTitleById(String(record.nodeId)) : null
    return title ? tt('setNodePrompt', { title }) : tt('setNodePromptGeneric')
  }
  if (toolName === 'delete_canvas_nodes') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return tt('deleteNodes', { count: ids.length })
  }
  if (toolName === 'run_generation_batch') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return tt('runGenerationBatch', { count: ids.length })
  }
  if (toolName === 'read_canvas_state') {
    return tt('readCanvasState')
  }
  if (toolName === 'arrange_storyboard_to_timeline') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return ids.length ? tt('arrangeTimeline', { count: ids.length }) : tt('arrangeTimelineAll')
  }
  if (toolName === 'tidy_canvas') {
    const target =
      typeof record.categoryId === 'string' && record.categoryId
        ? categoryLabelOf(record.categoryId)
        : tt('tidyCanvasCurrent')
    return tt('tidyCanvas', { target })
  }
  if (toolName === 'create_staging_reference') {
    const characters = Array.isArray(record.characters) ? record.characters : []
    const camera = record.camera && typeof record.camera === 'object' ? (record.camera as Record<string, unknown>) : {}
    const parts = [
      tt('stagingCharacters', { count: characters.length }),
      typeof record.layout === 'string' ? String(record.layout) : null,
      typeof camera.shot === 'string' ? String(camera.shot) : null,
    ].filter(Boolean)
    return tt('stagingReference', { parts: parts.join(' · ') })
  }
  if (toolName === 'create_camera_move') {
    const move = record.move as CameraMove
    const label = cameraMoveLabelOf(String(move ?? ''))
    const speed = (typeof record.speed === 'string' ? record.speed : 'medium') as CameraSpeed
    const duration = CAMERA_SPEED_DURATION[speed] ?? CAMERA_SPEED_DURATION.medium
    const shot = typeof record.shot === 'string' ? record.shot : 'medium'
    return tt('cameraMove', { label, shot, duration })
  }
  if (toolName === 'export_timeline') {
    const resolution = record.resolution === '720p' || record.resolution === '1080p'
      ? record.resolution
      : '1080p'
    const quality = record.quality === 'small'
      ? tt('exportQualitySmall')
      : record.quality === 'high'
        ? tt('exportQualityHigh')
        : tt('exportQualityStandard')
    const outputName = typeof record.outputName === 'string' ? record.outputName.trim() : ''
    return tt('exportTimeline', { resolution, quality, suffix: outputName ? tt('exportOutputName', { name: outputName }) : '' })
  }
  if (toolName === 'inspect_export_job') return tt('inspectExportJob')
  if (toolName === 'verify_render') return tt('verifyRender')
  if (toolName === 'cancel_export_job') return tt('cancelExportJob')
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
          : tt('defaultNodeTitle', { kind: getGenerationNodeDefaultTitle(kind), index: index + 1 })
      return tt('nodeToCategory', {
        title,
        category: categoryLabelOf(getDefaultCategoryForNodeKind(kind)),
      })
    })
  }
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    const byMode = new Map<string, number>()
    for (const raw of edges) {
      const mode = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).mode || 'reference') : 'reference'
      byMode.set(mode, (byMode.get(mode) ?? 0) + 1)
    }
    const parts = Array.from(byMode.entries()).map(([mode, count]) =>
      tt('edgeModeCount', { label: edgeModeLabelOf(mode), n: count }),
    )
    return [
      parts.length
        ? tt('connectEdgesWithModes', { count: edges.length, parts: parts.join(' · ') })
        : tt('connectEdges', { count: edges.length }),
    ]
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
        return src && tgt ? tt('edgePair', { source: src, target: tgt }) : null
      })
      .filter((line): line is string => Boolean(line))
    return lines.join(tt('lineSeparator'))
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
