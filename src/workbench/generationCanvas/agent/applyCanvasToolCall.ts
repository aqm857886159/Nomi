import type {
  BuiltinCanvasCategoryId,
  GenerationCanvasEdgeMode,
  GenerationNodeKind,
} from '../model/generationCanvasTypes'
import { CATEGORY_IDS } from '../model/generationCanvasTypes'
import { getDefaultCategoryForNodeKind, getGenerationNodeDefaultTitle } from '../model/generationNodeKinds'
import { ANCHOR_META_KEYS } from '../model/anchorBibleKeys'
import {
  generationCanvasTools,
  readGenerationCanvasSnapshot,
  type CreateGenerationNodeToolInput,
} from './generationCanvasTools'
import { listAvailableModelsForAgent, type AgentModelEntry } from './availableModels'
import { buildPlannedNodeMeta } from './plannedNodeMeta'
import { withCanvasGestureContext, type CanvasGestureContext } from '../events/canvasGestureContext'
import { layoutPlannedNodes, layoutStoryboardNodes } from './trajectoryLayout'
import { FOCUS_GENERATION_NODE_EVENT } from '../nodes/nodeSizing'
import { arrangeStoryboardToTimeline } from './sendStoryboardToTimeline'
import { parseStoryboardPlan } from './storyboardPlan'
import type { StagingSpec, StagingCharacterSpec } from '../nodes/scene3d/stagingBuilder'
import type { CameraMoveSpec } from '../nodes/scene3d/cameraMoveBuilder'
import type { ScenePropPlacement } from '../nodes/scene3d/scene3dPropSpecs'
import type { Scene3DSceneTemplate } from '../nodes/scene3d/scene3dSceneTemplates'
import type { CameraSpeed } from '../nodes/scene3d/cameraMoveVocab'
import { useWorkbenchStore } from '../../workbenchStore'
import { assertTurnCanWrite } from '../../ai/agentTurnLifecycle'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { registerCanvasToolClientId, resolveCanvasToolNodeId } from './clientIdRegistry'
export { resetClientIdRegistry, resolveCanvasToolNodeId } from './clientIdRegistry'

// 批量创建节点的布局由渲染层 derive，而不是信任 LLM 发来的像素坐标。
// 实现住在 trajectoryLayout（分层 + 避让 + 网格回退，步距由节点尺寸推导）。

/**
 * Single source of truth for turning an agent canvas tool call into a real
 * mutation against the renderer `generationCanvasTools` store. Returns the
 * structured result for the LLM; **throws** on failure / unknown tool (callers
 * map the throw to `{ ok: false, message }`).
 *
 * Used by BOTH the auto-execute path (`generationCanvasAgentClient`) and the
 * user-confirmed path (resident Agent approval) — there is no parallel
 * implementation anymore (P1). Tool execution does not depend on any panel
 * being mounted: the store + tools are global.
 */
/**
 * clientId(LLM 在 create_canvas_nodes 里自取的临时号,如 "n1")→ 真实节点 id 注册表。
 * 映射除了回给 LLM,渲染层必须自己留一份:后续 connect/set_prompt/delete 里 LLM
 * 仍会用 clientId 指代节点——曾因为只回不存,clientId 原样进了 store,落盘出
 * "n1→n2" 吊边(指向不存在的节点,连线静默丢失,评测 sb-001 抓出)。
 */
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
function normalizePlannedEdges(
  rawEdges: unknown[],
): Array<{ source: string; target: string; mode?: GenerationCanvasEdgeMode; order?: number }> {
  return rawEdges
    .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
    .map((edge) => ({
      source: resolveNodeId(String(edge.sourceClientId || edge.source || '').trim()),
      target: resolveNodeId(String(edge.targetClientId || edge.target || '').trim()),
      ...(normalizeEdgeMode(edge.mode) ? { mode: normalizeEdgeMode(edge.mode) } : {}),
      ...(typeof edge.order === 'number' && Number.isFinite(edge.order) ? { order: edge.order } : {}),
    }))
    .filter((edge) => edge.source && edge.target)
}

/** S6-4 锁求值要把 LLM 口中的 clientId 翻译成真实节点 id 再查锁面(gate 调用方用)。 */
function resolveNodeId(id: string): string {
  return resolveCanvasToolNodeId(id)
}

/**
 * 词表外逃生口的共同降级动作：把一条自由文本「电影术语指令」追加进目标节点 prompt。
 * 不渲染 3D 参考——意图→3D 几何无解，故老实把它写进模型的文字通道由模型解释。
 * 用 meta 标志(metaFlagKey)幂等去重：同一节点重复降级不重复追加同一指令。
 * 返回 { applied, alreadyApplied, found } 供执行器写诚实回执。
 */
function appendDirectiveToNodePrompt(
  nodeId: string,
  label: string,
  directive: string,
  metaFlagKey: string,
  inCtx: <T>(fn: () => T) => T,
): { found: boolean; applied: boolean; alreadyApplied: boolean } {
  const existing = readGenerationCanvasSnapshot().nodes.find((node) => node.id === nodeId)
  if (!existing) return { found: false, applied: false, alreadyApplied: false }
  const meta = (existing.meta ?? {}) as Record<string, unknown>
  if (meta[metaFlagKey] === directive) {
    return { found: true, applied: false, alreadyApplied: true } // 同指令已写过 → 幂等不重复追加
  }
  const base = typeof existing.prompt === 'string' ? existing.prompt : ''
  const line = `${label}：${directive}`
  const nextPrompt = base.trim() ? `${base}\n${line}` : line
  inCtx(() => {
    generationCanvasTools.update_node_prompt(nodeId, nextPrompt)
    useGenerationCanvasStore.getState().updateNode(nodeId, { meta: { ...meta, [metaFlagKey]: directive } })
  })
  return { found: true, applied: true, alreadyApplied: false }
}

const strValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** 灰模布景字段（sceneTemplate + props）容错提取——站位/运镜两工具共用（P4）。 */
function parseSceneBackdrop(record: Record<string, unknown>): {
  sceneTemplate?: Scene3DSceneTemplate
  props?: ScenePropPlacement[]
} {
  const rawProps = Array.isArray(record.props) ? record.props : []
  const props: ScenePropPlacement[] = rawProps
    .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
    .flatMap((p) => {
      const kind = strValue(p.kind)
      if (!kind) return []
      const pos =
        Array.isArray(p.position) &&
        p.position.length >= 2 &&
        typeof p.position[0] === 'number' &&
        typeof p.position[1] === 'number'
          ? ([p.position[0], p.position[1]] as [number, number])
          : undefined
      return [
        {
          kind: kind as ScenePropPlacement['kind'],
          position: pos,
          rotationY: typeof p.rotationY === 'number' ? p.rotationY : undefined,
          scale: typeof p.scale === 'number' ? p.scale : undefined,
        },
      ]
    })
  return {
    sceneTemplate: strValue(record.sceneTemplate) as Scene3DSceneTemplate | undefined,
    props: props.length > 0 ? props : undefined,
  }
}

/** create_staging_reference 的参数 → StagingSpec（容错提取；非法枚举值由 builder 兜默认）。导出供单测。 */
export function parseStagingSpec(record: Record<string, unknown>): StagingSpec {
  const str = strValue
  const rawChars = Array.isArray(record.characters) ? record.characters : []
  const characters: StagingCharacterSpec[] = rawChars
    .map((raw) => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}))
    .map((c) => ({
      name: str(c.name),
      pose: str(c.pose),
      facing: str(c.facing) as StagingCharacterSpec['facing'],
    }))
  if (characters.length === 0) characters.push({})
  const cameraRaw =
    record.camera && typeof record.camera === 'object' ? (record.camera as Record<string, unknown>) : null
  const crowdRaw = record.crowd && typeof record.crowd === 'object' ? (record.crowd as Record<string, unknown>) : null
  const backdrop = parseSceneBackdrop(record)
  return {
    characters,
    layout: str(record.layout) as StagingSpec['layout'],
    camera: cameraRaw
      ? {
          angle: str(cameraRaw.angle) as NonNullable<StagingSpec['camera']>['angle'],
          height: str(cameraRaw.height) as NonNullable<StagingSpec['camera']>['height'],
          shot: str(cameraRaw.shot) as NonNullable<StagingSpec['camera']>['shot'],
        }
      : undefined,
    environment: str(record.environment) as StagingSpec['environment'],
    crowd:
      crowdRaw && typeof crowdRaw.rows === 'number' && typeof crowdRaw.columns === 'number'
        ? { rows: crowdRaw.rows, columns: crowdRaw.columns }
        : undefined,
    sceneTemplate: backdrop.sceneTemplate,
    props: backdrop.props,
  }
}

/** create_camera_move 的参数 → 容错提取（词表外逃生口：move 现为可选，新增 customMove）。
 *  move 在则走精确 3D 渲染路；只有 customMove 则降级成视频 prompt 指令（不渲）。
 *  导出供单测；进程隔离故不复用后端 Zod（与 parseStagingSpec 同例）。 */
export function parseCameraMoveSpec(record: Record<string, unknown>): {
  move?: CameraMoveSpec['move']
  speed?: CameraMoveSpec['speed']
  shot?: CameraMoveSpec['shot']
  subjectPose?: string
  customMove?: string
  sceneTemplate?: Scene3DSceneTemplate
  props?: ScenePropPlacement[]
} {
  const str = strValue
  const backdrop = parseSceneBackdrop(record)
  const customMove = str(record.customMove)
  return {
    // customMove is the explicit escape hatch for an out-of-vocab intent. Some models retain
    // a stale enum from the previous turn; never let that stale value override the new intent.
    move: customMove ? undefined : (str(record.move) as CameraMoveSpec['move'] | undefined),
    speed: str(record.speed) as CameraMoveSpec['speed'],
    shot: str(record.shot) as CameraMoveSpec['shot'],
    subjectPose: str(record.subjectPose),
    customMove,
    sceneTemplate: backdrop.sceneTemplate,
    props: backdrop.props,
  }
}

export async function applyCanvasToolCall(
  toolName: string,
  args: unknown,
  gesture?: CanvasGestureContext,
  canWrite?: () => boolean,
  documentId?: string,
  storyboardId?: string,
): Promise<unknown> {
  const assertWritable = () => {
    if (canWrite) assertTurnCanWrite(canWrite)
  }
  assertWritable()
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  // S6-2:提议事务把手势上下文传进来,store 变更段(纯同步)包在上下文里——途经 action
  // 发出的画布事件统一携带 source:'agent'+txnId/proposalId。只包同步段,await 间隙不持有
  // (异步持有会让并行的用户手势串台,见 canvasGestureContext 纪律)。
  const inCtx = <T>(fn: () => T): T => {
    assertWritable()
    return gesture ? withCanvasGestureContext(gesture, fn) : fn()
  }

  if (toolName === 'propose_storyboard_plan') {
    // 规划免费可改:planner 第一手产出结构化方案对象,落创作 store 给用户审/改——不碰画布、零网络、零扣费。
    // 用户确认后才由 storyboardPlanToCreateNodesArgs 转成 create_canvas_nodes 落画布(S4)。
    // 校验失败 throw → 调用方映射成 tool error,回喂 LLM 自我修正(与 gate deny 同语义)。
    const plan = parseStoryboardPlan(record)
    const store = useWorkbenchStore.getState()
    // P4:按 documentId 存方案。documentId 由调用方在发起拆镜头时捕获，异步期间切文档不串稿。
    // 缺 documentId（如旧调用方）回退 activeDocumentId，保证至少落到当前激活文档。
    const targetDocumentId = documentId ?? store.activeDocumentId
    if (!store.workbenchDocuments.some((document) => document.id === targetDocumentId)) {
      return {
        status: 'obsolete',
        documentId: targetDocumentId,
        ...(storyboardId ? { storyboardDesignId: storyboardId } : {}),
        message: '目标原稿已不存在，未应用迟到的规划结果。',
      } satisfies StoryboardPlanApplicationResult
    }
    const design = store.setStoryboardPlan(plan, targetDocumentId, storyboardId, true, !storyboardId)
    if (!design) {
      return {
        status: 'obsolete',
        documentId: targetDocumentId,
        ...(storyboardId ? { storyboardDesignId: storyboardId } : {}),
        message: '目标分镜已不存在，未应用迟到的规划结果。',
      } satisfies StoryboardPlanApplicationResult
    }
    if (store.workspaceMode === 'creation' || store.workspaceMode === 'storyboard') {
      store.setWorkspaceMode('creation')
    }
    return {
      status: 'applied',
      documentId: targetDocumentId,
      storyboardDesignId: design.id,
      message: `已生成分镜方案「${plan.title || '未命名'}」：${plan.anchors.length} 个锚 · ${plan.shots.length} 个镜头，已放到分镜页，待你审阅/修改后在行内或底部批量生成。`,
    } satisfies StoryboardPlanApplicationResult
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
    const existingCanvasNodes = readGenerationCanvasSnapshot().nodes
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
      const plannedMeta = buildPlannedNodeMeta(node, entryByKey)
      // 参考卡身份透传（分镜方案的角色/场景/道具锚）→ node.meta.referenceSheet，编号分配处据此跳过。
      // 首帧图身份同机制 → node.meta.storyboardKeyframe：创建时不领号，随后共用所属视频的镜号（见下）。
      // W2 圣经：static/dynamic 特征也透传进 meta（键名走 anchorBibleKeys 单一常量，防 GUI/headless 漂移）——
      // 身份轴对照读 meta.staticFeatures、冻结门/交付可显示；passthrough schema 自动持久化，零 schema 改动。
      const staticFeatures =
        typeof node.staticFeatures === 'string' && node.staticFeatures.trim() ? node.staticFeatures.trim() : ''
      const dynamicFeatures =
        typeof node.dynamicFeatures === 'string' && node.dynamicFeatures.trim() ? node.dynamicFeatures.trim() : ''
      const identityMarks = {
        ...(node.referenceSheet === true ? { referenceSheet: true } : {}),
        ...(node.storyboardKeyframe === true ? { storyboardKeyframe: true } : {}),
        ...(staticFeatures ? { [ANCHOR_META_KEYS.staticFeatures]: staticFeatures } : {}),
        ...(dynamicFeatures ? { [ANCHOR_META_KEYS.dynamicFeatures]: dynamicFeatures } : {}),
      }
      // StoryboardPlan supplies structured provenance/shot-language under `metadata`.
      // Keep this as a single generic passthrough so plan fields survive in the real
      // canvas node (not only in the prompt); identity marks remain the authoritative
      // values for their reserved keys.
      const structuredMetadata =
        node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
          ? (node.metadata as Record<string, unknown>)
          : undefined
      const meta =
        structuredMetadata || Object.keys(identityMarks).length
          ? { ...(plannedMeta ?? {}), ...(structuredMetadata ?? {}), ...identityMarks }
          : plannedMeta
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
        registerCanvasToolClientId(clientId, created[index].id)
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
    // 图片+视频分镜：首帧图与所属视频共用镜号（同手动「转视频」桥的继承号语义，见 convertShotToVideo）。
    // 首帧图带 meta.storyboardKeyframe 创建时不自动领号（shotNumbering 跳过），此处按计划里的
    // first_frame 边把视频已领的编号写回 → 18 镜就是 1..18，角标与「镜头 N 首帧」标题一致。
    const keyframeClientIds = new Set(
      incoming
        .filter((raw) => raw && typeof raw === 'object' && (raw as Record<string, unknown>).storyboardKeyframe === true)
        .map((raw) => String((raw as Record<string, unknown>).clientId || '')),
    )
    if (keyframeClientIds.size) {
      const canvasStore = useGenerationCanvasStore.getState()
      const nodeById = new Map(canvasStore.nodes.map((node) => [node.id, node]))
      for (const rawEdge of rawPlanEdges) {
        const edge = rawEdge && typeof rawEdge === 'object' ? (rawEdge as Record<string, unknown>) : {}
        if (edge.mode !== 'first_frame') continue
        const sourceClientId = String(edge.sourceClientId || '')
        if (!keyframeClientIds.has(sourceClientId)) continue
        const keyframeId = clientIdToNodeId[sourceClientId]
        const videoId = clientIdToNodeId[String(edge.targetClientId || '')]
        const videoShotIndex = videoId ? nodeById.get(videoId)?.shotIndex : undefined
        if (keyframeId && typeof videoShotIndex === 'number') {
          canvasStore.updateNode(keyframeId, { shotIndex: videoShotIndex })
        }
      }
    }
    // 批量落节点后统一请求适应视图。AI 直接建卡、方案确认和示例引导都走这里，
    // 避免调用方漏触发后只看到被视口裁断的一部分新节点。单节点不重排全局视口，
    // 但要把刚创建的卡居中：布局原点在已有内容下方，若时间轴占据底部，单卡可能
    // 被裁在视口外；保留当前视口并不等于让用户自己猜卡片去了哪里。
    if (created.length > 1) {
      const workbench = useWorkbenchStore.getState()
      const categoryCounts = new Map<string, { count: number; firstIndex: number }>()
      created.forEach((node, index) => {
        const categoryId = node.categoryId || 'shots'
        const current = categoryCounts.get(categoryId)
        categoryCounts.set(categoryId, { count: (current?.count ?? 0) + 1, firstIndex: current?.firstIndex ?? index })
      })
      const fitCategoryId = categoryCounts.has(workbench.activeCategoryId)
        ? workbench.activeCategoryId
        : [...categoryCounts.entries()].sort(
            ([leftId, left], [rightId, right]) =>
              right.count - left.count ||
              Number(rightId === 'shots') - Number(leftId === 'shots') ||
              left.firstIndex - right.firstIndex,
          )[0]?.[0]
      workbench.requestCanvasFit(fitCategoryId)
    } else if (created[0] && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: created[0].id } }))
    }
    return {
      createdNodeIds: created.map((node) => node.id),
      clientIdToNodeId,
      ...(rawPlanEdges.length ? { connectedCount } : {}),
      ...(skippedEdges.length > 0 ? { skippedEdges } : {}),
    }
  }

  if (toolName === 'create_staging_reference') {
    const rawShot = typeof record.shotClientId === 'string' ? record.shotClientId.trim() : ''
    const targetNodeId = rawShot ? resolveNodeId(rawShot) : undefined
    const rawChars = Array.isArray(record.characters) ? record.characters : []
    const customBlocking = typeof record.customBlocking === 'string' ? record.customBlocking.trim() : ''

    // 词表外逃生口：没有词表角色、只给了 customBlocking → 不渲站位图，把构图意图
    // 当指令追加进目标「关键帧图片节点」prompt（composition 文字通道，模型自己解；精度略低但不硬塞错词）。
    if (rawChars.length === 0 && customBlocking) {
      if (!targetNodeId) {
        throw new Error('customBlocking 需要 shotClientId 指向该镜头的关键帧图片节点才能注入构图指令')
      }
      const outcome = appendDirectiveToNodePrompt(targetNodeId, '构图', customBlocking, 'stagingPromptApplied', inCtx)
      if (!outcome.found) throw new Error('node_not_found:customBlocking 的目标节点不存在')
      return {
        stagingNodeId: null,
        targetNodeId,
        degraded: true,
        message: outcome.alreadyApplied
          ? `该构图指令已写入镜头关键帧 prompt（词表外，prompt 引导，未渲精确站位图）。`
          : `站位意图不在词表内，已用 prompt 引导：把构图指令写进镜头关键帧 prompt（未渲精确站位图，保真度低于 3D 站位参考）。`,
      }
    }

    // 站位参考：词汇 spec → 3D 场景 → 建 scene3d 节点(带 stagingAutoCapture)。
    // 节点挂载时离屏出图 + 连 composition_ref 到目标镜头（Scene3DEditor 内完成）。
    const spec = parseStagingSpec(record)
    const { buildStagingSceneAudited } = await import('../nodes/scene3d/stagingBuilder')
    // 运行时自检(F3,零额度几何守卫):修正非法/近似姿势 id(治静默落站立)+ 角色过近自动拉开间距。
    const { state, issues: stagingIssues } = buildStagingSceneAudited(spec)
    const existing = readGenerationCanvasSnapshot().nodes
    const position = layoutPlannedNodes(['image'], existing)[0]
    const created = inCtx(() =>
      generationCanvasTools.create_nodes([
        {
          kind: 'scene3d',
          categoryId: getDefaultCategoryForNodeKind('scene3d'),
          title: '站位参考',
          prompt: '',
          position,
          meta: {
            scene3dState: state,
            stagingAutoCapture: targetNodeId ? { targetNodeId } : {},
          },
        },
      ]),
    )
    const stagingNodeId = created[0]?.id ?? null
    const cam = spec.camera ?? {}
    return {
      stagingNodeId,
      targetNodeId: targetNodeId ?? null,
      message: `已创建站位参考（${spec.characters.length} 角色 · ${spec.layout ?? '自动'} 站位 · ${cam.angle ?? 'three-quarter'}/${cam.height ?? 'eye'}/${cam.shot ?? 'medium'}）。正在离屏渲染出图${targetNodeId ? '并连到镜头作 composition_ref' : ''}。${stagingIssues.length ? ' ⚠️ ' + stagingIssues.join('；') : ''}`,
    }
  }

  if (toolName === 'create_camera_move') {
    const parsed = parseCameraMoveSpec(record)
    const rawShot = typeof record.shotClientId === 'string' ? record.shotClientId.trim() : ''
    const targetNodeId = rawShot ? resolveNodeId(rawShot) : undefined

    // move 与 customMove 都没有 → 明确报错让 LLM 二选一（不静默兜 push_in 硬塞一个运镜）。
    if (!parsed.move && !parsed.customMove) {
      throw new Error('create_camera_move 需要 move（词表内精确运镜）或 customMove（词表外自由描述）二选一')
    }
    // 词表外逃生口：只有 customMove → 不渲运镜小片，把运镜意图当电影术语指令追加进
    // 目标「视频节点」prompt（i2v 文字通道，模型自己解；精度略低但不硬塞错的 enum）。
    if (!parsed.move && parsed.customMove) {
      if (!targetNodeId) {
        throw new Error('customMove 需要 shotClientId 指向该镜头的视频节点才能注入运镜指令')
      }
      const outcome = appendDirectiveToNodePrompt(
        targetNodeId,
        '镜头运动',
        parsed.customMove,
        'cameraMovePromptApplied',
        inCtx,
      )
      if (!outcome.found) throw new Error('node_not_found:customMove 的目标节点不存在')
      return {
        cameraMoveNodeId: null,
        targetNodeId,
        degraded: true,
        message: outcome.alreadyApplied
          ? `该运镜指令已写入镜头视频 prompt（词表外，prompt 引导，未渲精确运镜参考）。`
          : `运镜意图不在词表内，已用 prompt 引导：把运镜指令写进镜头视频 prompt（未渲精确运镜参考，保真度低于 3D 运镜小片）。`,
      }
    }

    // 运镜参考:词汇 spec → 含相机轨迹的 3D 场景 → 建 scene3d 节点(带 cameraMoveAutoCapture)。
    // 节点挂载时常驻 Host(CameraMoveCaptureHost)离屏沿轨迹采帧拼 mp4 + 喂目标镜头视频参考(S3)。
    // 这里只建节点 + 打标志,不渲(S2 Host 异步出片),与 staging 执行结构对称。
    // 建节点 + 标志的实现抽进 createCameraMoveReferenceNode(单一真相源)——手动运镜控件(B1)也调它,
    // 两条产路共用 fps/frameCount/move 不变量,不再各自内联(P1/P4)。
    const spec: CameraMoveSpec = {
      move: parsed.move ?? 'push_in',
      speed: parsed.speed,
      shot: parsed.shot,
      subjectPose: parsed.subjectPose,
      sceneTemplate: parsed.sceneTemplate,
      props: parsed.props,
    }
    const [{ createCameraMoveReferenceNode }, { CAMERA_SPEED_DURATION, CAMERA_MOVE_LABEL }] = await Promise.all([
      import('../nodes/scene3d/cameraMoveReferenceNode'),
      import('../nodes/scene3d/cameraMoveVocab'),
    ])
    const speed: CameraSpeed = spec.speed ?? 'medium'
    const { cameraMoveNodeId } = createCameraMoveReferenceNode({ spec, targetNodeId, inCtx })
    return {
      cameraMoveNodeId,
      targetNodeId: targetNodeId ?? null,
      message: `已创建运镜参考（${CAMERA_MOVE_LABEL[spec.move]} · ${spec.shot ?? 'medium'} · ${speed} ≈${CAMERA_SPEED_DURATION[speed]}s）。正在离屏渲染运镜小片${targetNodeId ? '并喂给镜头作运镜参考视频' : ''}。`,
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

  if (toolName === 'arrange_storyboard_to_timeline') {
    // 排序/选片全在纯函数(planStoryboardTimeline)里——LLM 只触发,顺序按 shotIndex 镜序确定。
    // 不走 inCtx 手势上下文(那是画布事件域);时间轴变更是 workbenchStore 的事。
    const rawIds = Array.isArray(record.nodeIds)
      ? record.nodeIds.map((id) => resolveNodeId(String(id || '').trim())).filter(Boolean)
      : undefined
    const result = await arrangeStoryboardToTimeline({
      ...(rawIds && rawIds.length ? { nodeIds: rawIds } : {}),
      assertCanApply: assertWritable,
    })
    if (result.scopeError) throw new Error(result.scopeError)
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

  if (toolName === 'tidy_canvas') {
    // 助手「整理画布」：复用 store 的 tidyCategory（与右下角整理按钮同一实现，P1 无并行版）。
    // categoryId 缺省 = 用户当前正看的子画布（activeCategoryId 在 workbenchStore）；aspect 用视口比例兜底。
    const categoryId =
      (typeof record.categoryId === 'string' && record.categoryId.trim()) ||
      useWorkbenchStore.getState().activeCategoryId ||
      'shots'
    const aspect =
      typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 16 / 9
    const count = useGenerationCanvasStore
      .getState()
      .nodes.filter((node) => (node.categoryId || 'shots') === categoryId).length
    inCtx(() => useGenerationCanvasStore.getState().tidyCategory(categoryId, aspect))
    return { tidied: categoryId, nodeCount: count }
  }

  throw new Error(`unknown tool ${toolName}`)
}
export const STORYBOARD_PLAN_APPLICATION_STATUSES = ['applied', 'obsolete'] as const
export type StoryboardPlanApplicationStatus = typeof STORYBOARD_PLAN_APPLICATION_STATUSES[number]

export type StoryboardPlanApplicationResult = {
  status: StoryboardPlanApplicationStatus
  documentId: string
  storyboardDesignId?: string
  message: string
}
