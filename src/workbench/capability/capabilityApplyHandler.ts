import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'
import {
  MCP_PROJECT_ADDRESSABLE_CAPABILITY_OPS,
  MCP_REALTIME_SURFACE_CAPABILITY_OPS,
  capabilityProjectBindingError,
} from './capabilityProjectBinding'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { buildMultiShotContractView, type MultiShotGatePayload } from '../generationCanvas/spend/productionContractView'
import { getDesktopBridge } from '../../desktop/bridge'
import i18n, { getAppLocale } from '../../i18n'
import { runStoryboardPlanner } from '../generationCanvas/agent/runStoryboardPlanner'
import { runDirectionPlanner } from '../generationCanvas/agent/runDirectionPlanner'
import { productionScriptSessionKey } from '../ai/agentSessionKey'
import { runSingleShotAgent } from '../ai/agentLoopMode'
import { useWorkbenchStore } from '../workbenchStore'
import { arrangeStoryboardToTimeline } from '../generationCanvas/agent/sendStoryboardToTimeline'
import { createTimelineExportManifest } from '../export/exportApi'
import { exportTimelineToWebm } from '../export/timelineWebmExport'
import { verifyShotsAndReport, isShotVerifyEnabled } from '../generationCanvas/agent/shotVerifyStore'
import { isAnchorFrozen, isVisualAnchorNode } from '../generationCanvas/model/anchorBibleKeys'
import { assertDraftFilmReady, draftFilmTimelineFromState } from '../preview/timelineSubtitleTransitionContract'
import { storyboardPlanToCreateNodesArgs } from '../generationCanvas/agent/storyboardPlan'
import { parseStoryboardPlan } from '../generationCanvas/agent/storyboardPlanSchema'
import { resolveStoryboardImageDefault, resolveStoryboardVideoDefault } from '../generationCanvas/agent/availableModels'
import { applyCanvasToolCall, resolveCanvasToolNodeId } from '../generationCanvas/agent/applyCanvasToolCall'
import { generationCanvasTools, readGenerationCanvasSnapshot } from '../generationCanvas/agent/generationCanvasTools'
import { captureCanvasReadResult } from '../generationCanvas/agent/canvasReadResultSeal'
import {
  captureCurrentProjectCanvasReadSurfaceBinding,
  sealCurrentProjectCanvasReadSnapshot,
} from '../project/projectCanvasReadSurface'
import {
  SurfacePortWireError,
  type CapturedCanvasReadSnapshotHandleWire,
} from '../../../electron/shared/surfacePortBinding'
import { handleMultiShotCanvasLandingOp } from './multiShotCanvasLanding'
import { executeTimelineReadTarget, executeTimelineWriteTarget } from '../timeline/agent/timelineCapabilityTarget'
import { executeAssetReadTarget, executeExportReadTarget } from '../timeline/agent/phase4CapabilityTargets'
import { executeCanonicalCanvasPlanPatch } from './canonicalCanvasPlanPatch'
import { toast } from '../../ui/toast'

// 能力核 A 模式实时桥 · 渲染层处理器。
// 主进程把外部 MCP 的画布读/写/付费确认转发到这里（只在该项目正打开时路由），处理后回结果。
// 单一真相源：画布读写复用 store 现成动作（readDocumentSnapshot / applyExternalGraph），
// 付费确认复用全仓唯一的 useSpendConfirmStore（不另造并行 UI，P1）。

type SpendConfirmPayload = {
  projectId?: string
  projectName?: string
  nodeId?: string
  intent?: string
  vendor?: string
  modelKey?: string
  prompt?: string
  /** 主进程带上：这次确认还会换来「本会话该项目后续生成免问」→ 卡上多写一句授权范围。 */
  grantsSessionTrust?: boolean
}

// 方案门（Phase B）：外部 agent 批量落节点前的确认。projectId 由主进程网关带上（可能非当前项目）。
type PlanConfirmPayload = {
  projectId?: string
  nodeCount?: number
  titles?: string[]
}

type GenerationGateConfirmPayload = {
  challengeId?: string
  projectName?: string
  shotSummary?: string
  model?: string
  referenceCount?: number
  maximumCost?: number
  currency?: string
  expiresAt?: string
  /**
   * P4 S3a — 多镜合同投影（三层管线末端）。有它 → 弹多镜确认卡（复用唯一 spendConfirm 漏斗的 contract 槽，
   * 不造并行卡，P1）；无它 → 走今日扁平单镜卡（字节不动，单镜 E2E 是回归门）。
   */
  shots?: MultiShotGatePayload
}

function describeIntent(intent: string | undefined): string {
  const normalized = String(intent || '')
  if (normalized === 'image' || normalized === 'video' || normalized === 'audio' || normalized === 'text') {
    return i18n.t(`runtime.capability.intent.${normalized}`)
  }
  return i18n.t('runtime.capability.intent.fallback')
}

async function runProductionTextPlanner(input: {
  projectId?: string
  goal?: string
  instruction?: string
  source?: string
  outputFormat?: 'script' | 'storyboard'
}): Promise<string> {
  const projectId = input.projectId || ''
  const prompt =
    input.outputFormat === 'storyboard'
      ? [
          '你是分镜规划师。请根据下面的原分镜方案和修改要求，输出一份完整、可执行的 StoryboardPlan JSON。',
          '只输出 JSON，不要 Markdown、解释或代码围栏。必须包含 title、anchors、shots；每个 shot 必须包含 index、durationSec、anchorIds、prompt。',
          '允许的 shot 字段：shotId、shotKind(image|video)、durationSec、anchorIds、prompt、modelKey、modeId、params、ffDesc、motionDesc、lfDesc、subtitle、dialogue、variationType(large|medium|small)、camIdx、continuity、transition({type:cut|dissolve|fade|match_cut|whip_pan,durationFrames?})、keyframe。',
          `修改要求：${input.instruction || '保持原方案，只修正明显问题。'}`,
          '原分镜方案：',
          input.source || '',
        ].join('\n')
      : input.instruction
        ? [
            '你是短视频编剧。请在不改变事实的前提下，按修改要求改写下面的稿件。',
            `修改要求：${input.instruction}`,
            '原稿：',
            input.source || input.goal || '',
            '只输出改写后的完整稿件，不要解释。',
          ].join('\n')
        : [
            '你是短视频编剧。请把下面的创作简报写成一份可审阅的完整初稿。',
            '要求：有明确开场、发展、转折和结尾；每镜写清画面、动作、声音/对白和字幕；不要编造简报没有的产品事实。',
            '创作简报：',
            input.goal || '',
            '只输出稿件正文，不要解释。',
          ].join('\n')
  // Ephemeral single-shot text planning never clears a UI conversation.
  const response = await runSingleShotAgent({
    featureKey: productionScriptSessionKey(projectId),
    prompt,
    displayPrompt: input.instruction ? '修改制作稿件' : '生成制作剧本',
    ...(projectId ? { projectId } : {}),
    skillKey: 'workbench.production.script-planner',
    skillName: '剧本初稿规划',
  })
  const text = response.text?.trim()
  if (!text) throw new Error('剧本规划没有返回可审阅内容')
  return text
}

/** 外部 MCP 付费确认：弹全仓唯一的确认对话框（agent 来源 + 明细 + 60s 倒计时），真人点了才回 confirmed。 */
async function confirmSpendForAgent(info: SpendConfirmPayload): Promise<{ confirmed: boolean }> {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((item) => item.id === info.nodeId)
  const nodeLabel =
    node?.title?.trim() ||
    (typeof node?.prompt === 'string' && node.prompt.trim()
      ? node.prompt.trim().slice(0, 24)
      : i18n.t('runtime.capability.newNode'))
  // 参考图门 vs 生成门（Phase B）：定妆/场景卡（meta.referenceSheet）= 参考图门（相机图标+措辞），否则生成门。
  const isReference = Boolean(node?.meta && (node.meta as Record<string, unknown>).referenceSheet === true)
  const promptPreview = typeof info.prompt === 'string' && info.prompt.trim() ? info.prompt.trim().slice(0, 60) : ''
  const projectName = typeof info.projectName === 'string' ? info.projectName.trim() : ''
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    kind: isReference ? 'reference' : 'generation',
    title: isReference
      ? i18n.t('runtime.capability.referenceTitle')
      : i18n.t('runtime.capability.spendTitle', { intent: describeIntent(info.intent) }),
    // 授权范围写在脸上：这一点下去还会换来「本会话该项目后续生成免问」，不写明就是骗同意（D4）。
    message: [
      promptPreview
        ? i18n.t('runtime.capability.spendMessageWithPrompt', {
            prompt: `${promptPreview}${info.prompt && info.prompt.length > 60 ? '…' : ''}`,
          })
        : i18n.t('runtime.capability.spendMessage'),
      ...(info.grantsSessionTrust ? [i18n.t('runtime.capability.spendGrantsSessionTrust')] : []),
    ].join('\n'),
    confirmLabel: i18n.t('runtime.capability.confirmGenerate'),
    source: 'agent',
    countdownMs: 60_000,
    details: [
      // 项目行放第一位：用户可能不在这个项目里，先让他知道花在哪个项目。
      ...(projectName ? [{ label: i18n.t('runtime.capability.project'), value: projectName }] : []),
      { label: i18n.t('runtime.capability.node'), value: nodeLabel },
      {
        label: i18n.t('runtime.capability.model'),
        value: [info.vendor, info.modelKey].filter(Boolean).join(' · ') || i18n.t('runtime.capability.defaultModel'),
      },
      { label: i18n.t('runtime.capability.output'), value: describeIntent(info.intent) },
    ],
  })
  return { confirmed: Boolean(ok) }
}

/**
 * One user-facing confirmation card for the semantic generation challenge.
 *
 * P4 S3a：payload 带 `shots`（多镜合同投影）→ 弹**多镜确认卡**（唯一 spendConfirm 漏斗的 contract 槽，
 * 逐镜清单 + 固定 footer + 试拍/返回修改，P1 不造并行卡）；无 `shots` → 走今日扁平单镜卡（字节不动）。
 * 试拍/返回修改经回调回传：`{ confirmed:false, trialFirst:true }`。缩到首镜 + 重封存 + 重发 gate = S4。
 */
async function confirmGenerationGateForAgent(
  info: GenerationGateConfirmPayload,
): Promise<{ confirmed: boolean; trialFirst?: boolean; challengeId?: string }> {
  const withChallenge = <T extends Record<string, unknown>>(base: T) => ({
    ...base,
    ...(info.challengeId ? { challengeId: info.challengeId } : {}),
  })

  // ── 多镜路径（S3a 用户可见 UI）──
  if (info.shots && Array.isArray(info.shots.shots) && info.shots.shots.length > 0) {
    const payload: MultiShotGatePayload = {
      ...info.shots,
      ...(info.projectName ? { projectName: info.projectName } : {}),
      // gate 有效期兜底进投影（payload 自带优先）。
      ...(info.shots.expiresAt ? {} : info.expiresAt ? { expiresAt: info.expiresAt } : {}),
    }
    const contract = buildMultiShotContractView(payload)
    const projectName = typeof info.projectName === 'string' ? info.projectName.trim() : ''
    let trialFirst = false
    let backToEdit = false
    const ok = await useSpendConfirmStore.getState().requestConfirm({
      kind: 'contract',
      title: i18n.t('runtime.capability.generationGateBatchTitle'),
      // 一句话正文：项目名 +「先出主角形象给你过目，点头后才开拍」（零内部术语）。
      message: i18n.t('generationCommon.production.batch.body', {
        project: projectName || i18n.t('runtime.capability.generationGateProject'),
      }),
      confirmLabel: i18n.t('generationCommon.production.batch.confirm', { count: payload.shots.length }),
      source: 'agent',
      // 倒计时时长随镜数伸缩：每镜 +8s，封顶 5 分钟（交互即暂停，见 SpendConfirmDialog）。
      countdownMs: Math.min(300_000, 60_000 + payload.shots.length * 8_000),
      contract,
      onTrialFirst: () => {
        trialFirst = true
      },
      onBackToEdit: () => {
        backToEdit = true
      },
    })
    // 试拍/返回修改都不算确认；只有试拍需要给主进程一个「缩到首镜重发」的信号（S4 落地）。
    void backToEdit
    return withChallenge({ confirmed: Boolean(ok), ...(trialFirst ? { trialFirst: true } : {}) })
  }

  // ── 单镜路径（今日形态，字节不动；单镜 E2E 是回归门）──
  const model =
    typeof info.model === 'string' && info.model.trim() ? info.model.trim() : i18n.t('runtime.capability.defaultModel')
  const shot =
    typeof info.shotSummary === 'string' && info.shotSummary.trim()
      ? info.shotSummary.trim()
      : i18n.t('runtime.capability.generationGateShotFallback')
  const maximumCost = Number.isFinite(info.maximumCost) ? Number(info.maximumCost) : 0
  const cost = `${typeof info.currency === 'string' ? info.currency : ''}${maximumCost}`
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    kind: 'generation',
    title: i18n.t('runtime.capability.generationGateTitle'),
    message: i18n.t('runtime.capability.generationGateMessage', { model, cost, shot }),
    confirmLabel: i18n.t('runtime.capability.confirmGenerate'),
    source: 'agent',
    countdownMs: 60_000,
    details: [
      ...(info.projectName
        ? [{ label: i18n.t('runtime.capability.generationGateProject'), value: info.projectName }]
        : []),
      { label: i18n.t('runtime.capability.generationGateModel'), value: model },
      ...(Number.isInteger(info.referenceCount)
        ? [{ label: i18n.t('runtime.capability.generationGateReferences'), value: String(info.referenceCount) }]
        : []),
      { label: i18n.t('runtime.capability.generationGateCost'), value: cost },
      ...(info.expiresAt ? [{ label: i18n.t('runtime.capability.generationGateExpires'), value: info.expiresAt }] : []),
    ],
  })
  return withChallenge({ confirmed: Boolean(ok) })
}

/** 外部 MCP 方案门（Phase B）：agent 要往画布落一套节点（≥2）前弹确认卡（免费可撤），复用同一漏斗（P1）。 */
async function confirmPlanForAgent(info: PlanConfirmPayload): Promise<{ confirmed: boolean }> {
  const count = typeof info.nodeCount === 'number' ? info.nodeCount : 0
  const titles = Array.isArray(info.titles) ? info.titles.filter((t) => typeof t === 'string' && t.trim()) : []
  const preview = titles.slice(0, 5).join('、') + (titles.length > 5 ? '…' : '')
  const projectName = (() => {
    if (!info.projectId) return ''
    const active = getActiveWorkbenchProjectId()
    return info.projectId === active ? '' : info.projectId // 非当前项目才显 id 提示（当前项目无需重复）
  })()
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    kind: 'plan',
    title: i18n.t('runtime.capability.planTitle'),
    message: i18n.t('runtime.capability.planMessage', { count }),
    confirmLabel: i18n.t('runtime.capability.planConfirm'),
    source: 'agent',
    countdownMs: 60_000,
    details: [
      ...(projectName ? [{ label: i18n.t('runtime.capability.project'), value: projectName }] : []),
      {
        label: i18n.t('runtime.capability.planNodeCount'),
        value: i18n.t('runtime.capability.planNodeCountValue', { count }),
      },
      ...(preview ? [{ label: i18n.t('runtime.capability.planIncludes'), value: preview }] : []),
    ],
  })
  return { confirmed: Boolean(ok) }
}

/** 从 content 偏差的 `actual`（人话「第 N 档」）抠回 1-5 档分数；抠不出给 undefined。 */
function scoreFromDeviationActual(actual: unknown): number | undefined {
  const match = typeof actual === 'string' ? actual.match(/(\d+)/) : null
  if (!match) return undefined
  const n = Number(match[1])
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : undefined
}

/**
 * W1.5 路径②审片：production run 的 qa 阶段让渲染层对本次生成镜头判分。
 * 复用**现成的** verifyShotsAndReport（判分+对账卡+回灌闭环），
 * 这里只做参数适配（run 的镜头节点 id → 它的入参）+ 将本次调用返回的判决塑形回传。
 * 判决 = content 偏差（每条 kind:'content' 回指 shotNodeId + 维度 field + 档位 actual + reason）；
 * 被审但无偏差的镜头 = 过检。verify 关闭 / 无镜头 → skipped（driver 据此落「审片跳过」）。
 */
async function verifyShotsForProduction(shotNodeIds: readonly string[]): Promise<unknown> {
  if (!isShotVerifyEnabled()) return { skipped: true, skipReason: '画面审片已在设置中关闭' }
  const knownNodeIds = new Set(useGenerationCanvasStore.getState().nodes.map((node) => node.id))
  const reviewedShotIds = shotNodeIds.filter((id) => knownNodeIds.has(id))
  if (reviewedShotIds.length === 0) return { skipped: true, skipReason: '当前项目里找不到本次生成的镜头节点' }
  // 现成闭环：内部 gather → 判分 → 写 shotVerify store。直接使用「本次」返回值，不能在 await
  // 后读全局 store——同项目另一轮审片可能已经后发先至，读到的会是另一次结果。
  const deviations = await verifyShotsAndReport(reviewedShotIds)
  const flaggedByShot = new Map<string, Array<{ dimensionName?: string; score?: number; reason?: string }>>()
  for (const deviation of deviations) {
    if (deviation.kind !== 'content' || !deviation.shotNodeId) continue
    const list = flaggedByShot.get(deviation.shotNodeId) ?? []
    list.push({
      dimensionName: typeof deviation.field === 'string' ? deviation.field : undefined,
      score: scoreFromDeviationActual(deviation.actual),
      reason: typeof deviation.reason === 'string' ? deviation.reason : undefined,
    })
    flaggedByShot.set(deviation.shotNodeId, list)
  }
  const nodesById = new Map(useGenerationCanvasStore.getState().nodes.map((node) => [node.id, node]))
  const verdicts = reviewedShotIds.map((shotNodeId) => {
    const flagged = flaggedByShot.get(shotNodeId) ?? []
    const title = (nodesById.get(shotNodeId)?.title || '').trim()
    return {
      shotNodeId,
      passed: flagged.length === 0,
      ...(title ? { shotTitle: title } : {}),
      ...(flagged.length ? { flagged } : {}),
    }
  })
  return { reviewedShotIds, verdicts }
}

/** 处理一条主进程转发来的能力操作。未知操作抛错（主进程会把错误透传给 agent）。 */
export async function handleCapabilityApply(op: string, payload: unknown): Promise<unknown> {
  const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const projectId = typeof data.projectId === 'string' ? data.projectId : ''
  const activeId = getActiveWorkbenchProjectId()
  // 画布读写**只能**作用于当前打开的项目（动 store → 必须是活动项目，否则串台）；目标≠活动 → 拒。
  // 确认门（spend.confirm / plan.confirm）不在此限：AI 想在「非当前项目」生成/落方案时也弹全局卡，
  // 卡里标明项目名，确认后走盘落地（不动非活动 store）。这正是治静默黑洞的关键放开。
  //
  // 项目身份按**面**分流（定义与理由住在 capabilityProjectBinding.ts）：
  // · 可寻址面（asset.read / export.read）——底下按 projectId 直接寻址主进程 store，项目开不开着都能答，
  //   所以完全豁免本闸，lease 的 projectId 一路往下传（这正是 MCP 宿主「改不了自己建的项目」的根因）。
  // · 实时面（timeline.read / timeline.write）——真相在打开的那个项目的 store 里，
  //   **没打开任何项目也算不匹配**（旧闸在这种情况放行，然后适配器抛没有下一步的 project_scope_required）。
  // · 其余 op 维持原来的「目标≠活动 → 拒」，只是错误换成了会点名的那一句。
  if (!MCP_PROJECT_ADDRESSABLE_CAPABILITY_OPS.has(op) && op !== 'spend.confirm' && op !== 'plan.confirm' && projectId) {
    const mismatched = MCP_REALTIME_SURFACE_CAPABILITY_OPS.has(op)
      ? projectId !== (activeId ?? '')
      : Boolean(activeId) && projectId !== activeId
    if (mismatched) throw capabilityProjectBindingError(projectId, activeId)
  }
  const plannerSnapshot =
    op === 'production.plan-storyboard'
      ? captureCanvasReadResult({
          ...readGenerationCanvasSnapshot(),
          // Production planning is document-scoped. A transient UI selection
          // must not make the prompt and the main-sealed read target disagree.
          selectedNodeIds: [],
        })
      : null
  const plannerFeatureKey = `nomi:production-planner:${projectId || 'local'}:${typeof data.runId === 'string' ? data.runId : 'unbound'}:${typeof data.operationId === 'string' ? data.operationId : op}`
  let plannerCapturedCanvasReadSnapshot: CapturedCanvasReadSnapshotHandleWire | null = null
  if (plannerSnapshot) {
    const plannerBinding = captureCurrentProjectCanvasReadSurfaceBinding()
    if (!plannerBinding) throw new SurfacePortWireError('surface_port_unavailable')
    // This is production submission's first await. Main seals A's exact safe
    // bytes before unrelated landing work can yield and the UI can switch to B.
    plannerCapturedCanvasReadSnapshot = await sealCurrentProjectCanvasReadSnapshot(plannerBinding, plannerSnapshot)
  }

  // P4 S5 画布落地（materialize-shots / attach-shot-result）——受上面的活动项目守卫约束（只动当前项目 store），
  // 落点住在 multiShotCanvasLanding（保持本 handler 精简）。未处理返回 null → 继续走下方 switch。
  const landed = await handleMultiShotCanvasLandingOp(op, data)
  if (landed !== null) return landed

  switch (op) {
    case 'integration.open-credentials': {
      window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models' } }))
      return { opened: true }
    }
    case 'host-config.repaired': {
      // 主进程只在真的改了配置文件时才发这一条，并附上该重启哪些助手（Claude Code / Codex / Cursor
      // 或用户自建的 profile）。名字从修复结果来，不在这里再写死一个「Claude Code」。
      const clients = Array.isArray(data.clients) ? data.clients.filter((name): name is string => typeof name === 'string') : []
      if (!clients.length) return { notified: false }
      toast(i18n.t('studio.hostConfigRepaired', { clients: clients.join(getAppLocale() === 'en' ? ', ' : '、') }), 'info')
      return { notified: true }
    }
    case 'document.write': {
      const tools = useWorkbenchStore.getState().creationDocumentTools
      const operation = data.operation === 'insert' || data.operation === 'replace' || data.operation === 'append'
        ? data.operation
        : null
      const content = typeof data.content === 'string' ? data.content : ''
      const documentId = useWorkbenchStore.getState().activeDocumentId
      if (!tools || !operation || !content || !documentId) {
        throw new SurfacePortWireError('surface_port_unavailable')
      }
      const current = tools.readState()
      return tools.applyDocumentWrite({
        operation,
        content,
        target: { kind: 'document', documentId, anchor: current.anchor },
        preconditions: { document: { revision: current.revision, contentHash: current.contentHash } },
      })
    }
    case 'canvas.write':
      return executeCanonicalCanvasPlanPatch({
        projectId,
        input: data.input,
        receiptProposalId: typeof data.receiptProposalId === 'string' ? data.receiptProposalId : 'mcp-canvas-plan:renderer',
        approvalId: typeof data.approvalId === 'string' ? data.approvalId : 'mcp-canvas-plan:renderer',
        ...(typeof data.actionHash === 'string' ? { actionHash: data.actionHash } : {}),
        readActiveProjectId: getActiveWorkbenchProjectId,
      })
    case 'canvas.read-doc':
      return useGenerationCanvasStore.getState().readDocumentSnapshot()
    case 'canvas.apply':
      useGenerationCanvasStore.getState().applyExternalGraph(data.snapshot)
      return { ok: true }
    case 'spend.confirm':
      return confirmSpendForAgent(data as SpendConfirmPayload)
    case 'generation.gate.confirm':
      return confirmGenerationGateForAgent(data as GenerationGateConfirmPayload)
    case 'plan.confirm':
      return confirmPlanForAgent(data as PlanConfirmPayload)
    case 'timeline.read': {
      const operation = data.operation === 'range' ? 'inspect_timeline_range' : 'read_timeline'
      return executeTimelineReadTarget(
        operation === 'read_timeline'
          ? { operation }
          : {
              operation,
              startFrame: data.startFrame,
              endFrame: data.endFrame,
            } as Parameters<typeof executeTimelineReadTarget>[0],
      )
    }
    case 'timeline.write': {
      if (data.operation === 'preview') {
        const plan = data.plan && typeof data.plan === 'object' && !Array.isArray(data.plan) ? data.plan as Record<string, unknown> : {}
        return executeTimelineReadTarget({ operation: 'propose_edit_plan', ...plan } as Parameters<typeof executeTimelineReadTarget>[0])
      }
      const signal = new AbortController().signal
      const plan = data.plan && typeof data.plan === 'object' && !Array.isArray(data.plan) ? data.plan as Record<string, unknown> : {}
      const input = data.operation === 'undo'
        ? { operation: 'undo_timeline_edit', undoToken: data.undoToken, expectedRevision: data.expectedRevision, ...(typeof data.reason === 'string' ? { reason: data.reason } : {}) }
        : { operation: 'apply_edit_plan', ...plan }
      const revision = data.operation === 'undo' && typeof data.expectedRevision === 'string'
        ? data.expectedRevision
        : typeof plan.baseRevision === 'string' ? plan.baseRevision : ''
      return executeTimelineWriteTarget({
        ...(projectId ? { projectId } : {}),
        input: input as Parameters<typeof executeTimelineWriteTarget>[0]['input'],
        target: { kind: 'timeline', clipIds: [] },
        preconditions: { timeline: { revision } },
        receiptProposalId: typeof data.receiptProposalId === 'string' ? data.receiptProposalId : 'mcp-edit:renderer',
        approvalId: typeof data.approvalId === 'string' ? data.approvalId : 'mcp-host:renderer',
        actionHash: typeof data.actionHash === 'string' ? data.actionHash : 'mcp-action:renderer',
        signal,
        assertCurrent: () => undefined,
      })
    }
    case 'layout.read': {
      const layout = useWorkbenchStore.getState().editingPanelLayout
      return { operation: 'read_layout', ok: true, layout }
    }
    case 'layout.write': {
      const next = data.layout && typeof data.layout === 'object' && !Array.isArray(data.layout)
        ? data.layout as Parameters<ReturnType<typeof useWorkbenchStore.getState>['setEditingPanelLayout']>[0]
        : null
      if (!next) throw new SurfacePortWireError('capability_input_invalid')
      const store = useWorkbenchStore.getState()
      const previous = store.editingPanelLayout
      store.setEditingPanelLayout(next)
      return { operation: 'write_layout', ok: true, layout: useWorkbenchStore.getState().editingPanelLayout, receipt: `布局已更新 · ⌘Z 可撤销`, undoToken: `layout:${Date.now()}:${previous.preset}` }
    }
    case 'asset.read': {
      // 载荷是**传输形状**（leaseHandle / projectId / operation:'list'…），语义 schema 是 strict 的：
      // 整包 spread 会把 operation 覆盖回 'list'、还带进 leaseHandle/projectId，两条都直接
      // capability_input_invalid（真宿主旅程当场撞出来的）。所以按面逐字段搭语义输入。
      const assetId = typeof data.assetId === 'string' ? data.assetId : ''
      const input = data.operation === 'get' || data.operation === 'inspect'
        ? { operation: data.operation === 'get' ? 'get_media' : 'inspect_media', assetId }
        : data.operation === 'source_range'
          ? { operation: 'inspect_source_range', assetId, startFrame: data.startFrame, endFrame: data.endFrame }
          : data.operation === 'waveform'
            ? {
                operation: 'read_waveform',
                assetId,
                ...(data.startSeconds === undefined ? {} : { startSeconds: data.startSeconds }),
                ...(data.endSeconds === undefined ? {} : { endSeconds: data.endSeconds }),
                ...(data.buckets === undefined ? {} : { buckets: data.buckets }),
              }
            : {
                operation: 'search_media',
                query: typeof data.query === 'string' ? data.query : '',
                ...(Array.isArray(data.kinds) ? { kinds: data.kinds } : {}),
                ...(data.limit === undefined ? {} : { limit: data.limit }),
              }
      return executeAssetReadTarget({
        ...(projectId ? { projectId } : {}),
        input,
        target: { kind: 'asset', assetIds: assetId ? [assetId] : [] },
      })
    }
    case 'export.read': {
      const operation = data.operation === 'verify' ? 'verify_render' : 'inspect_export_job'
      return executeExportReadTarget({ ...(projectId ? { projectId } : {}), input: { operation, jobId: data.jobId }, target: { kind: 'export', jobId: data.jobId } })
    }
    case 'production.plan-directions': {
      // B1 方向门：driver 停在 awaiting_direction 时让渲染层拟 2-3 个「创意方向」候选（三选一）。
      // 走无工具的一次性文本链路（runDirectionPlanner），语言跟随 brief。失败冒泡给 driver 走
      // gate title/summary 兜底——不静默编造候选（诚实降级）。
      const brief =
        data.brief && typeof data.brief === 'object' && !Array.isArray(data.brief)
          ? (data.brief as Record<string, unknown>)
          : {}
      const playbook =
        data.playbook && typeof data.playbook === 'object' && !Array.isArray(data.playbook)
          ? (data.playbook as Record<string, unknown>)
          : null
      return runDirectionPlanner({ brief, playbook, projectId })
    }
    case 'production.plan-script': {
      const brief =
        data.brief && typeof data.brief === 'object' && !Array.isArray(data.brief)
          ? (data.brief as Record<string, unknown>)
          : {}
      const lines = [
        typeof brief.goal === 'string' ? `目标：${brief.goal}` : '',
        typeof brief.audience === 'string' ? `受众：${brief.audience}` : '',
        typeof brief.channel === 'string' ? `渠道：${brief.channel}` : '',
        typeof brief.tone === 'string' ? `调性：${brief.tone}` : '',
        typeof brief.durationSeconds === 'number' ? `时长：约 ${brief.durationSeconds} 秒` : '',
        Array.isArray(brief.sellingPoints)
          ? `卖点：${brief.sellingPoints.filter((value): value is string => typeof value === 'string').join('、')}`
          : '',
      ].filter(Boolean)
      return { text: await runProductionTextPlanner({ projectId, goal: lines.join('\n') }) }
    }
    case 'production.revise-script': {
      return {
        text: await runProductionTextPlanner({
          projectId,
          instruction: typeof data.instruction === 'string' ? data.instruction : '',
          source: typeof data.sourceContent === 'string' ? data.sourceContent : '',
        }),
      }
    }
    case 'production.revise-storyboard': {
      const revised = await runProductionTextPlanner({
        projectId,
        instruction: typeof data.instruction === 'string' ? data.instruction : '',
        source: typeof data.sourceContent === 'string' ? data.sourceContent : '',
        outputFormat: 'storyboard',
      })
      // The storyboard revision contract is deliberately stricter than script
      // revision: prose is never silently accepted as a plan.  Accept only a
      // raw JSON object (or a JSON fenced block for providers that add fences),
      // then run the same runtime schema used by materialization.
      const fenced = revised.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
      const candidate = fenced || revised.trim()
      const parsed = JSON.parse(candidate) as unknown
      const plan =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'plan' in parsed
          ? (parsed as Record<string, unknown>).plan
          : parsed
      return { plan: parseStoryboardPlan(plan) }
    }
    case 'production.plan-storyboard': {
      const brief =
        data.brief && typeof data.brief === 'object' && !Array.isArray(data.brief)
          ? (data.brief as Record<string, unknown>)
          : {}
      const result = await runStoryboardPlanner({
        target: 'production',
        projectId,
        featureKey: plannerFeatureKey,
        snapshot: plannerSnapshot!,
        capturedCanvasReadSnapshot: plannerCapturedCanvasReadSnapshot!,
        canWrite: () => true,
        storyText: typeof brief.goal === 'string' ? brief.goal : '',
        skill: { key: 'brand.promo', name: '品牌宣传片' },
      })
      const plan = result.plan
      if (!plan) throw new Error(i18n.t('runtime.capability.storyboardPlanMissing'))
      return { text: result.text, plan }
    }
    case 'production.materialize-storyboard': {
      // External MCP and the in-app StoryboardPlanEditor deliberately share
      // this callable path: parse the approved IR, convert it to the canonical
      // create_canvas_nodes payload, then let applyCanvasToolCall perform the
      // real Zustand mutation/edge wiring/layout. The service performs all
      // project/run/version/provenance checks before this operation is reached.
      const plan = parseStoryboardPlan(data.plan)
      const materializationOperationId =
        typeof data.materializationOperationId === 'string' &&
        /^[A-Za-z0-9._:-]{1,240}$/.test(data.materializationOperationId)
          ? data.materializationOperationId
          : undefined
      const [imageDefault, videoDefault] = await Promise.all([
        resolveStoryboardImageDefault(),
        resolveStoryboardVideoDefault(),
      ])
      const args = storyboardPlanToCreateNodesArgs(plan, {
        ...(imageDefault.modelKey ? { defaultImageModelKey: imageDefault.modelKey } : {}),
        ...(imageDefault.modelVendor ? { defaultImageModelVendor: imageDefault.modelVendor } : {}),
        ...(imageDefault.modeId ? { defaultImageModeId: imageDefault.modeId } : {}),
        ...(imageDefault.refModeId ? { defaultImageRefModeId: imageDefault.refModeId } : {}),
        ...(videoDefault.modelKey ? { defaultVideoModelKey: videoDefault.modelKey } : {}),
        ...(videoDefault.modelVendor ? { defaultVideoModelVendor: videoDefault.modelVendor } : {}),
        ...(videoDefault.modeId ? { defaultVideoModeId: videoDefault.modeId } : {}),
        ...(materializationOperationId ? { materializationOperationId } : {}),
      })
      // If the process dies after the canvas store commits but before the main
      // process attaches the Production contract, the next attempt reuses the
      // operation-stamped nodes instead of creating a second storyboard.
      const existingByClientId = new Map<string, string>()
      if (materializationOperationId) {
        for (const node of useGenerationCanvasStore.getState().nodes) {
          const meta = node.meta as Record<string, unknown> | undefined
          if (meta?.materializationOperationId !== materializationOperationId) continue
          const clientId = typeof meta.materializationClientId === 'string' ? meta.materializationClientId.trim() : ''
          if (clientId) existingByClientId.set(clientId, node.id)
        }
      }
      const hasExistingOperationNodes = existingByClientId.size > 0
      const missingNodes = hasExistingOperationNodes
        ? args.nodes.filter((node) => !existingByClientId.has(node.clientId))
        : args.nodes
      let applied: { createdNodeIds?: unknown; clientIdToNodeId?: unknown; connectedCount?: unknown }
      if (!hasExistingOperationNodes) {
        applied = (await applyCanvasToolCall('create_canvas_nodes', args)) as typeof applied
      } else if (missingNodes.length > 0) {
        const missingAnchorCount = missingNodes.reduce((count, node) => {
          const plannedIndex = args.nodes.indexOf(node)
          return count + (plannedIndex >= 0 && plannedIndex < args.anchorCount ? 1 : 0)
        }, 0)
        applied = (await applyCanvasToolCall('create_canvas_nodes', {
          ...args,
          nodes: missingNodes,
          edges: [],
          anchorCount: missingAnchorCount,
        })) as typeof applied
      } else {
        applied = { createdNodeIds: [], clientIdToNodeId: {}, connectedCount: 0 }
      }
      const rawClientIdToNodeId =
        applied?.clientIdToNodeId &&
        typeof applied.clientIdToNodeId === 'object' &&
        !Array.isArray(applied.clientIdToNodeId)
          ? (applied.clientIdToNodeId as Record<string, unknown>)
          : {}
      const clientIdToNodeId: Record<string, string> = {
        ...Object.fromEntries(existingByClientId.entries()),
        ...Object.entries(rawClientIdToNodeId).reduce<Record<string, string>>((out, [clientId, nodeId]) => {
          if (typeof nodeId === 'string' && nodeId.trim()) out[clientId] = nodeId
          return out
        }, {}),
      }
      const edgeResult =
        args.edges.length > 0 && hasExistingOperationNodes
          ? generationCanvasTools.connect_nodes(
              args.edges.map((edge) => ({
                source: clientIdToNodeId[edge.sourceClientId] || resolveCanvasToolNodeId(edge.sourceClientId),
                target: clientIdToNodeId[edge.targetClientId] || resolveCanvasToolNodeId(edge.targetClientId),
                ...(edge.mode ? { mode: edge.mode } : {}),
              })),
            )
          : { connected: 0 }
      const nodeById = new Map(useGenerationCanvasStore.getState().nodes.map((node) => [node.id, node]))
      const bindings = args.nodes
        .map((created) => {
          const mapped = clientIdToNodeId[created.clientId]
          const nodeId =
            typeof mapped === 'string' && mapped.trim() ? mapped : resolveCanvasToolNodeId(created.clientId)
          const node = nodeById.get(nodeId)
          const meta = node?.meta as Record<string, unknown> | undefined
          return {
            nodeId,
            stageId: 'generate',
            provider:
              typeof meta?.modelVendor === 'string'
                ? meta.modelVendor
                : typeof meta?.vendor === 'string'
                  ? meta.vendor
                  : '',
            model: typeof meta?.modelKey === 'string' ? meta.modelKey : '',
            ...(created.metadata ? { metadata: created.metadata } : {}),
          }
        })
        .filter((binding) => binding.nodeId && binding.provider && binding.model)
      return {
        createdNodeIds: args.nodes
          .map((created) => clientIdToNodeId[created.clientId])
          .filter((value): value is string => typeof value === 'string' && Boolean(value.trim())),
        connectedCount: hasExistingOperationNodes
          ? edgeResult.connected
          : typeof applied?.connectedCount === 'number'
            ? applied.connectedCount
            : 0,
        bindings,
      }
    }
    case 'production.arrange': {
      const shotNodeIds = Array.isArray(data.shotNodeIds)
        ? data.shotNodeIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
      const result = await arrangeStoryboardToTimeline(shotNodeIds.length ? { nodeIds: shotNodeIds } : {})
      if (result.scopeError) throw new Error(result.scopeError)
      if (!result.ok && result.total === 0) throw new Error('没有可排片的镜头')
      const timelineContract = draftFilmTimelineFromState(useWorkbenchStore.getState().timeline)
      return {
        arranged: result.sent.length,
        total: result.total,
        placed: result.sent.map((item) => ({ nodeId: item.nodeId, role: item.role, startFrame: item.startFrame })),
        skipped: result.skipped,
        timelineContract,
      }
    }
    case 'production.verify-shots': {
      // W1.5：qa 阶段审片（路径②）。driver 传本次已生成的镜头节点 id，渲染层复用现成审片闭环判分回传。
      const shotNodeIds = Array.isArray(data.shotNodeIds)
        ? data.shotNodeIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
      return verifyShotsForProduction(shotNodeIds)
    }
    case 'production.check-frozen': {
      // W2 冻结门：driver 提交任何镜头前，问渲染层「本 run 的画布上有哪些视觉锚（角色/场景/道具卡）还没冻结」。
      // 读画布 store 的 node.meta.frozen（判据走 anchorBibleKeys 单一镜像，与 headless/GUI 依赖波次同语义）。
      // 只回未冻结的那些（nodeId + 标题）；driver 据此设冻结门 waiting 或放行（全冻结 → 空数组 → 放行）。
      const unfrozenAnchors = useGenerationCanvasStore
        .getState()
        .nodes.filter((node) => isVisualAnchorNode(node) && !isAnchorFrozen(node))
        .map((node) => ({ nodeId: node.id, ...(node.title && node.title.trim() ? { title: node.title.trim() } : {}) }))
      return { unfrozenAnchors }
    }
    case 'production.export': {
      const project = typeof data.projectId === 'string' ? data.projectId : ''
      const state = useWorkbenchStore.getState()
      // Production Run exports are the final quality gate: a rough cut without
      // captions or a complete shot sequence must stop with an actionable
      // message instead of being reported as a finished film. Manual exports
      // without a runId retain the existing flexible editor behavior.
      if (typeof data.runId === 'string' && data.runId.trim()) {
        assertDraftFilmReady(draftFilmTimelineFromState(state.timeline))
      }
      const { manifest } = createTimelineExportManifest({
        projectId: project,
        timeline: state.timeline,
        aspectRatio: state.previewAspectRatio,
        generationNodes: useGenerationCanvasStore.getState().nodes,
      })
      return { manifest }
    }
    case 'production.capture-export': {
      const project = typeof data.projectId === 'string' ? data.projectId : ''
      const state = useWorkbenchStore.getState()
      if (typeof data.runId === 'string' && data.runId.trim()) {
        assertDraftFilmReady(draftFilmTimelineFromState(state.timeline))
      }
      const { timeline } = createTimelineExportManifest({
        projectId: project,
        timeline: state.timeline,
        aspectRatio: state.previewAspectRatio,
        generationNodes: useGenerationCanvasStore.getState().nodes,
      })
      const webm = await exportTimelineToWebm({
        timeline,
        aspectRatio: state.previewAspectRatio,
        width: 1920,
        autoDownload: false,
      })
      return { webmBytes: await webm.arrayBuffer() }
    }
    default:
      throw new Error(i18n.t('runtime.capability.unknownOperation', { operation: op }))
  }
}

let unregister: (() => void) | null = null

/** 在 app 启动时注册一次（NomiStudioApp）。重复注册先反注册旧的。preload 无 onApply（老版本）则 no-op。 */
export function registerCapabilityApplyHandler(): void {
  unregister?.()
  unregister = null
  const onApply = getDesktopBridge()?.capability?.onApply
  if (typeof onApply === 'function') {
    unregister = onApply(handleCapabilityApply)
  }
}
