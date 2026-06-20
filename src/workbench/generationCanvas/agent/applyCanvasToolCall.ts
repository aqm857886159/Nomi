import type { BuiltinCanvasCategoryId, GenerationCanvasEdgeMode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { CATEGORY_IDS } from '../model/generationCanvasTypes'
import { getDefaultCategoryForNodeKind, getGenerationNodeDefaultTitle } from '../model/generationNodeKinds'
import { generationCanvasTools, type CreateGenerationNodeToolInput } from './generationCanvasTools'
import { listAvailableModelsForAgent, type AgentModelEntry } from './availableModels'
import { buildPlannedNodeMeta } from './plannedNodeMeta'
import { withCanvasGestureContext, type CanvasGestureContext } from '../events/canvasGestureContext'
import { layoutPlannedNodes, layoutStoryboardNodes } from './trajectoryLayout'
import { formatCanvasForAgent } from './canvasPromptContext'
import { buildDependencyWaves } from '../runner/dependencyWaves'
import { runPlanWithToasts } from '../components/batchPlanPreview'
import { mintSpendGrant } from '../../api/taskApi'
import { arrangeStoryboardToTimeline } from './sendStoryboardToTimeline'
import { parseStoryboardPlan } from './storyboardPlan'
import { useWorkbenchStore } from '../../workbenchStore'

// 批量创建节点的布局由渲染层 derive，而不是信任 LLM 发来的像素坐标。
// 实现住在 trajectoryLayout（分层 + 避让 + 网格回退，步距由节点尺寸推导）。

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

/**
 * 切项目/换会话时清空 clientId 注册表(P1·治跨项目串台)。
 * 注册表是模块级全局、只增不减;不清的话,A 项目用过 clientId "n1" 后切到 B 项目,
 * 若 LLM 再用 "n1" 指代,resolveNodeId 会返回 A 项目的真实节点 id → 跨项目误连/误删,
 * reconcile 还会把脏解析当"已连接"误判 ok。由 swapGenerationAiProject(画布会话切换的单一入口)调用。
 */
export function resetClientIdRegistry(): void {
  clientIdRegistry.clear()
}

const EDGE_MODES: ReadonlySet<string> = new Set([
  'reference',
  'first_frame',
  'last_frame',
  'style_ref',
  'character_ref',
  'composition_ref',
])

/** LLM 给的边 mode 只认白名单内的值，非法值按通用参考处理（不抛、不静默改语义）。 */
function normalizeEdgeMode(raw: unknown): GenerationCanvasEdgeMode | undefined {
  return typeof raw === 'string' && EDGE_MODES.has(raw) ? (raw as GenerationCanvasEdgeMode) : undefined
}

/** create 携带边 / connect_canvas_edges 共用的边参数归一（clientId→真实 id + mode 白名单）。 */
function normalizePlannedEdges(rawEdges: unknown[]): Array<{ source: string; target: string; mode?: GenerationCanvasEdgeMode }> {
  return rawEdges
    .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
    .map((edge) => ({
      source: resolveNodeId(String(edge.sourceClientId || edge.source || '').trim()),
      target: resolveNodeId(String(edge.targetClientId || edge.target || '').trim()),
      ...(normalizeEdgeMode(edge.mode) ? { mode: normalizeEdgeMode(edge.mode) } : {}),
    }))
    .filter((edge) => edge.source && edge.target)
}

/** S6-4 锁求值要把 LLM 口中的 clientId 翻译成真实节点 id 再查锁面(gate 调用方用)。 */
export function resolveCanvasToolNodeId(id: string): string {
  return resolveNodeId(id)
}

export async function applyCanvasToolCall(toolName: string, args: unknown, gesture?: CanvasGestureContext): Promise<unknown> {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  // S6-2:提议事务把手势上下文传进来,store 变更段(纯同步)包在上下文里——途经 action
  // 发出的画布事件统一携带 source:'agent'+txnId/proposalId。只包同步段,await 间隙不持有
  // (异步持有会让并行的用户手势串台,见 canvasGestureContext 纪律)。
  const inCtx = <T,>(fn: () => T): T => (gesture ? withCanvasGestureContext(gesture, fn) : fn())

  if (toolName === 'read_canvas_state') {
    // T1 token 优化:回包用紧凑行格式(与 system prompt 的画布段同源),
    // 不再把全字段快照 JSON 回灌进对话历史(那是每请求 2-3k token 的洞)。
    const snapshot = generationCanvasTools.read_canvas()
    const selectedIds = new Set(snapshot.selectedNodeIds ?? [])
    const selected = snapshot.nodes.filter((node) => selectedIds.has(node.id))
    return formatCanvasForAgent(snapshot, selected)
  }

  if (toolName === 'propose_storyboard_plan') {
    // 规划免费可改:planner 第一手产出结构化方案对象,落创作 store 给用户审/改——不碰画布、零网络、零扣费。
    // 用户确认后才由 storyboardPlanToCreateNodesArgs 转成 create_canvas_nodes 落画布(S4)。
    // 校验失败 throw → 调用方映射成 tool error,回喂 LLM 自我修正(与 gate deny 同语义)。
    const plan = parseStoryboardPlan(record)
    const store = useWorkbenchStore.getState()
    store.setStoryboardPlan(plan)
    store.setStoryboardEditorOpen(true) // 拆完自动打开编辑器(沿用「立刻看到方案」);卡片同时进对话流。
    store.setWorkspaceMode('creation')
    return `已生成分镜方案「${plan.title || '未命名'}」：${plan.anchors.length} 个锚 · ${plan.shots.length} 个镜头，已放到创作区，待你审阅/修改后确认落画布。`
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
    // T4 轨迹分层布局：层由 kind 推导（参考/关键帧/视频三列），原点避让画布已有节点
    // 包围盒（修审计 bug D）；单层/不可推导退网格（同样避让）。忽略 LLM 像素坐标。
    const plannedKinds = incoming.map((raw) => {
      const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      return (typeof node.kind === 'string' ? node.kind : 'image') as GenerationNodeKind
    })
    // 分镜方案落画布（storyboardPlanToCreateNodesArgs 给 anchorCount）→ 参考行在上 + 镜头折行网格；
    // 其余（agent 直接建卡）→ 原轨迹分层布局。两者都从已有节点包围盒下方起、不压旧内容。
    const existingCanvasNodes = generationCanvasTools.read_canvas().nodes
    const storyboardAnchorCount = typeof record.anchorCount === 'number' ? record.anchorCount : null
    const layout =
      storyboardAnchorCount !== null
        ? layoutStoryboardNodes(plannedKinds, storyboardAnchorCount, existingCanvasNodes)
        : layoutPlannedNodes(plannedKinds, existingCanvasNodes)
    // 整批强制分类（分镜方案落画布用，用户拍板 A）：角色/场景/镜头落进同一分类，参考边
    // 同屏可见可连。仅程序化调用方（storyboardPlanToCreateNodesArgs）会设；agent 直接建卡
    // 不带 → 走 kind 默认。只认白名单分类，挡住脏值把节点丢进不存在的分类而消失。
    const groupCategoryId =
      typeof record.groupCategoryId === 'string' && (CATEGORY_IDS as readonly string[]).includes(record.groupCategoryId)
        ? (record.groupCategoryId as BuiltinCanvasCategoryId)
        : null
    const inputs: CreateGenerationNodeToolInput[] = incoming.map((raw, index) => {
      const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const kind = plannedKinds[index]
      const positionRecord =
        node.position && typeof node.position === 'object' ? (node.position as Record<string, unknown>) : null
      const meta = buildPlannedNodeMeta(node, entryByKey)
      // 单节点：尊重 agent 指定位置（增量添加可能要贴近某节点），否则同走避让布局。
      const position =
        total > 1
          ? layout[index]
          : {
              x: typeof positionRecord?.x === 'number' ? positionRecord.x : layout[index].x,
              y: typeof positionRecord?.y === 'number' ? positionRecord.y : layout[index].y,
            }
      return {
        kind,
        // groupCategoryId 在则整批落同一分类（分镜方案：角色/场景/镜头落在一起）；否则按 kind
        // 归类（镜头→分镜、角色→cast、场景→scene）。character/scene kind 不参与 shotIndex，
        // 故落进 shots 也不抢「镜头 N」编号（见 model/shotNumbering.ts）。
        categoryId: groupCategoryId ?? getDefaultCategoryForNodeKind(kind),
        title:
          typeof node.title === 'string' && node.title.trim()
            ? node.title.trim()
            : `${getGenerationNodeDefaultTitle(kind)} ${index + 1}`,
        prompt: typeof node.prompt === 'string' ? node.prompt : '',
        position,
        ...(meta ? { meta } : {}),
      }
    })
    const created = inCtx(() => generationCanvasTools.create_nodes(inputs))
    const clientIdToNodeId: Record<string, string> = {}
    incoming.forEach((raw, index) => {
      const node = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const clientId = typeof node.clientId === 'string' ? node.clientId : ''
      if (clientId && created[index]) {
        clientIdToNodeId[clientId] = created[index].id
        clientIdRegistry.set(clientId, created[index].id)
      }
    })
    // 节点和边是一个计划、一次批准、一次落地（不许把连边拆成第二次审批——用户拍板）。
    // 边在节点注册进 registry 之后解析，clientId / 真实 id 混用都能落对。
    const rawPlanEdges = Array.isArray(record.edges) ? record.edges : []
    let connectedCount = 0
    let skippedEdges: unknown[] = []
    if (rawPlanEdges.length) {
      const outcome = inCtx(() => generationCanvasTools.connect_nodes(normalizePlannedEdges(rawPlanEdges)))
      connectedCount = outcome.connected
      skippedEdges = outcome.skipped
    }
    return {
      createdNodeIds: created.map((node) => node.id),
      clientIdToNodeId,
      ...(rawPlanEdges.length ? { connectedCount } : {}),
      ...(skippedEdges.length > 0 ? { skippedEdges } : {}),
    }
  }

  if (toolName === 'connect_canvas_edges') {
    const rawEdges = Array.isArray(record.edges) ? record.edges : []
    const edges = normalizePlannedEdges(rawEdges)
    const { connected, skipped } = inCtx(() => generationCanvasTools.connect_nodes(edges))
    // 诚实回报:被跳过的吊边如实告诉 LLM(它可以纠正),不静默吞。
    return { connectedCount: connected, ...(skipped.length > 0 ? { skippedEdges: skipped } : {}) }
  }

  if (toolName === 'set_node_prompt') {
    const nodeId = resolveNodeId(String(record.nodeId || '').trim())
    const prompt = typeof record.prompt === 'string' ? record.prompt : ''
    const node = inCtx(() => generationCanvasTools.update_node_prompt(nodeId, prompt))
    if (!node) throw new Error('node_not_found')
    return { nodeId: node.id }
  }

  if (toolName === 'delete_canvas_nodes') {
    const nodeIds = Array.isArray(record.nodeIds)
      ? record.nodeIds.map((id) => resolveNodeId(String(id || '').trim())).filter(Boolean)
      : []
    const deleted = inCtx(() => generationCanvasTools.delete_nodes(nodeIds))
    return { deletedNodeIds: deleted }
  }

  if (toolName === 'run_generation_batch') {
    // S6b 受理语义:本分支只在用户批准后到达(确认前零网络调用)。受理 = 按依赖波次
    // 规划(显示的≡执行的,S2b 纯函数)并启动;立即返回受理回执——生成进度走 run 域
    // 事件给用户看,不阻塞 LLM 回合。approved nodeIds ≡ requested:只跑请求里解析
    // 出来的真实节点,一个不多。
    const requested = Array.isArray(record.nodeIds)
      ? record.nodeIds.map((id) => resolveNodeId(String(id || '').trim())).filter(Boolean)
      : []
    const existing = new Set(generationCanvasTools.read_canvas().nodes.map((node) => node.id))
    const nodeIds = requested.filter((id) => existing.has(id))
    if (!nodeIds.length) throw new Error('node_not_found:请求生成的节点都不存在')
    const state = generationCanvasTools.read_canvas()
    const plan = buildDependencyWaves(nodeIds, { nodes: state.nodes, edges: state.edges })
    const accepted = plan.waves.flat()
    if (!accepted.length) {
      const reasons = plan.blocked.map((item) => item.detail).join(';')
      throw new Error(`批量被拦:${reasons || '没有可执行节点'}`)
    }
    // 付费守卫：本分支只在用户批准 pending 卡后到达（人手势在上游）→ 铸令牌绑受理节点，
    // 随 plan 下到主进程 runTask 核验。删了 defaultExecuteToolCall 的自动放行旁路后此处不会被 AI 静默触发。
    void mintSpendGrant(accepted)
      .then((grantId) => runPlanWithToasts(plan, grantId))
      .catch(() => {}) // 进度/结果全走 toast+run 域事件,此处不再有未处理拒绝
    return {
      accepted: true,
      acceptedNodeIds: accepted,
      waves: plan.waves.length,
      blocked: plan.blocked.map((item) => ({ nodeId: item.nodeId, detail: item.detail })),
    }
  }

  if (toolName === 'arrange_storyboard_to_timeline') {
    // 排序/选片全在纯函数(planStoryboardTimeline)里——LLM 只触发,顺序按 shotIndex 镜序确定。
    // 不走 inCtx 手势上下文(那是画布事件域);时间轴变更是 workbenchStore 的事。
    const rawIds = Array.isArray(record.nodeIds)
      ? record.nodeIds.map((id) => resolveNodeId(String(id || '').trim())).filter(Boolean)
      : undefined
    const result = arrangeStoryboardToTimeline(rawIds && rawIds.length ? { nodeIds: rawIds } : {})
    if (!result.ok && result.total === 0) {
      throw new Error('没有可排片的镜头:画布上还没有生成好的视频或可占位的关键帧')
    }
    return {
      arranged: result.sent.length,
      total: result.total,
      // 回报每镜落点(role: video/placeholder/still),供 LLM 向用户复述"镜N用视频/用关键帧占位"。
      placed: result.sent.map((item) => ({ nodeId: item.nodeId, role: item.role, startFrame: item.startFrame })),
      ...(result.skipped.length ? { skipped: result.skipped } : {}),
    }
  }

  throw new Error(`unknown tool ${toolName}`)
}
