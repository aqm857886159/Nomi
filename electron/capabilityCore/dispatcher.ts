// 能力核 · 方法路由（单一真相源）。
// RPC 传输（rpcServer）与 headless host（host）共用这一份 method→core 映射，杜绝两份路由漂移（P1）。
import {
  addProjectNodes,
  connectProjectNodes,
  createNamedProject,
  deleteProjectNodes,
  generateOnProject,
  importProjectAsset,
  listAllProjects,
  listAvailableModels,
  readProjectCanvas,
  setProjectNodePrompt,
  type FetchTaskResultFn,
  type GenerateInput,
  type MakeVerifyDeps,
  type RunTaskFn,
} from './core'
import { listSkillSummaries, readSkillContent } from '../skills/skillStore'
import type { ProductionRunService } from '../productionRun/productionRunService'
import type { ProductionBrief } from '../productionRun/productionRunTypes'
import { withPreApprovedPlan, type ProjectGateway } from './gateway'
import { INTAKE_MAX_QUESTIONS, buildIntakeMessage, buildIntakeQuestions } from './mcpBriefIntake'
import type { CapabilityOriginHost } from './security'

export class RpcError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message)
  }
}

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
    proposeDirectionCandidates: (projectId: string, runId: string, candidates: unknown, source?: string) => unknown
    proposeScriptCandidate: (projectId: string, runId: string, content: unknown, source?: string) => unknown
    proposeStoryboardCandidate: (projectId: string, runId: string, plan: unknown, source?: string) => unknown
  }>
  /** Transport-owned authority. Request bodies may provide only an audit label, never trust. */
  origin?: { host: CapabilityOriginHost; actorId?: string }
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
}

const PRODUCTION_START_FIELDS = new Set([
  'projectId', 'playbook', 'playbookVersion', 'host', 'actorId', 'brief', 'trustLevel',
])

function requiredIdentifier(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === '.' || normalized === '..') throw new RpcError(`Invalid ${label} id`, 400)
  return normalized
}

function requiredJobIdentifier(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!/^job:[A-Za-z0-9._-]{1,160}:[A-Za-z0-9._:-]{1,240}$/.test(normalized)) throw new RpcError('Invalid job id', 400)
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
  switch (method) {
    case 'ping':
      return { ok: true }
    case 'project.list':
      return { projects: listAllProjects() }
    case 'project.create':
      return createNamedProject(typeof params.name === 'string' ? params.name : undefined)
    case 'models.list':
      return { models: listAvailableModels() }
    case 'skills.list':
      // 导演/编剧技能库元数据（渐进披露，不含正文）。供 MCP 脊柱 resources/prompts 列表。
      return { skills: listSkillSummaries() }
    case 'skills.read':
      // 按 name/directoryName 读一个技能正文。找不到 ⇒ null（协议层转 error）。
      return readSkillContent(String(params.name || params.directoryName || ''))
    case 'production.start':
      return ctx.productionRuns.createDraft(productionStartInput(params, ctx.origin))
    case 'production.propose-directions': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'candidates']))
      if (!Array.isArray(params.candidates) || params.candidates.length < 2 || params.candidates.length > 3) {
        throw new RpcError('Direction candidates must contain 2 or 3 items', 400)
      }
      if (!ctx.productionRuns.proposeDirectionCandidates) throw new RpcError('Direction proposal is unavailable', 501)
      return ctx.productionRuns.proposeDirectionCandidates(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
        params.candidates,
        ctx.origin?.host ?? 'external-agent',
      )
    }
    case 'production.propose-script': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'content']))
      if (typeof params.content !== 'string' || !params.content.trim()) throw new RpcError('Script content is required', 400)
      if (params.content.length > 100_000) throw new RpcError('Script content is too large', 400)
      if (!ctx.productionRuns.proposeScriptCandidate) throw new RpcError('Script proposal is unavailable', 501)
      return ctx.productionRuns.proposeScriptCandidate(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
        params.content,
        ctx.origin?.host ?? 'external-agent',
      )
    }
    case 'production.propose-storyboard': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'plan']))
      if (!params.plan || typeof params.plan !== 'object' || Array.isArray(params.plan)) throw new RpcError('Structured storyboard plan is required', 400)
      if (!ctx.productionRuns.proposeStoryboardCandidate) throw new RpcError('Storyboard proposal is unavailable', 501)
      return ctx.productionRuns.proposeStoryboardCandidate(
        requiredIdentifier(params.projectId, 'project'),
        requiredIdentifier(params.runId, 'run'),
        params.plan,
        ctx.origin?.host ?? 'external-agent',
      )
    }
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
      // A4：pause/resume/cancel。B3：set_trust（配 trustLevel）改信任档位；
      // concurrency 只改变尚未提交的下一波，不会撤回已经送到供应商的任务。
      // commandId 按 (action[/trustLevel], revision) 确定 → 同一状态下重复触发天然幂等。
      assertOnlyFields(params, new Set(['projectId', 'runId', 'action', 'trustLevel', 'maxConcurrentJobs']))
      const action = String(params.action || '')
      if (!['pause', 'resume', 'cancel', 'set_trust', 'set_concurrency'].includes(action)) throw new RpcError('Invalid production control action', 400)
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
      if (action === 'set_concurrency') {
        const raw = params.maxConcurrentJobs
        if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 6) throw new RpcError('Concurrency must be an integer from 1 to 6', 400)
        const maxConcurrentJobs = Math.floor(raw)
        await ctx.productionRuns.command(projectId, runId, {
          commandId: `mcp-control-set_concurrency-${maxConcurrentJobs}-${full.revision}`,
          expectedRevision: full.revision,
          type: 'run.control',
          payload: { action, maxConcurrentJobs },
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
    case 'production.reconcile-job': {
      assertOnlyFields(params, new Set(['projectId', 'runId', 'jobId', 'outcome']))
      const projectId = requiredIdentifier(params.projectId, 'project')
      const runId = requiredIdentifier(params.runId, 'run')
      const jobId = requiredJobIdentifier(params.jobId)
      const outcome = String(params.outcome || '')
      if (outcome !== 'found' && outcome !== 'not_found') throw new RpcError('Invalid reconciliation outcome', 400)
      const full = ctx.productionRuns.readFull(projectId, runId)
      if (!full) throw new RpcError(`Production run not found: ${runId}`, 404)
      await ctx.productionRuns.command(projectId, runId, {
        commandId: `mcp-reconcile-${jobId}-${outcome}-${full.revision}`,
        expectedRevision: full.revision,
        type: 'job.reconcile',
        payload: { jobId, outcome },
        issuedAt: new Date().toISOString(),
      })
      return ctx.productionRuns.readProjection(projectId, runId)
    }
    case 'production.decide-gate': {
      // B1：agent 已用 elicitation 问过真人，拿到 accept 才调这里表态一道门（方向门可带 choiceKey）。
      assertOnlyFields(params, new Set(['projectId', 'runId', 'gateId', 'decision', 'choiceKey', 'policy']))
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
      const externalGate = gate.scope === 'stage'
        ? gate.gateId.startsWith('gate-direction-') || gate.gateId.startsWith('gate-sample-') || gate.gateId.startsWith('gate-freeze-')
        : gate.scope === 'budget_envelope'
          || gate.scope === 'job_set' && gate.gateId.startsWith('gate-shot-')
          || gate.scope === 'export'
      if (!externalGate) throw new RpcError('This production gate requires an explicit Nomi takeover', 403)
      let current = full
      if (gate.scope === 'budget_envelope' && params.policy !== undefined) {
        const policy = params.policy as Record<string, unknown>
        const maxSpend = Number(policy.maxSpend)
        const allowedProviders = Array.isArray(policy.allowedProviders)
          ? policy.allowedProviders.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())
          : current.policy.allowedProviders
        const allowedModels = Array.isArray(policy.allowedModels)
          ? policy.allowedModels.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())
          : current.policy.allowedModels
        if (!Number.isFinite(maxSpend) || maxSpend < 0 || allowedProviders.length === 0 || allowedModels.length === 0) {
          throw new RpcError('合同门策略必须包含非负预算、至少一个供应商和至少一个模型', 400)
        }
        current = (await ctx.productionRuns.command(projectId, runId, {
          commandId: `mcp-policy-${gateId}-${full.revision}`,
          expectedRevision: full.revision,
          type: 'policy.set',
          payload: { policy: { ...current.policy, maxSpend, allowedProviders, allowedModels } },
          issuedAt: new Date().toISOString(),
        })).run
      }
      await ctx.productionRuns.command(projectId, runId, {
        commandId: `mcp-decide-${gateId}-${decision}-${current.revision}`,
        expectedRevision: current.revision,
        type: 'gate.decide',
        payload: { gateId, status: decision, ...(choiceKey ? { choiceKey } : {}) },
        issuedAt: new Date().toISOString(),
      })
      return ctx.productionRuns.readProjection(projectId, runId)
    }
    case 'production.approve-rough-cut': {
      // 粗剪是外部 Agent 正常路径上的最后一个可见确认点。它不是 gate.decide：
      // 先把状态推进到 awaiting_export，再在同一条受保护命令里批准 export gate，避免用户
      // 在 Agent 里对同一份已经看过的粗剪重复点两次。
      assertOnlyFields(params, new Set(['projectId', 'runId']))
      const projectId = requiredIdentifier(params.projectId, 'project')
      const runId = requiredIdentifier(params.runId, 'run')
      const full = ctx.productionRuns.readFull(projectId, runId)
      if (!full) throw new RpcError(`Production run not found: ${runId}`, 404)
      if (full.status !== 'awaiting_rough_cut_review') {
        throw new RpcError('粗剪当前不在待审状态；请先用 nomi_get_run 读取最新 Run 状态', 409)
      }
      await ctx.productionRuns.command(projectId, runId, {
        commandId: `mcp-rough-cut-approved-${full.revision}`,
        expectedRevision: full.revision,
        type: 'run.status',
        payload: { status: 'awaiting_export' },
        issuedAt: new Date().toISOString(),
      })
      const afterReview = ctx.productionRuns.readFull(projectId, runId)
      const exportGate = afterReview?.gates.find((candidate) => candidate.scope === 'export' && candidate.status === 'waiting')
      if (!afterReview || !exportGate) throw new RpcError('粗剪已确认，但当前 Run 没有可批准的导出门', 409)
      await ctx.productionRuns.command(projectId, runId, {
        commandId: `mcp-export-after-rough-cut-${exportGate.gateId}-${afterReview.revision}`,
        expectedRevision: afterReview.revision,
        type: 'gate.decide',
        payload: { gateId: exportGate.gateId, status: 'approved' },
        issuedAt: new Date().toISOString(),
      })
      return ctx.productionRuns.readProjection(projectId, runId)
    }
    case 'canvas.read':
      return readProjectCanvas(ctx.makeGateway(projectIdOf(params)))
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
    case 'generate':
      // makeVerifyDeps 是**传输层注入**（不是模型能填的入参）→ 从 ctx 取、覆盖任何请求体里的同名字段
      // （防外部 agent 伪造），与 makeGateway/planConfirmed 同注入模式。不注入 = 审片环不跑（默认行为不变）。
      return generateOnProject(
        { ...(params as unknown as GenerateInput), makeVerifyDeps: ctx.makeVerifyDeps },
        ctx.makeGateway(projectIdOf(params)),
        ctx.runTask,
        ctx.fetchTaskResult,
      )
    default:
      throw new RpcError(`未知方法: ${method}`, 404)
  }
}
