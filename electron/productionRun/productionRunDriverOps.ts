// B0 前置抽层（plan 2026-08-11-mcp-conversation-native-phase-b）：driver 编排从 productionRunService
// 抽出成独立层（service 顶 800 行，后续工单要腾地方 —— R9 ≤800）。参照 productionRunControl.ts /
// productionRunEventTap.ts 的抽法：所有仓库读写、renderer 桥、路径工具经参数注入，保持行为零变化 +
// 可裸 node 单测。这四条 driver（拟分镜 / 生成 / 导出 / 对账）是「后端已有编排」，不是新功能。
//
// 为什么用 factory：driveReconciliation 成功后要重踢 driveGeneration（同层互相引用），且四条都闭包
// 复用同一组注入依赖（requireRun / executeInternal / requestRenderer / 路径工具 / in-flight 去重集）。
import crypto from 'node:crypto'

import { desktopT } from '../i18n'
import { settlePauseIfQuiet } from './productionRunControl'
import { adoptedGenerationShotNodeIds, buildQaRetryPlans, buildQaStageOutcome, type QaVerifyResponse } from './productionQaVerdict'
import type { ProductionRunRepository } from './productionRunRepository'
import { freezeGateId, hasApprovedFreezeGate, hasWaitingFreezeGate, hasWaitingSampleGate, isShotGate, sampleGateId, shotGateId, shouldSampleGate } from './productionRunGateIdentity'
import { trustLevelOf, type ProductionRun } from './productionRunTypes'
import { loadPlaybookStageEvidence } from '../skills/skillExecutionEvidence'
import { logError } from '../logging/logger'

/** Job ids intentionally contain a namespace separator (`job:run:node`), but artifact ids are
 * public deep-link identifiers. Keep the mapping stable, collision-resistant, and URL-safe. */
export function artifactIdentifierForJob(jobId: string): string {
  const base = jobId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'job'
  const suffix = crypto.createHash('sha256').update(jobId).digest('hex').slice(0, 10)
  return `artifact-job-${base}-${suffix}`
}

export type DriverOpsDeps = {
  repository: Pick<ProductionRunRepository, 'execute' | 'read'>
  sleep: (delayMs: number) => Promise<void>
  requireRun: (projectId: string, runId: string) => ProductionRun
  executeInternal: (
    projectId: string,
    runId: string,
    current: ProductionRun,
    type: string,
    payload: Record<string, unknown>,
    commandId: string,
  ) => { run: ProductionRun; events: unknown[] }
  requestRenderer: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>
  executeProductionExport: (input: { projectId: string; runId: string; outputName: string }) => Promise<{ relativePath: string; size: number; jobId?: string }>
  writeProjectJson: (projectId: string, relativePath: string, value: unknown) => void
  localAssetPath: (projectId: string, rawUrl: unknown) => string | undefined
  projectRelativePath: (projectId: string, rawPath: unknown, options?: { requireFile?: boolean }) => string
  stageValue: (run: ProductionRun, stageId: string, patch: Record<string, unknown>) => Record<string, unknown>
  // 宽松读取形状：默认走 runtime.TaskResult（status 是字面量联合、thumbnailUrl 可空），注入版走
  // ServiceDeps 的窄形状——两者都只被结构性读取（localAssetPath 忽略非字符串、status 会小写化），
  // 这里取二者的公共上界（string / string | null），避免抽层时凭空收紧契约（P1 不造并行类型）。
  reconcileProviderTask: (job: ProductionRun['jobs'][number]) => Promise<{
    status?: string
    assets?: Array<{ type?: string; url?: string; thumbnailUrl?: string | null }>
    error?: string
  }>
  /** 去重集：driver 单飞（一个 run 同时只跑一条编排）；由 service 持有并传入以跨调用共享。 */
  inFlight: Set<string>
  reconciliationInFlight: Set<string>
  /** B1：方向拟案单飞集（与 inFlight 分开——方向阶段与生成/分镜阶段互斥不重叠，独立锁更清晰）。 */
  directionsInFlight: Set<string>
}

function planValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Storyboard planner returned no plan')
  const record = value as Record<string, unknown>
  const plan = record.plan
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Storyboard planner returned no structured plan')
  return plan as Record<string, unknown>
}

/** B1：把 renderer 拟的方向候选清洗成 2-3 个安全条目（key 唯一/安全、title+oneLiner 非空截断）；
 * 不足 2 个或全废 → 抛错，让 driver 保持现状 gate（title/summary 兜底），不硬塞空候选。 */
export function normalizeDirectionCandidates(value: unknown): Array<{ key: string; title: string; oneLiner: string }> {
  const list = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const out: Array<{ key: string; title: string; oneLiner: string }> = []
  for (let index = 0; index < list.length && out.length < 3; index += 1) {
    const item = list[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const rawKey = typeof raw.key === 'string' ? raw.key.trim() : ''
    const key = /^[A-Za-z0-9._-]{1,40}$/.test(rawKey) ? rawKey : `dir-${index + 1}`
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    const oneLiner = typeof raw.oneLiner === 'string' ? raw.oneLiner.trim() : ''
    if (!title || !oneLiner || seen.has(key)) continue
    seen.add(key)
    out.push({ key, title: title.slice(0, 80), oneLiner: oneLiner.slice(0, 200) })
  }
  if (out.length < 2) throw new Error('Direction planner returned fewer than two usable candidates')
  return out
}

async function readUnfrozenAnchors(
  requestRenderer: DriverOpsDeps['requestRenderer'],
  projectId: string,
  runId: string,
): Promise<Array<{ nodeId: string; title?: string }>> {
  try {
    const response = await requestRenderer('production.check-frozen', { projectId, runId }, 60_000) as
      | { unfrozenAnchors?: Array<{ nodeId?: unknown; title?: unknown }> }
      | null
    const raw = Array.isArray(response?.unfrozenAnchors) ? response.unfrozenAnchors : []
    return raw
      .map((item) => ({
        nodeId: typeof item?.nodeId === 'string' ? item.nodeId.trim() : '',
        ...(typeof item?.title === 'string' && item.title.trim() ? { title: item.title.trim() } : {}),
      }))
      .filter((item): item is { nodeId: string; title?: string } => item.nodeId.length > 0)
  } catch (error) {
    logError('production-run', 'freeze-check-failed-gate-skipped', error)
    return []
  }
}

/**
 * Semantic multi-shot runs are the only runs that may continue from the batch
 * scheduler into QA/assembly.  The legacy playbook writer never creates a
 * generation plan with `shots[]`; keeping this predicate explicit prevents a
 * future legacy job from accidentally entering the semantic continuation.
 */
export function isSemanticMultiShotRun(run: Pick<ProductionRun, 'playbook' | 'generationPlan'>): boolean {
  return run.playbook.name === 'generation.single-shot' && (run.generationPlan?.shots?.length ?? 0) > 0
}

export function isRetiredLegacyWriterState(status: ProductionRun['jobs'][number]['status']): boolean { return status === 'submit_intent_persisted' || status === 'submitting' }
/**
 * A scheduler job can reach `adopted` even when the renderer failed to land
 * its generated node/artifact.  Assembly must never proceed from that partial
 * projection (otherwise we export an empty timeline while claiming success).
 */
export function semanticGenerationReadiness(run: Pick<ProductionRun, 'jobs' | 'artifacts'>): { ready: true } | { ready: false; reason: string } {
  const jobs = run.jobs.filter((job) => job.stageId === 'generate' && job.status === 'adopted')
  if (jobs.length === 0) return { ready: false, reason: desktopT('production.generationNoAdoptedShots') }
  for (const job of jobs) {
    if (!job.nodeId?.trim()) return { ready: false, reason: desktopT('production.generationMissingCanvasNode', { jobId: job.jobId }) }
    const artifact = run.artifacts.find((candidate) =>
      candidate.stageId === 'generate'
      && candidate.jobId === job.jobId
      && (candidate.status === 'ready' || candidate.status === 'adopted')
      && typeof candidate.projectRelativePath === 'string'
      && candidate.projectRelativePath.trim().length > 0,
    )
    if (!artifact) return { ready: false, reason: desktopT('production.generationMissingArtifact', { jobId: job.jobId }) }
  }
  return { ready: true }
}

export type DriverOps = {
  proposeDirections: (run: ProductionRun) => Promise<void>
  proposeScript: (run: ProductionRun) => Promise<void>
  proposeStoryboard: (run: ProductionRun) => Promise<void>
  driveGeneration: (run: ProductionRun) => Promise<void>
  /** Continue a completed semantic batch through the owning QA/assembly pipeline. */
  advanceSemanticProduction: (projectId: string, runId: string) => Promise<void>
  driveExport: (run: ProductionRun) => Promise<void>
  driveReconciliation: (projectId: string, runId: string, jobId: string) => Promise<void>
}

export function createDriverOps(deps: DriverOpsDeps): DriverOps {
  const {
    repository, sleep, requireRun, executeInternal, requestRenderer, executeProductionExport, writeProjectJson,
    localAssetPath, projectRelativePath, stageValue, reconcileProviderTask, inFlight, reconciliationInFlight,
    directionsInFlight,
  } = deps
  const generationRerunRequested = new Set<string>()

  /**
   * W1.5 qa 阶段：对本次已 adopted 的生成镜头发 production.verify-shots 给渲染层（复用现成
   * verifyShotsAndReport 判分+对账闭环），把 per-shot 判决落成 qa.verdict 事件 + qa 阶段摘要。
   * qa 是「生成后判分呈现」不是新门：不弹确认、不改状态机。旧
   * direction/legacy 流程在渲染层不可达时可记录「审片跳过」；语义多镜
   * 交付则必须拿到验证结果，失败进入 needs_attention，禁止假装完成。
   */
  async function runQaStage(projectId: string, runId: string, incoming: ProductionRun): Promise<ProductionRun> {
    let current = incoming
    const shotNodeIds = adoptedGenerationShotNodeIds(current)
    let response: QaVerifyResponse | null = null
    let verificationFailed = false
    if (shotNodeIds.length > 0) {
      try {
        response = await requestRenderer('production.verify-shots', { projectId, runId, shotNodeIds }, 10 * 60_000) as QaVerifyResponse
      } catch (error) {
        verificationFailed = true
        logError('production-run', 'shot-verify-failed-qa-skipped', error)
        response = null
      }
    }
    if (verificationFailed && isSemanticMultiShotRun(current)) {
      current = requireRun(projectId, runId)
      current = executeInternal(projectId, runId, current, 'stage.upsert', {
        stage: stageValue(current, 'qa', { status: 'needs_attention', qaSummary: '审片服务不可用，未继续组装；请重试审片' }),
      }, `driver-${runId}-qa-attention-${current.revision}`).run
      if (current.status === 'running') {
        current = executeInternal(projectId, runId, current, 'run.status', { status: 'needs_attention' }, `driver-${runId}-qa-attention-run-${current.revision}`).run
      }
      return current
    }
    const outcome = buildQaStageOutcome(shotNodeIds.length === 0 ? { skipped: true, skipReason: '本次没有可审片的已生成镜头' } : response)
    current = requireRun(projectId, runId)
    const retryPlans = Array.isArray(response?.verdicts) ? buildQaRetryPlans(current, response.verdicts) : []
    let verdictIndex = 0
    for (const event of outcome.events) {
      const verdict = response?.verdicts?.[verdictIndex]
      const retry = verdict ? retryPlans.find((plan) => plan.shotNodeId === verdict.shotNodeId) : undefined
      const retrySuffix = retry
        ? retry.eligible
          ? `；已安排定向重滚（第 ${retry.retryCount} 次）：${retry.retryReason}`
          : `；未重滚（${retry.blockedReason === 'budget_exhausted' ? '重试预算已用尽' : '已达到重试上限'}）`
        : ''
      // The same shot can be reviewed again after a targeted retry. Include the current
      // revision in this durable command id so a later QA pass cannot replay an old verdict
      // snapshot and then hit a revision conflict while appending the stage summary.
      current = executeInternal(projectId, runId, current, 'qa.verdict', { summary: `${event.summary}${retrySuffix}` }, `driver-${runId}-qa-verdict-${verdictIndex}-${current.revision}`).run
      verdictIndex += 1
    }
    // Persist retry decisions as new jobs. Keeping the original job immutable makes the first
    // result and the targeted retry independently inspectable; the driver re-enters generation
    // only for these authorized retry jobs, never for passing shots.
    for (const retry of retryPlans.filter((plan) => plan.eligible)) {
      const parent = current.jobs.find((job) => job.jobId === retry.parentJobId)
      if (!parent || current.jobs.some((job) => job.parentJobId === retry.parentJobId && job.retryCount === retry.retryCount)) continue
      const retryJob = {
        ...parent,
        jobId: `${parent.jobId}:retry-${retry.retryCount}`,
        status: 'authorized' as const,
        attempt: retry.nextAttempt,
        idempotencyKey: `${parent.idempotencyKey}:retry-${retry.retryCount}`,
        parentJobId: parent.jobId,
        retryCount: retry.retryCount,
        retryReason: retry.retryReason,
        metadata: {
          ...(parent.metadata || {}),
          retryCount: retry.retryCount,
          retryReason: retry.retryReason,
          retryDirective: retry.retryDirective,
          parentJobId: parent.jobId,
        },
        providerTaskId: undefined,
        errorCode: undefined,
        errorMessage: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      current = executeInternal(projectId, runId, current, 'qa.retry.schedule', { job: retryJob }, `driver-${runId}-qa-retry-${retry.shotNodeId}-${retry.retryCount}`).run
    }
    const retrySummary = retryPlans.filter((plan) => plan.eligible).length
    const stageSummary = retrySummary > 0
      ? `${outcome.stageSummary}；已安排 ${retrySummary} 镜定向重滚`
      : outcome.stageSummary
    return executeInternal(projectId, runId, current, 'stage.upsert', {
      stage: stageValue(current, 'qa', {
        status: retrySummary > 0 ? 'running' : 'completed',
        ...(retrySummary > 0 ? {} : { completedAt: new Date().toISOString() }),
        qaSummary: stageSummary,
      }),
    }, `driver-${runId}-stage-qa-${current.revision}`).run
  }

  async function proposeDirections(run: ProductionRun): Promise<void> {
    // B1：run 停在 awaiting_direction、方向门 waiting 且还没候选 → 让 renderer 的 LLM 拟 2-3 个方向。
    // GUI 关着 / 拟失败 → 保持现状 gate（title/summary 兜底），错误吞掉不影响主流程（诚实降级）。
    if (directionsInFlight.has(run.runId)) return
    if (run.status !== 'awaiting_direction') return
    const gate = run.gates.find((item) => item.gateId === 'gate-direction-v1' && item.status === 'waiting')
    if (!gate || (gate.directionCandidates?.length ?? 0) > 0) return
    directionsInFlight.add(run.runId)
    try {
      const planResult = await requestRenderer('production.plan-directions', {
        projectId: run.projectId,
        runId: run.runId,
        brief: run.brief,
        playbook: run.playbook,
      }, 5 * 60_000)
      const candidates = normalizeDirectionCandidates((planResult as Record<string, unknown> | null)?.candidates)
      const current = requireRun(run.projectId, run.runId)
      const currentGate = current.gates.find((item) => item.gateId === 'gate-direction-v1' && item.status === 'waiting')
      if (!currentGate || (currentGate.directionCandidates?.length ?? 0) > 0) return
      writeProjectJson(run.projectId, `.nomi/runs/${run.runId}/direction-v1.json`, {
        schemaVersion: 1, kind: 'direction', brief: current.brief, status: 'awaiting_direction', candidates,
      })
      executeInternal(run.projectId, run.runId, current, 'gate.set_candidates', { gateId: 'gate-direction-v1', candidates }, `driver-${run.runId}-direction-candidates`)
    } catch (error) {
      logError('production-run', 'direction-planning-failed', error)
    } finally {
      directionsInFlight.delete(run.runId)
      if (generationRerunRequested.delete(run.runId)) {
        const latest = repository.read(run.projectId, run.runId)
        if (latest) void driveGeneration(latest)
      }
    }
  }

  function scriptText(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Script planner returned no draft')
    const record = value as Record<string, unknown>
    const nested = record.script && typeof record.script === 'object' && !Array.isArray(record.script)
      ? record.script as Record<string, unknown>
      : undefined
    const text = [record.text, record.content, nested?.text, nested?.content]
      .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    if (!text) throw new Error('Script planner returned no draft text')
    return text
  }

  async function proposeScript(run: ProductionRun): Promise<void> {
    if (inFlight.has(run.runId)) return
    if (run.status !== 'running' || run.stageId !== 'direction') return
    inFlight.add(run.runId)
    try {
      const planResult = await requestRenderer('production.plan-script', {
        projectId: run.projectId, runId: run.runId, brief: run.brief, playbook: run.playbook,
      }, 5 * 60_000)
      const content = scriptText(planResult)
      const hash = crypto.createHash('sha256').update(content).digest('hex')
      const current = requireRun(run.projectId, run.runId)
      const version = Math.max(0, ...current.artifacts.filter((item) => item.kind === 'script').map((item) => item.version || 0)) + 1
      const artifactId = `artifact-script-v${version}`
      const skillEvidence = loadPlaybookStageEvidence(run.playbook.name, run.playbook.version, 'script')
      const scriptPath = `.nomi/runs/${run.runId}/script-v${version}.json`
      const timestamp = new Date().toISOString()
      writeProjectJson(run.projectId, scriptPath, {
        schemaVersion: 1, kind: 'script', projectId: run.projectId, runId: run.runId, artifactId,
        version, source: 'nomi-agent', content, contentHash: hash, createdAt: timestamp,
      })
      const result = repository.execute(run.projectId, run.runId, {
        commandId: `driver:${run.runId}:script-proposed:${hash.slice(0, 16)}`,
        expectedRevision: current.revision, type: 'plan.proposed',
        payload: { artifacts: [{
          artifactId, stageId: 'script', kind: 'script' as const, status: 'candidate' as const,
          version, source: 'nomi-agent' as const, contentHash: hash, reviewStatus: 'waiting' as const,
          skillEvidence,
          projectRelativePath: scriptPath, createdAt: timestamp,
        }] }, issuedAt: timestamp,
      })
      repository.execute(run.projectId, run.runId, {
        commandId: `driver:${run.runId}:script-skill:${hash.slice(0, 16)}`,
        expectedRevision: result.run.revision, type: 'skill.evidence',
        payload: { skillName: run.playbook.name, version: run.playbook.version, artifactId, stageId: 'script', skillEvidence }, issuedAt: timestamp,
      })
    } catch (error) {
      const current = repository.read(run.projectId, run.runId)
      if (current && current.status === 'running') {
        try {
          repository.execute(run.projectId, run.runId, {
            commandId: `driver:${run.runId}:script-error:${current.revision}`,
            expectedRevision: current.revision, type: 'run.status', payload: { status: 'needs_attention' }, issuedAt: new Date().toISOString(),
          })
        } catch { /* Preserve the original planning failure; the run remains inspectable. */ }
      }
      logError('production-run', 'script-planning-failed', error)
    } finally {
      inFlight.delete(run.runId)
      if (generationRerunRequested.delete(run.runId)) {
        const latest = repository.read(run.projectId, run.runId)
        if (latest) void driveGeneration(latest)
      }
    }
  }

  async function proposeStoryboard(run: ProductionRun): Promise<void> {
    if (inFlight.has(run.runId)) return
    if (run.status !== 'running' || run.stageId !== 'storyboard') return
    const source = run.artifacts
      .filter((item) => item.kind === 'script' && item.status === 'adopted')
      .sort((left, right) => (right.version || 0) - (left.version || 0))[0]
    if (!source) return
    inFlight.add(run.runId)
    try {
      const planResult = await requestRenderer('production.plan-storyboard', {
        projectId: run.projectId, runId: run.runId, brief: run.brief, playbook: run.playbook,
        sourceScriptArtifactId: source.artifactId, sourceScriptVersion: source.version, sourceScriptHash: source.contentHash,
      }, 5 * 60_000)
      const rawPlan = planValue(planResult)
      const plan = {
        ...rawPlan,
        sourceScriptArtifactId: source.artifactId,
        sourceScriptVersion: source.version,
        sourceScriptHash: source.contentHash,
      }
      const hash = crypto.createHash('sha256').update(JSON.stringify(plan)).digest('hex')
      const current = requireRun(run.projectId, run.runId)
      const version = Math.max(0, ...current.artifacts.filter((item) => item.kind === 'storyboard').map((item) => item.version || 0)) + 1
      const storyboardPath = `.nomi/runs/${run.runId}/storyboard-v${version}.json`
      const timestamp = new Date().toISOString()
      const skillEvidence = loadPlaybookStageEvidence(run.playbook.name, run.playbook.version, 'storyboard')
      writeProjectJson(run.projectId, storyboardPath, {
        schemaVersion: 1, kind: 'storyboard', projectId: run.projectId, runId: run.runId, version,
        source: 'nomi-agent', sourceArtifactId: source.artifactId, sourceVersion: source.version,
        sourceContentHash: source.contentHash, sourceHash: source.contentHash, planHash: hash, plan,
      })
      const result = repository.execute(run.projectId, run.runId, {
        commandId: `driver:${run.runId}:storyboard-proposed:${hash.slice(0, 16)}`,
        expectedRevision: current.revision, type: 'plan.proposed',
        payload: { artifacts: [{
           artifactId: `artifact-storyboard-v${version}`, stageId: 'storyboard', kind: 'storyboard' as const,
           status: 'candidate' as const, version, source: 'nomi-agent' as const,
           contentHash: hash,
           sourceArtifactId: source.artifactId, sourceVersion: source.version,
          sourceContentHash: source.contentHash, sourceHash: source.contentHash, reviewStatus: 'waiting' as const,
          sourceScriptArtifactId: source.artifactId, sourceScriptVersion: source.version, sourceScriptHash: source.contentHash,
          skillEvidence,
          projectRelativePath: storyboardPath, createdAt: timestamp,
        }] }, issuedAt: timestamp,
      })
      repository.execute(run.projectId, run.runId, {
        commandId: `driver:${run.runId}:storyboard-skill:${hash.slice(0, 16)}`,
        expectedRevision: result.run.revision, type: 'skill.evidence',
        payload: { skillName: run.playbook.name, version: run.playbook.version, artifactId: `artifact-storyboard-v${version}`, stageId: 'storyboard', skillEvidence }, issuedAt: timestamp,
      })
    } catch (error) {
      logError('production-run', 'storyboard-planning-failed', error)
    } finally {
      inFlight.delete(run.runId)
      if (generationRerunRequested.delete(run.runId)) {
        const latest = repository.read(run.projectId, run.runId)
        if (latest) void driveGeneration(latest)
      }
    }
  }

  async function driveGeneration(run: ProductionRun): Promise<void> {
    if (inFlight.has(run.runId)) {
      // A gate decision or resume can arrive after the gate is durable but before the current
      // driver's finally releases its lock. Remember one rerun instead of losing that wake-up.
      generationRerunRequested.add(run.runId)
      return
    }
    inFlight.add(run.runId)
    try {
      let current = requireRun(run.projectId, run.runId)
      const semanticMultiShot = isSemanticMultiShotRun(current)
      if (current.status === 'ready') {
        current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'running' }, `driver-${run.runId}-generation-start`).run
      }
      current = settlePauseIfQuiet(repository, run.projectId, run.runId, requireRun(run.projectId, run.runId))
      if (current.status !== 'running') return
      if (!semanticMultiShot) {
        // `authorized` is the pre-submit state owned by the still-supported
        // legacy compatibility fixture. Once the durable submit intent exists,
        // the retired writer must never be re-entered after restart/retry.
        const legacyJobs = current.jobs.filter((job) =>
          job.stageId === 'generate' && isRetiredLegacyWriterState(job.status))
        if (legacyJobs.length > 0) {
          for (const job of legacyJobs) {
            current = requireRun(run.projectId, run.runId)
            const latest = current.jobs.find((candidate) => candidate.jobId === job.jobId)
            if (latest && isRetiredLegacyWriterState(latest.status)) {
              current = executeInternal(run.projectId, run.runId, current, 'job.status', {
                jobId: job.jobId,
                status: 'needs_attention',
                patch: {
                  errorCode: 'legacy_generation_writer_retired',
                  errorMessage: 'Legacy ProductionRun generation writer is retired; create a semantic generation.single-shot plan to continue.',
                },
              }, `driver-${run.runId}-${job.jobId}-legacy-writer-retired`).run
            }
          }
          current = requireRun(run.projectId, run.runId)
          if (current.status !== 'needs_attention') {
            current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'needs_attention' }, `driver-${run.runId}-legacy-writer-retired`).run
          }
          return
        }
        if (current.status === 'running' && !hasApprovedFreezeGate(current)) {
          const pendingJobs = current.jobs.filter((job) => job.status === 'authorized' || job.status === 'submit_intent_persisted')
          if (hasWaitingFreezeGate(current)) return
          if (pendingJobs.length > 0) {
            const unfrozen = await readUnfrozenAnchors(requestRenderer, run.projectId, run.runId)
            current = requireRun(run.projectId, run.runId)
            if (unfrozen.length > 0 && current.status === 'running'
              && !current.gates.some((gate) => gate.gateId === freezeGateId(current.planVersion))) {
              const gateId = freezeGateId(current.planVersion)
              const anchorList = unfrozen.map((item) => item.title || item.nodeId).join('、')
              const freezeGate = {
                gateId,
                scope: 'stage' as const,
                status: 'waiting' as const,
                planHash: crypto.createHash('sha256').update(`${current.planVersion}:freeze:${unfrozen.map((item) => item.nodeId).sort().join(',')}`).digest('hex'),
                jobIds: [],
                title: 'Freeze character and scene cards before the batch',
                summary: `Freeze ${unfrozen.length} reference card(s) in Nomi before Nomi generates the shots that reference them: ${anchorList}. No provider call occurs before you freeze and approve.`,
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              }
              executeInternal(run.projectId, run.runId, current, 'gate.add', { gate: freezeGate }, `driver-${gateId}`)
              return
            }
          }
        }
        const jobs = current.jobs.filter((job) => job.status === 'authorized' || job.status === 'submit_intent_persisted')
        for (const job of jobs) {
          current = requireRun(run.projectId, run.runId)
          if (current.status !== 'running') break
          if (hasWaitingSampleGate(current)) break
          const shotGates = current.gates.filter((gate) => isShotGate(gate)
            && gate.gateId.startsWith(`gate-shot-v${current.planVersion}-`)
            && gate.jobIds.includes(job.jobId))
          if (shotGates.some((gate) => gate.status === 'waiting')) return
          const approvedShotGate = shotGates.some((gate) => gate.status === 'approved')
          if (trustLevelOf(current.policy) === 'confirm_all' && !approvedShotGate) {
            const gateId = shotGateId(current.planVersion, job.jobId, shotGates.length + 1)
            const shotGate = {
              gateId,
              scope: 'job_set' as const,
              status: 'waiting' as const,
              planHash: crypto.createHash('sha256').update(`${current.planVersion}:${job.jobId}:${job.provider}:${job.model}`).digest('hex'),
              jobIds: [job.jobId],
              title: 'Approve shot before provider submission',
              summary: `${job.nodeId || job.jobId} will be submitted to ${job.provider} using ${job.model}. No provider call occurs before approval.`,
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            }
            executeInternal(run.projectId, run.runId, current, 'gate.add', { gate: shotGate }, `driver-${gateId}`)
            return
          }
          if (job.status === 'authorized') current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'submit_intent_persisted' }, `driver-${job.jobId}-intent`).run
          current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'submitting' }, `driver-${job.jobId}-submit`).run
          try {
            const result = await requestRenderer('production.generate-node', {
              projectId: run.projectId,
              runId: run.runId,
              jobId: job.jobId,
              nodeId: job.nodeId,
              maxAttemptsPerJob: current.policy.maxAttemptsPerJob,
              idempotencyKey: job.idempotencyKey,
              ...(typeof job.retryCount === 'number' ? { retryCount: job.retryCount } : {}),
              ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
              ...(typeof job.retryReason === 'string' && job.retryReason.trim() ? { retryReason: job.retryReason } : {}),
              ...(typeof job.metadata?.retryDirective === 'string' && job.metadata.retryDirective.trim()
                ? { retryDirective: job.metadata.retryDirective.trim() } : {}),
            }, 30 * 60_000) as { assets?: Array<{ type?: string; url?: string; thumbnailUrl?: string }> }
            for (const status of ['provider_accepted', 'polling', 'downloading', 'validating_technical', 'validating_content'] as const) {
              current = requireRun(run.projectId, run.runId)
              current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status }, `driver-${job.jobId}-${status}`).run
            }
            const asset = result?.assets?.[0]
            const relativePath = localAssetPath(run.projectId, asset?.url)
            const thumbnailRelativePath = localAssetPath(run.projectId, asset?.thumbnailUrl)
            current = requireRun(run.projectId, run.runId)
            if (asset?.url && relativePath) {
              current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'ready' }, `driver-${job.jobId}-ready`).run
              const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
              const sampleArtifactId = artifactIdentifierForJob(job.jobId)
              current = executeInternal(run.projectId, run.runId, current, 'artifact.add', { artifact: { artifactId: sampleArtifactId, stageId: 'generate', jobId: job.jobId, kind, status: 'adopted', ...(job.parentJobId ? { parentArtifactId: artifactIdentifierForJob(job.parentJobId) } : {}), ...(job.retryCount !== undefined ? { retryCount: job.retryCount } : {}), ...(job.retryReason ? { retryReason: job.retryReason } : {}), projectRelativePath: relativePath, ...(thumbnailRelativePath ? { thumbnailRelativePath } : {}), createdAt: new Date().toISOString(), adoptedAt: new Date().toISOString() } }, `driver-${job.jobId}-artifact`).run
              current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'adopted' }, `driver-${job.jobId}-adopted`).run
              const adoptedGenerateCount = current.jobs.filter((candidate) => candidate.stageId === 'generate' && candidate.status === 'adopted').length
              if (current.status === 'running' && adoptedGenerateCount === 1 && shouldSampleGate(current) && !current.gates.some((gate) => gate.gateId === sampleGateId(current.planVersion))) {
                const sampleGate = {
                  gateId: sampleGateId(current.planVersion),
                  scope: 'stage' as const,
                  status: 'waiting' as const,
                  planHash: crypto.createHash('sha256').update(sampleArtifactId).digest('hex'),
                  jobIds: [],
                  title: 'Review the sample before the full batch',
                  summary: `Look at the first shot (${sampleArtifactId}) in Nomi before Nomi generates the remaining shots. Approve to continue, or pause to adjust.`,
                  createdAt: new Date().toISOString(),
                  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                }
                current = executeInternal(run.projectId, run.runId, current, 'gate.add', { gate: sampleGate }, `driver-${run.runId}-sample-gate`).run
                return
              }
            } else {
              current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'needs_attention', patch: { errorCode: 'asset_not_localized', errorMessage: '生成已返回，但项目内没有可预览的本地素材' } }, `driver-${job.jobId}-asset-attention`).run
              if (current.status !== 'needs_attention') current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'needs_attention' }, `driver-${run.runId}-asset-attention-${current.revision}`).run
              return
            }
          } catch (error) {
            current = requireRun(run.projectId, run.runId)
            if (current.jobs.find((candidate) => candidate.jobId === job.jobId)?.status === 'submitting') current = executeInternal(run.projectId, run.runId, current, 'job.status', { jobId: job.jobId, status: 'submission_unknown', patch: { errorCode: 'renderer_or_provider_unknown', errorMessage: '生成提交结果无法确认' } }, `driver-${job.jobId}-unknown-${current.revision}`).run
            if (current.status !== 'needs_attention') {
              try { current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'needs_attention' }, `driver-${run.runId}-generation-attention-${current.revision}`).run } catch { /* preserve unknown job state */ }
            }
            logError('production-run', 'generation-driver-stopped', error)
            return
          }
        }
      }
      current = settlePauseIfQuiet(repository, run.projectId, run.runId, requireRun(run.projectId, run.runId))
      if (current.status !== 'running') return
      if (semanticMultiShot) {
        // Materialization deliberately leaves a job `ready`: the artifact is
        // durable, while adoption is the ProductionRun owner's explicit
        // acknowledgement that the result is eligible for QA/assembly.  Do
        // this transition here (never in the provider adapter) so a repeated
        // callback is harmless and no second ledger/provider write occurs.
        for (const job of current.jobs.filter((candidate) => candidate.stageId === 'generate' && candidate.status === 'ready')) {
          current = executeInternal(run.projectId, run.runId, current, 'job.status', {
            jobId: job.jobId,
            status: 'adopted',
          }, `driver-${run.runId}-adopt-${job.jobId}`).run
        }
      }
      const generationJobs = semanticMultiShot
        ? current.jobs.filter((job) => job.stageId === 'generate')
        : current.jobs
      if (generationJobs.some((job) => !['adopted', 'cancelled_remote', 'detached'].includes(job.status))) return
      if (semanticMultiShot) {
        const readiness = semanticGenerationReadiness(current)
        if (!readiness.ready) {
          current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', {
            stage: stageValue(current, 'generate', {
              status: 'needs_attention',
              qaSummary: `生成未完成：${readiness.reason}`,
            }),
          }, `driver-${run.runId}-generation-incomplete-${current.revision}`).run
          if (current.status !== 'needs_attention') {
            executeInternal(run.projectId, run.runId, current, 'run.status', {
              status: 'needs_attention',
            }, `driver-${run.runId}-generation-incomplete-run-${current.revision}`)
          }
          return
        }
      }
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'generate', { status: 'completed', completedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-generate-${current.revision}`).run
      const qaWasCompleted = current.stages.find((stage) => stage.stageId === 'qa')?.status === 'completed'
      if (!qaWasCompleted) {
        current = executeInternal(run.projectId, run.runId, current, 'run.stage', { stageId: 'qa' }, `driver-${run.runId}-stage-qa-start-${current.revision}`).run
        current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'qa', { status: 'running', startedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-qa-running-${current.revision}`).run
        current = await runQaStage(run.projectId, run.runId, current)
        if (current.status !== 'running') return
      }
      if (current.jobs.some((job) => job.status === 'authorized' && job.retryCount !== undefined)) {
        // The current driver is single-flight. Ask its finally block to re-enter once the
        // durable retry jobs exist, instead of recursively calling into the in-flight driver.
        generationRerunRequested.add(run.runId)
        return
      }
      current = executeInternal(run.projectId, run.runId, current, 'run.stage', { stageId: 'assemble' }, `driver-${run.runId}-stage-assemble-start-${current.revision}`).run
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'assemble', { status: 'running', startedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-assemble`).run
      const arrangement = await requestRenderer('production.arrange', {
        projectId: run.projectId,
        runId: run.runId,
        shotNodeIds: adoptedGenerationShotNodeIds(current),
      }, 5 * 60_000) as Record<string, unknown>
      const timelinePath = `.nomi/runs/${run.runId}/timeline-v${current.planVersion}.json`
      writeProjectJson(run.projectId, timelinePath, { schemaVersion: 1, kind: 'timeline', arrangement, timelineContract: arrangement.timelineContract })
      current = requireRun(run.projectId, run.runId)
      current = executeInternal(run.projectId, run.runId, current, 'artifact.add', { artifact: { artifactId: `artifact-timeline-v${current.planVersion}`, stageId: 'assemble', kind: 'timeline', status: 'adopted', projectRelativePath: timelinePath, createdAt: new Date().toISOString(), adoptedAt: new Date().toISOString() } }, `driver-${run.runId}-timeline`).run
      const exportGate = { gateId: `gate-export-v${current.planVersion}`, scope: 'export' as const, status: 'waiting' as const, planHash: crypto.createHash('sha256').update(JSON.stringify(arrangement)).digest('hex'), jobIds: [], title: 'Review rough cut and approve export', summary: 'Check pacing and media in Preview before explicitly approving the MP4 export.', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
      current = executeInternal(run.projectId, run.runId, current, 'gate.add', { gate: exportGate }, `driver-${run.runId}-export-gate`).run
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'assemble', { status: 'completed', completedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-assemble-complete`).run
      current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'awaiting_rough_cut_review' }, `driver-${run.runId}-rough-cut`).run
    } catch (error) {
      logError('production-run', 'generation-assembly-driver-failed', error)
    } finally {
      inFlight.delete(run.runId)
      if (generationRerunRequested.delete(run.runId)) {
        const latest = repository.read(run.projectId, run.runId)
        if (latest) void driveGeneration(latest)
      }
    }
  }

  /**
   * Scheduler completion callback target.  It is intentionally narrow and
   * semantic-only: legacy production.* runs keep their retired-writer
   * behavior, while a semantic batch re-enters the same driver that owns QA,
   * timeline assembly, and the export approval gate.
   */
  async function advanceSemanticProduction(projectId: string, runId: string): Promise<void> {
    const current = requireRun(projectId, runId)
    if (!isSemanticMultiShotRun(current)) return
    await driveGeneration(current)
  }

  async function driveExport(run: ProductionRun): Promise<void> {
    if (inFlight.has(run.runId)) return
    inFlight.add(run.runId)
    try {
      let current = requireRun(run.projectId, run.runId)
      current = executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'exporting' }, `driver-${run.runId}-export-start`).run
      const result = isSemanticMultiShotRun(current)
        ? await executeProductionExport({ projectId: run.projectId, runId: run.runId, outputName: `nomi-${run.runId}.mp4` })
        : await requestRenderer('production.export', { projectId: run.projectId, runId: run.runId, outputName: `nomi-${run.runId}.mp4` }, 30 * 60_000) as { relativePath?: string; size?: number; jobId?: string }
      const relativePath = projectRelativePath(run.projectId, result?.relativePath, { requireFile: true })
      current = requireRun(run.projectId, run.runId)
      const exportVersion = Math.max(0, ...current.artifacts.filter((artifact) => artifact.kind === 'export').map((artifact) => artifact.version || 0)) + 1
      const exportJobId = typeof result?.jobId === 'string' && result.jobId.trim() ? result.jobId.trim() : `export:${run.runId}:v${exportVersion}`
      current = executeInternal(run.projectId, run.runId, current, 'artifact.add', { artifact: { artifactId: `artifact-export-v${exportVersion}`, stageId: 'export', kind: 'export', status: 'adopted', jobId: exportJobId, version: exportVersion, source: 'nomi-agent', projectRelativePath: relativePath, createdAt: new Date().toISOString(), adoptedAt: new Date().toISOString() } }, `driver-${run.runId}-export-artifact-v${exportVersion}`).run
      current = executeInternal(run.projectId, run.runId, current, 'stage.upsert', { stage: stageValue(current, 'export', { status: 'completed', completedAt: new Date().toISOString() }) }, `driver-${run.runId}-stage-export`).run
      executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'completed' }, `driver-${run.runId}-completed`)
    } catch (error) {
      const current = repository.read(run.projectId, run.runId)
      if (current && current.status === 'exporting') {
        try { executeInternal(run.projectId, run.runId, current, 'run.status', { status: 'needs_attention' }, `driver-${run.runId}-export-attention-${current.revision}`) } catch { /* preserve export error */ }
      }
      logError('production-run', 'export-driver-failed', error)
    } finally {
      inFlight.delete(run.runId)
    }
  }

  async function driveReconciliation(projectId: string, runId: string, jobId: string): Promise<void> {
    const key = `${projectId}:${runId}:${jobId}`
    if (reconciliationInFlight.has(key)) return
    reconciliationInFlight.add(key)
    try {
      while (true) {
        let current = requireRun(projectId, runId)
        let job = current.jobs.find((candidate) => candidate.jobId === jobId)
        if (!job || !['reconciling', 'provider_accepted', 'polling'].includes(job.status)) return
        const result = await reconcileProviderTask(job)
        const status = String(result.status || '').toLowerCase()
        if (['queued', 'running', 'processing', 'pending'].includes(status)) {
          if (job.status === 'reconciling') {
            current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'provider_accepted' }, `reconcile-${jobId}-accepted-${current.revision}`).run
            current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'polling' }, `reconcile-${jobId}-polling-${current.revision}`).run
          }
          if (current.status === 'needs_attention') {
            current = executeInternal(projectId, runId, current, 'run.status', { status: 'running' }, `reconcile-${runId}-running-${current.revision}`).run
          }
          await sleep(2_000)
          continue
        }
        if (status !== 'succeeded') {
          current = requireRun(projectId, runId)
          job = current.jobs.find((candidate) => candidate.jobId === jobId)
          if (job && ['reconciling', 'polling'].includes(job.status)) {
            if (job.status === 'reconciling') {
              current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'needs_attention', patch: { errorCode: 'reconcile_failed', errorMessage: result.error || '供应商任务未找到或已失败' } }, `reconcile-${jobId}-failed-${current.revision}`).run
            } else {
              current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'needs_attention', patch: { errorCode: 'reconcile_failed', errorMessage: result.error || '供应商任务未找到或已失败' } }, `reconcile-${jobId}-failed-${current.revision}`).run
            }
          }
          return
        }

        current = requireRun(projectId, runId)
        job = current.jobs.find((candidate) => candidate.jobId === jobId)
        if (!job) return
        if (job.status === 'reconciling') {
          current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'provider_accepted' }, `reconcile-${jobId}-accepted-${current.revision}`).run
          current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'polling' }, `reconcile-${jobId}-polling-${current.revision}`).run
        }
        for (const nextStatus of ['downloading', 'validating_technical', 'validating_content'] as const) {
          current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: nextStatus }, `reconcile-${jobId}-${nextStatus}-${current.revision}`).run
        }
        const asset = result.assets?.[0]
        const relativePath = localAssetPath(projectId, asset?.url)
        const thumbnailRelativePath = localAssetPath(projectId, asset?.thumbnailUrl)
        if (!asset?.url || !relativePath) {
          executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'needs_attention', patch: { errorCode: 'reconcile_asset_not_local', errorMessage: '对账找到了任务，但结果尚未落入本地项目' } }, `reconcile-${jobId}-asset-${current.revision}`)
          return
        }
        current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'ready' }, `reconcile-${jobId}-ready-${current.revision}`).run
        const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
        current = executeInternal(projectId, runId, current, 'artifact.add', {
          artifact: { artifactId: artifactIdentifierForJob(jobId), stageId: job.stageId, jobId, kind, status: 'adopted', projectRelativePath: relativePath, ...(thumbnailRelativePath ? { thumbnailRelativePath } : {}), createdAt: new Date().toISOString(), adoptedAt: new Date().toISOString() },
        }, `reconcile-${jobId}-artifact-${current.revision}`).run
        current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'adopted' }, `reconcile-${jobId}-adopted-${current.revision}`).run
        if (current.status === 'needs_attention') {
          current = executeInternal(projectId, runId, current, 'run.status', { status: 'running' }, `reconcile-${runId}-resume-${current.revision}`).run
        }
        void driveGeneration(current)
        return
      }
    } catch (error) {
      let current = repository.read(projectId, runId)
      const job = current?.jobs.find((candidate) => candidate.jobId === jobId)
      if (current && job && ['reconciling', 'polling'].includes(job.status)) {
        try {
          current = executeInternal(projectId, runId, current, 'job.status', { jobId, status: 'needs_attention', patch: { errorCode: 'reconcile_error', errorMessage: error instanceof Error ? error.message : String(error) } }, `reconcile-${jobId}-error-${current.revision}`).run
        } catch { /* Preserve the latest durable state. */ }
      }
    } finally {
      reconciliationInFlight.delete(key)
    }
  }

  return { proposeDirections, proposeScript, proposeStoryboard, driveGeneration, advanceSemanticProduction, driveExport, driveReconciliation }
}
