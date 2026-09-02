// 能力核 · 方法路由（单一真相源）。
// RPC 传输（rpcServer）与 headless host（host）共用这一份 method→core 映射，杜绝两份路由漂移（P1）。
import crypto from 'node:crypto'
import {
  addProjectNodes,
  connectProjectNodes,
  createNamedProject,
  deleteProjectNodes,
  importProjectAsset,
  listAllProjects,
  listAvailableModels,
  setProjectNodePrompt,
  type FetchTaskResultFn,
  type MakeVerifyDeps,
  type RunTaskFn,
} from './core'
import { canvasWriteSemanticInputSchema } from '../shared/agentCapabilities/canvasWrite'
import { canvasDeleteSemanticInputSchema } from '../shared/agentCapabilities/canvasDelete'
import { documentWriteSemanticInputSchema } from '../shared/agentCapabilities/documentWrite'
import { readProjectDocument, writeProjectDocument } from './documentSurface'
import { CanvasGraphError, type CanvasSnapshot } from './canvasGraph'
import { listSkillSummariesForMcp, readSkillContentForMcp, type SkillMcpAccess } from '../skills/skillStore'
import type { ProductionRunService } from '../productionRun/productionRunService'
import type { ProductionBrief } from '../productionRun/productionRunTypes'
import { isAnchorCheckpointGate } from '../productionRun/anchorCheckpoint'
import { withPreApprovedPlan, type ProjectGateway } from './gateway'
import { INTAKE_MAX_QUESTIONS, buildIntakeMessage, buildIntakeQuestions } from './mcpBriefIntake'
import type { CapabilityOriginHost } from './security'
import { createMcpGenerationPolicy, type McpGenerationPolicy } from './mcpGenerationPolicy'
import { dispatchSemanticGeneration, guardLegacyGenerationRoute, isSemanticGenerationRoute } from './generationDispatcher'
import { RpcError, type RpcPublicErrorCode } from './rpcError'
export { RpcError } from './rpcError'
export type { RpcPolicyErrorCode, RpcPolicyErrorDetails } from './rpcError'
import type { ProjectLeaseV2 } from './projectLease'
import type { ApprovalReceiptAuthority, HumanApprovalReceiptV1 } from './approvalReceipt'
import type { McpConnectionContext } from './mcpConnectionContext'
import type { ProjectSessionAuthority } from './projectSessionAuthority'
import {
  getIntegrationSessionService,
  type IntegrationSessionService,
} from '../integrationCertification/integrationSession'
import { manageModelCatalogConnection } from '../catalog/catalogStore'

export function projectIdOf(params: Record<string, unknown>): string {
  return typeof params.projectId === 'string' ? params.projectId : ''
}

/**
 * makeGateway：按 projectId 解析该用哪个网关——A 模式（app 开着且该项目正打开）→ 渲染层网关（实时）；
 * 否则 → 磁盘网关（直写盘）。rpcServer 据 isProjectOpen + 渲染层可达性提供；headless host 恒磁盘网关。
 */
export type DispatchContext = {
  runTask: RunTaskFn
  fetchTaskResult?: FetchTaskResultFn
  makeGateway: (projectId: string) => ProjectGateway
  productionRuns: Pick<ProductionRunService, 'createDraft' | 'readProjection' | 'readEvents' | 'readArtifactProjection' | 'readFull' | 'command'> & Partial<{
    /** Task 4 versioned artifact MCP seam. Optional keeps low-level test doubles/source-compatible. */
    readArtifactContent: (projectId: string, runId: string, artifactId: string) => unknown
    requestArtifactRevision: (input: { projectId: string; runId: string; artifactId: string; expectedVersion: number; instruction: string; kind: 'script' | 'storyboard' }) => unknown
    reviewArtifact: (input: { projectId: string; runId: string; artifactId: string; expectedVersion: number; decision: 'approved' | 'changes_requested' | 'rejected' }) => unknown
    materializeStoryboard: (input: { projectId: string; runId: string; artifactId: string; expectedVersion: number }) => unknown
  }>
  /** Transport-owned authority. Request bodies may provide only an audit label, never trust. */
  origin?: { host: CapabilityOriginHost; actorId?: string }
  /** The frozen server-side generation policy. Omit in legacy callers to build the default snapshot. */
  generationPolicy?: McpGenerationPolicy
  /** One cohesive, transport-owned project-session authority for every leased MCP capability. */
  projectSession?: Readonly<{
    authority: ProjectSessionAuthority
    connection: McpConnectionContext
  }>
  /** Optional read-only context seam. No semantic route may fall through to a legacy service. */
  generationContext?: (params: Record<string, unknown>) => unknown | Promise<unknown>
  /** Shared semantic planning/editing seam. MCP and GUI must provide the same handler; no provider call here. */
  generationPlanning?: (input: { capability: string; params: Record<string, unknown>; lease?: ProjectLeaseV2; origin?: { host: CapabilityOriginHost; actorId?: string } }) => unknown | Promise<unknown>
  /** Main-process approval-receipt authority. Gate routes verify receipts here; the Run owner consumes them. */
  approvalReceiptAuthority?: ApprovalReceiptAuthority
  /** Run-owned challenge projection. It must recompute model/cost/contract from main-process state. */
  requestGenerationGate?: (input: { params: Record<string, unknown>; lease: ProjectLeaseV2 }) => unknown | Promise<unknown>
  /** Main-process GUI fallback for the exact challenge; it may return the receipt minted from the gesture. */
  confirmGenerationInNomi?: (input: { challengeToken: string }) => Promise<unknown>
  /**
   * Run-owned generation authorization seam. It receives already verified
   * lease/receipt bindings; the dispatcher never persists a second gate or
   * mints a spend grant itself.
   */
  authorizeGeneration?: (input: {
    params: Record<string, unknown>
    lease: ProjectLeaseV2
    receipt: HumanApprovalReceiptV1
  }) => unknown | Promise<unknown>
  /** Project-owner revision lookup. Receipt bindings never trust a revision supplied by the caller. */
  projectRevisionResolver?: (projectId: string) => number | undefined
  /**
   * 方案已由协议层 elicitation-first 拿到真人 accept（画布确认，见 mcpProtocol.ts）→ canvas.addNodes 预批准
   * 方案门、不再弹渲染层卡（免双问）。只作用于 addNodes 的 confirmPlan，钱路（confirmSpend）不受影响。
   */
  planConfirmed?: boolean
  /**
   * 审片环 deps 工厂（W1，可选）。传输层注入真实现（headless=makeShotVerifyDeps；GUI-RPC 同一份）→
   * generate 生成成功后跑判分→定向重试→红标。**不注入 = generate 行为逐字节不变**（默认）。
   * 领域策略住 shotVerifyOrchestrate，传输层只注入 deps，core 只透传 outcome（三层干净，方案 §3/§9）。
   */
  makeVerifyDeps?: MakeVerifyDeps
  /** Conversational model-integration session authority. External MCP clients drive begin→…→start here. */
  integrationSessions?: IntegrationSessionService
}

const PROJECT_SESSION_RETRY = 'Open a new project session and retry'

function mcpSkillAccess(origin: DispatchContext['origin']): SkillMcpAccess {
  // `origin.host` is populated only after the MCP client proof has been
  // verified by the transport.  Treat every other caller as public; never
  // trust an audience field supplied in tool params.
  return origin?.host === 'claude' || origin?.host === 'codex' || origin?.host === 'cursor'
    ? 'local-authenticated'
    : 'public'
}

function errorCodeOf(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '') || undefined
    : undefined
}

function leaseFailureCode(error: unknown): Extract<
  RpcPublicErrorCode,
  'lease_invalid' | 'project_scope_changed' | 'project_binding_stale' | 'lease_expired' | 'lease_revoked'
> {
  const code = errorCodeOf(error)
  const message = error instanceof Error ? error.message : ''
  if (code === 'project_binding_stale') return code
  if (code === 'project_scope_changed'
    && (/does not match (?:the )?current scope|scope is insufficient/i.test(message))) return code
  if (code === 'lease_expired' || code === 'lease_revoked') return code
  return 'lease_invalid'
}

function leasePublicError(error: unknown): RpcError {
  const code = leaseFailureCode(error)
  const message = code === 'lease_expired'
    ? 'Project session lease has expired'
    : code === 'lease_revoked'
      ? 'Project session lease has been revoked'
      : code === 'project_scope_changed'
        ? 'Project session lease does not authorize this project or capability'
        : code === 'project_binding_stale'
          ? 'Project binding is stale'
        : 'Project session lease is invalid'
  return new RpcError(message, 403, {
    code,
    nextAction: PROJECT_SESSION_RETRY,
    capability: 'project.session',
  })
}

function projectSessionOpenPublicError(error: unknown): RpcError {
  const code = errorCodeOf(error)
  if (code === 'lease_expired' || code === 'lease_revoked' || code === 'project_scope_changed'
    || code === 'project_binding_stale') {
    return leasePublicError(error)
  }
  if (code === 'lease_required') {
    return new RpcError('Project session request is invalid', 400, {
      code: 'lease_required',
      nextAction: 'Choose a project and open a new project session',
      capability: 'project.session',
    })
  }
  if (code === 'project_selection_denied') {
    return new RpcError('Project selection is not authorized', 403, {
      code,
      nextAction: 'Choose an authorized project in Nomi',
      capability: 'project.session',
    })
  }
  if (code === 'project_identity_unavailable') {
    return new RpcError('Project identity is unavailable', 503, {
      code,
      nextAction: 'Retry after the project identity is available',
      capability: 'project.session',
    })
  }
  return new RpcError('Project session is unavailable', 500, {
    code: 'project_session_unavailable',
    nextAction: 'Retry opening the project session',
    capability: 'project.session',
  })
}

async function leasedProject(
  ctx: DispatchContext,
  params: Record<string, unknown>,
  scope: string,
): Promise<ProjectLeaseV2> {
  const session = ctx.projectSession
  const leaseHandle = typeof params.leaseHandle === 'string' ? params.leaseHandle.trim() : ''
  if (!session || !leaseHandle) {
    throw new RpcError('A verified project-session lease is required', 403, {
      code: 'lease_required', nextAction: PROJECT_SESSION_RETRY, capability: 'project.session',
    })
  }
  try {
    return await session.authority.verifyLease(leaseHandle, {
      connection: session.connection,
      ...(typeof params.projectId === 'string' && params.projectId.trim() ? { projectHint: params.projectId.trim() } : {}),
      scope,
    })
  } catch (error) {
    throw leasePublicError(error)
  }
}

function proposalId(): string { return `proposal-${crypto.randomUUID()}` }

function canvasRecovery(deviationCount = 0) {
  return { ok: deviationCount === 0, deviationCount }
}

const canvasDeleteUndoJournal = new Map<string, Readonly<{ projectId: string; snapshot: CanvasSnapshot; deletedNodeIds: readonly string[] }>>()

const PRODUCTION_START_FIELDS = new Set([
  'projectId', 'playbook', 'playbookVersion', 'host', 'actorId', 'brief', 'trustLevel',
])

function requiredIdentifier(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === '.' || normalized === '..') throw new RpcError(`Invalid ${label} id`, 400)
  return normalized
}

function assertOnlyFields(params: Record<string, unknown>, allowed: Set<string>): void {
  const unexpected = Object.keys(params).find((key) => !allowed.has(key))
  if (unexpected) throw new RpcError(`Production field is not allowed: ${unexpected}`, 400)
}

function optionalText(value: unknown, label: string, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > max) throw new RpcError(`Invalid ${label}`, 400)
  return normalized
}

function stringList(value: unknown, label: string, maxItems = 20): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxItems) throw new RpcError(`Invalid ${label}`, 400)
  return value.map((item, index) => optionalText(item, `${label}[${index}]`) as string)
}

function artifactVersion(value: unknown): number {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) throw new RpcError('Invalid artifact version', 400)
  return version
}

function revisionInstruction(value: unknown): string {
  const instruction = typeof value === 'string' ? value.trim() : ''
  if (!instruction || instruction.length > 4_000) throw new RpcError('Invalid revision instruction', 400)
  return instruction
}

function artifactReadService(ctx: DispatchContext) {
  if (typeof ctx.productionRuns.readArtifactContent !== 'function') throw new RpcError('Versioned artifact reads are unavailable', 501)
  return ctx.productionRuns.readArtifactContent
}

function artifactRevisionService(ctx: DispatchContext) {
  if (typeof ctx.productionRuns.requestArtifactRevision !== 'function') throw new RpcError('Artifact revisions are unavailable', 501)
  return ctx.productionRuns.requestArtifactRevision
}

function artifactReviewService(ctx: DispatchContext) {
  if (typeof ctx.productionRuns.reviewArtifact !== 'function') throw new RpcError('Artifact review is unavailable', 501)
  return ctx.productionRuns.reviewArtifact
}

function storyboardMaterializeService(ctx: DispatchContext) {
  if (typeof ctx.productionRuns.materializeStoryboard !== 'function') throw new RpcError('Storyboard materialization is unavailable', 501)
  return ctx.productionRuns.materializeStoryboard
}

function productionBrief(value: unknown): ProductionBrief {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RpcError('Invalid production brief', 400)
  const raw = value as Record<string, unknown>
  const allowed = new Set(['goal', 'audience', 'channel', 'tone', 'durationSeconds', 'sellingPoints', 'referenceArtifactIds'])
  const unexpected = Object.keys(raw).find((key) => !allowed.has(key))
  if (unexpected) throw new RpcError(`Production brief field is not allowed: ${unexpected}`, 400)
  const goal = optionalText(raw.goal, 'brief goal', 2_000)
  if (!goal) throw new RpcError('Production brief goal is required', 400)
  const duration = raw.durationSeconds === undefined ? undefined : Number(raw.durationSeconds)
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 1 || duration > 3_600)) {
    throw new RpcError('Invalid brief durationSeconds', 400)
  }
  return {
    goal,
    ...(optionalText(raw.audience, 'brief audience') ? { audience: optionalText(raw.audience, 'brief audience') } : {}),
    ...(optionalText(raw.channel, 'brief channel') ? { channel: optionalText(raw.channel, 'brief channel') } : {}),
    ...(optionalText(raw.tone, 'brief tone') ? { tone: optionalText(raw.tone, 'brief tone') } : {}),
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    ...(raw.sellingPoints !== undefined ? { sellingPoints: stringList(raw.sellingPoints, 'brief sellingPoints') } : {}),
    ...(raw.referenceArtifactIds !== undefined
      ? { referenceArtifactIds: stringList(raw.referenceArtifactIds, 'brief referenceArtifactIds') }
      : {}),
  }
}

function productionStartInput(params: Record<string, unknown>, authority: DispatchContext['origin']) {
  const forbidden = Object.keys(params).find((key) => !PRODUCTION_START_FIELDS.has(key))
  if (forbidden) throw new RpcError(`Production start field is not allowed: ${forbidden}`, 400)
  const actorId = authority?.actorId ?? optionalText(params.actorId, 'origin actor', 160)
  // B3：可选信任档位随草稿一起声明（不传 = 服务侧默认 key_confirm）。非法值早拒，不静默兜底。
  let trustLevel: string | undefined
  if (params.trustLevel !== undefined) {
    trustLevel = String(params.trustLevel)
    if (!['key_confirm', 'budget_only', 'confirm_all'].includes(trustLevel)) throw new RpcError('Invalid trust level', 400)
  }
  return {
    projectId: requiredIdentifier(params.projectId, 'project'),
    playbook: {
      name: requiredIdentifier(params.playbook, 'playbook'),
      version: optionalText(params.playbookVersion, 'playbook version', 120) ?? '1.0.0',
    },
    origin: {
      host: authority?.host ?? 'external',
      ...(actorId ? { actorId } : {}),
    },
    brief: productionBrief(params.brief),
    ...(trustLevel ? { policy: { trustLevel: trustLevel as import('../productionRun/productionRunTypes').TrustLevel } } : {}),
  }
}

export async function dispatch(method: string, params: Record<string, unknown>, ctx: DispatchContext): Promise<unknown> {
  if (method === 'nomi_session_open') {
    if (!ctx.projectSession) throw projectSessionOpenPublicError(undefined)
    try {
      return await ctx.projectSession.authority.open(params, ctx.projectSession.connection)
    } catch (error) {
      throw projectSessionOpenPublicError(error)
    }
  }
  const generationPolicy = ctx.generationPolicy ?? createMcpGenerationPolicy()
  const classifiedRoute = generationPolicy.classifyRoute(method)
  const legacyRoute = classifiedRoute.kind === 'legacy'
    ? classifiedRoute.route
    : method.startsWith('production.')
      ? method
      : null
  // production.decide-gate 是**免费可逆质量门表态**（方向/样片/冻结/锚定妆照检查点），不是单次付费生成。
  // 它经 assertOnlyFields 只收 {projectId,runId,gateId,decision,choiceKey}——结构上就带不了任何真实生成绑定
  //（leaseHandle/receiptId/contractHash…全被拒），其授权边界是本 case 自己的 scope 校验（只放行可逆门、
  // 付费门仍 403 回 Nomi）。generationBindingGuard 把通用字段 `gateId` 也列作 marker（防生成路夹带），于是
  // 这条只带 gateId 的门表态被 legacy 防火墙误伤（legacy_path_forbidden）。故此路显式豁免：marker 集不动
  //（生成路仍拦），仅把「决门」这条正当可逆路径放行到它自己的 case 守卫。
  if (legacyRoute && legacyRoute !== 'production.decide-gate') guardLegacyGenerationRoute(generationPolicy, legacyRoute, params)
  if (isSemanticGenerationRoute(method)) return dispatchSemanticGeneration(method, params, ctx)

  switch (method) {
    case 'ping':
      return { ok: true }
    case 'project.list':
      return { projects: listAllProjects() }
    case 'project.create': {
      const created = createNamedProject(typeof params.name === 'string' ? params.name : undefined)
      if (!ctx.projectSession) return created
      const selection = await ctx.projectSession.authority.issueProjectSelection(
        'created_project',
        created.id,
        ctx.projectSession.connection,
      )
      return { ...created, projectSelectionHandle: selection.token }
    }
    case 'models.list':
      return { models: listAvailableModels() }
    case 'skills.list':
      // 导演/编剧技能库元数据（渐进披露，不含正文）。供 MCP 脊柱 resources/prompts 列表。
      return { skills: listSkillSummariesForMcp(mcpSkillAccess(ctx.origin)) }
    case 'skills.read': {
      // 按 name/directoryName 读一个技能正文。找不到 ⇒ null（协议层转 error）。
      const packageVersion = typeof params.packageVersion === 'string' ? params.packageVersion : ''
      const contentHash = typeof params.contentHash === 'string' ? params.contentHash : ''
      return readSkillContentForMcp(
        String(params.name || params.directoryName || ''),
        mcpSkillAccess(ctx.origin),
        undefined,
        packageVersion && contentHash ? { packageVersion, contentHash } : undefined,
      )
    }
    case 'production.start':
      return ctx.productionRuns.createDraft(productionStartInput(params, ctx.origin))
    case 'production.get':
      assertOnlyFields(params, new Set(['projectId', 'runId']))
      return ctx.productionRuns.readProjection(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
      )
    case 'production.events': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'afterCursor', 'waitMs']))
      const afterCursor = params.afterCursor === undefined ? 0 : Number(params.afterCursor)
      const waitMs = params.waitMs === undefined ? 0 : Number(params.waitMs)
      if (!Number.isInteger(afterCursor) || afterCursor < 0) throw new RpcError('Invalid production event cursor', 400)
      if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 25_000) throw new RpcError('Invalid production event waitMs', 400)
      return ctx.productionRuns.readEvents(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
        afterCursor,
        Math.floor(waitMs),
      )
    }
    case 'production.artifact':
      assertOnlyFields(params, new Set(['projectId', 'runId', 'artifactId']))
      return ctx.productionRuns.readArtifactProjection(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
        requiredIdentifier(params.artifactId, 'artifact'),
      )
    case 'production.artifact.read': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'artifactId']))
      return artifactReadService(ctx)(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
        requiredIdentifier(params.artifactId, 'artifact'),
      )
    }
    case 'production.artifact.revise': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'artifactId', 'expectedVersion', 'instruction', 'kind']))
      const kind = params.kind === 'script' || params.kind === 'storyboard' ? params.kind : ''
      if (!kind) throw new RpcError('Artifact revision kind must be script or storyboard', 400)
      return artifactRevisionService(ctx)({
        projectId: requiredIdentifier(params.projectId, 'project'),
        runId: requiredIdentifier(params.runId, 'run'),
        artifactId: requiredIdentifier(params.artifactId, 'artifact'),
        expectedVersion: artifactVersion(params.expectedVersion),
        instruction: revisionInstruction(params.instruction),
        kind,
      })
    }
    case 'production.artifact.review': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'artifactId', 'expectedVersion', 'decision']))
      const decision = params.decision === 'approved' || params.decision === 'changes_requested' || params.decision === 'rejected'
        ? params.decision
        : ''
      if (!decision) throw new RpcError('Invalid artifact review decision', 400)
      return artifactReviewService(ctx)({
        projectId: requiredIdentifier(params.projectId, 'project'),
        runId: requiredIdentifier(params.runId, 'run'),
        artifactId: requiredIdentifier(params.artifactId, 'artifact'),
        expectedVersion: artifactVersion(params.expectedVersion),
        decision,
      })
    }
    case 'production.storyboard.materialize': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'artifactId', 'expectedVersion']))
      return storyboardMaterializeService(ctx)({
        projectId: requiredIdentifier(params.projectId, 'project'),
        runId: requiredIdentifier(params.runId, 'run'),
        artifactId: requiredIdentifier(params.artifactId, 'artifact'),
        expectedVersion: artifactVersion(params.expectedVersion),
      })
    }
    case 'production.control': {
      // A4：pause/resume/cancel。B3：set_trust（配 trustLevel）改信任档位。
      // commandId 按 (action[/trustLevel], revision) 确定 → 同一状态下重复触发天然幂等。
      assertOnlyFields(params, new Set(['projectId', 'runId', 'action', 'trustLevel']))
      const action = String(params.action || '')
      if (!['pause', 'resume', 'cancel', 'set_trust'].includes(action)) throw new RpcError('Invalid production control action', 400)
      const projectId = requiredIdentifier(params.projectId, 'project')
      const runId = requiredIdentifier(params.runId, 'run')
      const full = ctx.productionRuns.readFull(projectId, runId)
      if (!full) throw new RpcError(`Production run not found: ${runId}`, 404)
      if (action === 'set_trust') {
        const trustLevel = String(params.trustLevel || '')
        if (!['key_confirm', 'budget_only', 'confirm_all'].includes(trustLevel)) throw new RpcError('Invalid trust level', 400)
        if (trustLevel !== 'confirm_all' && full.gates.some((gate) => gate.status === 'waiting'
          && gate.scope === 'job_set' && gate.gateId.startsWith('gate-shot-'))) {
          throw new RpcError('Decide the waiting shot in Nomi before changing its trust level', 403)
        }
        await ctx.productionRuns.command(projectId, runId, {
          commandId: `mcp-control-set_trust-${trustLevel}-${full.revision}`,
          expectedRevision: full.revision,
          type: 'run.control',
          payload: { action, trustLevel },
          issuedAt: new Date().toISOString(),
        })
        return ctx.productionRuns.readProjection(projectId, runId)
      }
      await ctx.productionRuns.command(projectId, runId, {
        commandId: `mcp-control-${action}-${full.revision}`,
        expectedRevision: full.revision,
        type: 'run.control',
        payload: { action },
        issuedAt: new Date().toISOString(),
      })
      return ctx.productionRuns.readProjection(projectId, runId)
    }
    case 'production.decide-gate': {
      // B1：agent 已用 elicitation 问过真人，拿到 accept 才调这里表态一道门（方向门可带 choiceKey）。
      assertOnlyFields(params, new Set(['projectId', 'runId', 'gateId', 'decision', 'choiceKey']))
      const decision = String(params.decision || '')
      if (decision !== 'approved' && decision !== 'rejected') throw new RpcError('Invalid production gate decision', 400)
      const projectId = requiredIdentifier(params.projectId, 'project')
      const runId = requiredIdentifier(params.runId, 'run')
      const gateId = requiredIdentifier(params.gateId, 'gate')
      const rawChoice = typeof params.choiceKey === 'string' ? params.choiceKey.trim() : ''
      const choiceKey = /^[A-Za-z0-9._-]{1,40}$/.test(rawChoice) ? rawChoice : undefined
      const full = ctx.productionRuns.readFull(projectId, runId)
      if (!full) throw new RpcError(`Production run not found: ${runId}`, 404)
      const gate = full.gates.find((item) => item.gateId === gateId)
      if (!gate) throw new RpcError(`Production gate not found: ${gateId}`, 404)
      const creativeGate = gate.scope === 'stage'
        && (gate.gateId.startsWith('gate-direction-') || gate.gateId.startsWith('gate-sample-') || gate.gateId.startsWith('gate-freeze-'))
      // P4 §3.2：锚定妆照检查点也是免费质量门（不授权任何预算，见 anchorCheckpoint.ts）→ 与创意门同权
      // 可经真人 elicitation 确认后在此表态；决议落库后 service 钩子重踢批次。预算/导出/逐镜付费门仍必须回 Nomi。
      if (!creativeGate && !isAnchorCheckpointGate(gate)) throw new RpcError('This production gate must be decided in Nomi', 403)
      await ctx.productionRuns.command(projectId, runId, {
        commandId: `mcp-decide-${gateId}-${decision}-${full.revision}`,
        expectedRevision: full.revision,
        type: 'gate.decide',
        payload: { gateId, status: decision, ...(choiceKey ? { choiceKey } : {}) },
        issuedAt: new Date().toISOString(),
      })
      return ctx.productionRuns.readProjection(projectId, runId)
    }
    case 'canvas.write': {
      const lease = await leasedProject(ctx, params, 'canvas:write')
      const raw = { ...params }
      delete raw.leaseHandle
      delete raw.projectId
      const input = canvasWriteSemanticInputSchema.parse(raw)
      const base = ctx.makeGateway(lease.projectId)
      if (input.operation === 'set_node_prompt') {
        const result = await setProjectNodePrompt(base, input.nodeId, input.prompt)
        if (!result.changed) throw new CanvasGraphError('node_not_found', `Canvas node not found: ${input.nodeId}`)
        return { applied: true, proposalId: proposalId(), operation: input.operation, affectedNodeIds: [input.nodeId], reconciliation: canvasRecovery() }
      }
      if (input.operation === 'create_canvas_nodes') {
        const created = await addProjectNodes(
          ctx.planConfirmed ? withPreApprovedPlan(base) : base,
          input.nodes.map((node) => ({
            kind: node.kind, title: node.title, prompt: node.prompt,
            ...(node.position ? { x: node.position.x, y: node.position.y } : {}),
            ...(node.vendor || node.modelVendor ? { vendor: node.vendor || node.modelVendor } : {}),
            ...(node.modelKey ? { modelKey: node.modelKey } : {}),
          })),
          lease.projectId,
        )
        if (created.cancelled) return { applied: false, proposalId: proposalId(), operation: input.operation, cancelled: true, affectedNodeIds: [], affectedEdgeIds: [], clientIdToNodeId: {}, connectedCount: 0, skippedEdges: [], reconciliation: canvasRecovery() }
        const clientIdToNodeId = Object.fromEntries(input.nodes.map((node, index) => [node.clientId, created.ids[index]]))
        const edges = (input.edges ?? []).map((edge) => ({
          source: clientIdToNodeId[edge.sourceClientId] ?? edge.sourceClientId,
          target: clientIdToNodeId[edge.targetClientId] ?? edge.targetClientId,
          ...(edge.mode ? { mode: edge.mode } : {}),
        }))
        const connected = edges.length
          ? await connectProjectNodes(ctx.makeGateway(lease.projectId), edges)
          : { edgeIds: [], skipped: [] }
        const skippedEdges = connected.skipped.map((item) => ({ source: item.connection.source, target: item.connection.target, reason: item.reason }))
        return { applied: true, proposalId: proposalId(), operation: input.operation, affectedNodeIds: created.ids, affectedEdgeIds: connected.edgeIds, clientIdToNodeId, connectedCount: connected.edgeIds.length, skippedEdges, reconciliation: canvasRecovery(skippedEdges.length) }
      }
      if (input.operation === 'connect_canvas_edges') {
        const connected = await connectProjectNodes(ctx.makeGateway(lease.projectId), input.edges.map((edge) => ({
          source: edge.sourceClientId, target: edge.targetClientId, ...(edge.mode ? { mode: edge.mode } : {}),
        })))
        const skippedEdges = connected.skipped.map((item) => ({ source: item.connection.source, target: item.connection.target, reason: item.reason }))
        return { applied: true, proposalId: proposalId(), operation: input.operation, affectedNodeIds: [], affectedEdgeIds: connected.edgeIds, connectedCount: connected.edgeIds.length, skippedEdges, reconciliation: canvasRecovery(skippedEdges.length) }
      }
      if (typeof ctx.generationPlanning !== 'function') throw new RpcError('Canvas planning is unavailable', 501, { code: 'capability_unsupported', nextAction: 'Open the Nomi creation surface and retry', capability: 'canvas.write' as never })
      const planned = await ctx.generationPlanning({ capability: input.operation, params: input as unknown as Record<string, unknown>, lease, origin: ctx.origin })
      return { applied: true, proposalId: proposalId(), operation: input.operation, result: planned, reconciliation: canvasRecovery() }
    }
    case 'canvas.delete': {
      const lease = await leasedProject(ctx, params, 'canvas:write')
      const gateway = ctx.makeGateway(lease.projectId)
      if (params.operation === 'undo_canvas_delete') {
        const undoToken = typeof params.undoToken === 'string' ? params.undoToken.trim() : ''
        const entry = canvasDeleteUndoJournal.get(undoToken)
        if (!entry || entry.projectId !== lease.projectId) {
          throw new RpcError('Canvas undo token is invalid or expired', 409, {
            code: 'capability_input_invalid',
            nextAction: 'Use the latest deletion receipt or refresh the Canvas and retry',
            capability: 'canvas.delete',
          })
        }
        const current = await gateway.readDoc()
        const currentIds = new Set(current.nodes.map((node) => node.id))
        const restoredNodes = entry.snapshot.nodes.filter((node) => entry.deletedNodeIds.includes(node.id) && !currentIds.has(node.id))
        const restoredIds = restoredNodes.map((node) => node.id)
        if (!restoredNodes.length) {
          throw new RpcError('Canvas deletion has already been undone or superseded', 409, {
            code: 'capability_input_invalid',
            nextAction: 'Refresh the Canvas and continue from its current state',
            capability: 'canvas.delete',
          })
        }
        const restoredIdSet = new Set([...currentIds, ...restoredIds])
        const currentEdgeIds = new Set(current.edges.map((edge) => edge.id))
        const restoredEdges = entry.snapshot.edges.filter((edge) =>
          !currentEdgeIds.has(edge.id) && restoredIdSet.has(edge.source) && restoredIdSet.has(edge.target))
        await gateway.apply({ ...current, nodes: [...current.nodes, ...restoredNodes], edges: [...current.edges, ...restoredEdges] })
        canvasDeleteUndoJournal.delete(undoToken)
        return {
          applied: true,
          proposalId: proposalId(),
          operation: 'undo_canvas_delete',
          restoredNodeIds: restoredIds,
          recoveryActions: ['undo_applied'],
          reconciliation: canvasRecovery(),
        }
      }
      if (params.operation !== 'delete_canvas_nodes' || params.confirmation !== true) {
        throw new RpcError('Human confirmation is required before deleting Canvas nodes', 403, { code: 'human_approval_required', nextAction: 'Confirm the destructive Canvas maintenance request and retry', capability: 'canvas.write' as never })
      }
      const input = canvasDeleteSemanticInputSchema.parse({ operation: 'delete_canvas_nodes', nodeIds: params.nodeIds, ...(typeof params.reason === 'string' ? { reason: params.reason } : {}) })
      const before = await gateway.readDoc()
      const deleted = await deleteProjectNodes(gateway, input.nodeIds)
      if (!deleted.deleted.length) throw new CanvasGraphError('node_not_found', 'One or more canvas nodes were not found')
      const undoToken = `undo-${crypto.randomUUID()}`
      canvasDeleteUndoJournal.set(undoToken, { projectId: lease.projectId, snapshot: before, deletedNodeIds: deleted.deleted })
      return {
        applied: true,
        proposalId: proposalId(),
        operation: input.operation,
        deletedNodeIds: deleted.deleted,
        undoToken,
        recoveryActions: ['Call nomi_canvas_maintenance with this undoToken before making another canvas edit.'],
        reconciliation: canvasRecovery(),
      }
    }
    case 'document.read': {
      const lease = await leasedProject(ctx, params, 'document:read')
      const scope = params.scope === 'selection' ? 'selection' : params.scope === 'full' ? 'full' : null
      if (!scope) throw new RpcError('Document scope is required', 400, { code: 'capability_input_invalid', nextAction: 'Retry with scope full or selection', capability: 'document.read' as never })
      return readProjectDocument(lease.projectId, typeof params.documentId === 'string' ? params.documentId : undefined, scope)
    }
    case 'document.write': {
      const lease = await leasedProject(ctx, params, 'document:write')
      const input = documentWriteSemanticInputSchema.parse({ operation: params.operation, content: params.content })
      return writeProjectDocument(lease.projectId, typeof params.documentId === 'string' ? params.documentId : undefined, input.operation, input.content)
    }
    case 'canvas.addNodes': {
      // 方案已被协议层 elicitation-first 批准 → 预批准方案门（不再弹渲染层卡，免双问）；否则原网关照常确认。
      const base = ctx.makeGateway(projectIdOf(params))
      const gateway = ctx.planConfirmed ? withPreApprovedPlan(base) : base
      return addProjectNodes(gateway, Array.isArray(params.nodes) ? (params.nodes as never[]) : [], projectIdOf(params))
    }
    case 'canvas.connect':
      return connectProjectNodes(ctx.makeGateway(projectIdOf(params)), Array.isArray(params.connections) ? (params.connections as never[]) : [])
    case 'canvas.setPrompt':
      return setProjectNodePrompt(
        ctx.makeGateway(projectIdOf(params)),
        String(params.nodeId || ''),
        String(params.prompt || ''),
        typeof params.title === 'string' ? params.title : undefined,
      )
    case 'canvas.deleteNodes':
      return deleteProjectNodes(ctx.makeGateway(projectIdOf(params)), Array.isArray(params.nodeIds) ? (params.nodeIds as string[]) : [])
    case 'brief.intake': {
      // W3 幕 0：只组题/给默认，**不落任何状态**——真正的「问」由协议层弹 elicitation（enum 候选），
      // 客户端不支持表单时协议层退化成把题面交给模型在对话里一次问全。
      assertOnlyFields(params, new Set(['projectId', 'kind']))
      const questions = buildIntakeQuestions({ kind: typeof params.kind === 'string' ? params.kind : '' })
      return { questions, message: buildIntakeMessage(questions), maxQuestions: INTAKE_MAX_QUESTIONS }
    }
    case 'asset.import':
      // M2：本机文件 → 项目素材 → nomi-local:// URL。安全判据在 importAssetGuard（纯函数，逐条单测）。
      assertOnlyFields(params, new Set(['projectId', 'path', 'title']))
      return importProjectAsset({
        projectId: requiredIdentifier(params.projectId, 'project'),
        path: String(params.path || ''),
        ...(typeof params.title === 'string' && params.title.trim() ? { title: params.title.trim() } : {}),
      })
    case 'integration.begin': {
      return (ctx.integrationSessions || getIntegrationSessionService()).begin(
        {
          kind: params.kind as 'http-api-provider' | 'comfyui-workflow',
          name: params.name as string,
          ...(typeof params.baseUrl === 'string' ? { baseUrl: params.baseUrl } : {}),
          ...(typeof params.docs === 'string' ? { docs: params.docs } : {}),
          ...(typeof params.providerKind === 'string' ? { providerKind: params.providerKind } : {}),
          ...(typeof params.authType === 'string' ? { authType: params.authType as import('../providerAdapter/types').AdapterAuthType } : {}),
          ...(typeof params.authHeader === 'string' ? { authHeader: params.authHeader } : {}),
          ...(typeof params.authQueryParam === 'string' ? { authQueryParam: params.authQueryParam } : {}),
          ...(typeof params.clientRequestId === 'string' ? { clientRequestId: params.clientRequestId } : {}),
        },
        ctx.origin?.host || 'external',
      )
    }
    case 'integration.open_credentials':
      return (ctx.integrationSessions || getIntegrationSessionService()).openCredentials(
        params.sessionId,
        params.expectedRevision,
        ctx.origin?.host || 'external',
      )
    case 'integration.propose':
      return (ctx.integrationSessions || getIntegrationSessionService()).propose(
        params.sessionId,
        params.expectedRevision,
        ctx.origin?.host || 'external',
        params.proposal,
      )
    case 'integration.request_confirmation':
      return (ctx.integrationSessions || getIntegrationSessionService()).requestConfirmation(
        params.sessionId,
        params.expectedRevision,
        ctx.origin?.host || 'external',
        params.idempotencyKey as string,
      )
    case 'integration.start':
      return (ctx.integrationSessions || getIntegrationSessionService()).start(
        params.sessionId,
        params.expectedRevision,
        ctx.origin?.host || 'external',
        params.idempotencyKey as string,
        params.receipt as string,
      )
    case 'integration.get':
      return (ctx.integrationSessions || getIntegrationSessionService()).get(
        params.sessionId,
        ctx.origin?.host || 'external',
      )
    case 'integration.cancel':
      return (ctx.integrationSessions || getIntegrationSessionService()).cancel(
        params.sessionId,
        params.expectedRevision,
        ctx.origin?.host || 'external',
      )
    case 'integration.manage.update_vendor':
    case 'integration.manage.delete_vendor':
    case 'integration.manage.delete_model':
    case 'integration.manage.set_proxy':
      if (ctx.origin?.host === 'external' || !ctx.origin?.host) throw new RpcError('Signed client identity is required', 403)
      return manageModelCatalogConnection(params)
    default:
      throw new RpcError(`未知方法: ${method}`, 404)
  }
}
