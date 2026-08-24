import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, waitForProduction, PRODUCTION_DRIVER_TEST_TIMEOUT_MS } from './productionRunTestHelpers'
import { buildQaRetryPlans, buildQaStageOutcome, adoptedGenerationShotNodeIds } from './productionQaVerdict'

// W1.5 · 把审片接进 production run 路径②的 qa 阶段。
// 方案：docs/plan/2026-08-19-w1-shot-verify-wiring.md §3「production run 路径②的对称落点」+ T10。
// 先红后绿：qa 阶段此前只 markComplete、零判分事件；接线后 qa 会发 production.verify-shots，
// 把 per-shot 判决落成 qa.verdict 事件 + qa 阶段摘要（判分失败/无镜头 → 诚实降级「审片跳过」，不阻断）。

const WAIT_MS = 5000

/** 走到「合同已批准、样片门已批准」→ driver 会跑完两镜、进 qa、再进 assemble 的公共前置。 */
async function driveToRoughCut(
  service: ReturnType<typeof createProductionRunService>,
  runId: string,
): Promise<void> {
  service.createDraft({
    runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' }, brief: { goal: 'qa verify', durationSeconds: 30 },
  })
  await service.command('project-1', runId, {
    commandId: 'direction', expectedRevision: service.readFull('project-1', runId)!.revision, type: 'gate.decide',
    payload: { gateId: 'gate-direction-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
  })
  await approveLatestScript(service, 'project-1', runId)
  await approveLatestStoryboard(service, 'project-1', runId)
  const planned = service.readFull('project-1', runId)!
  const storyboardId = planned.artifacts.find((a) => a.kind === 'storyboard')!.artifactId
  const attached = await service.command('project-1', runId, {
    commandId: 'attach', expectedRevision: planned.revision, type: 'plan.attach',
    payload: { artifactId: storyboardId, bindings: [
      { nodeId: 'shot-1', provider: 'local', model: 'demo-video', stageId: 'generate' },
      { nodeId: 'shot-2', provider: 'local', model: 'demo-video', stageId: 'generate' },
    ] },
    issuedAt: new Date().toISOString(),
  })
  await service.command('project-1', runId, {
    commandId: 'contract', expectedRevision: attached.run.revision, type: 'gate.decide',
    payload: { gateId: 'gate-contract-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
  })
  // 样片门：首镜落地后停一次 → 批准续跑剩余镜头 → qa → assemble → 粗剪。
  await waitForProduction(() => service.readFull('project-1', runId)!.gates.some((g) => g.gateId === 'gate-sample-v1' && g.status === 'waiting'), WAIT_MS)
  const atSample = service.readFull('project-1', runId)!
  await service.command('project-1', runId, {
    commandId: 'approve-sample', expectedRevision: atSample.revision, type: 'gate.decide',
    payload: { gateId: 'gate-sample-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
  })
}

function makeTwoShotService(root: string, verifyResponse: (shotNodeIds: string[]) => unknown, seen: string[]) {
  fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
  fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
  const requestRenderer = async (op: string, payload: unknown) => {
    seen.push(op)
    if (op === 'production.plan-directions') return { candidates: [{ key: 'a', title: '方向一', oneLiner: 'x' }, { key: 'b', title: '方向二', oneLiner: 'y' }] }
    if (op === 'production.plan-script') return { text: 'qa script' }
    if (op === 'production.plan-storyboard') return { plan: { title: 'promo', anchors: [], shots: [
      { index: 1, shotKind: 'video', prompt: 'shot one' },
      { index: 2, shotKind: 'video', prompt: 'shot two' },
    ] } }
    if (op === 'production.generate-node') {
      const retryDirective = (payload as Record<string, unknown>).retryDirective
      if (typeof retryDirective === 'string' && retryDirective.trim()) seen.push(`retry-directive:${retryDirective}`)
      return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
    }
    if (op === 'production.verify-shots') {
      const rawIds = (payload as Record<string, unknown>).shotNodeIds
      const ids = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === 'string') : []
      return verifyResponse(ids)
    }
    if (op === 'production.arrange') return { arranged: 2, total: 2 }
    throw new Error(`unexpected renderer op: ${op}`)
  }
  const repository = createProductionRunRepository({ projectDirResolver: () => root })
  const service = createProductionRunService({
    repository,
    projectRootResolver: () => root,
    requestRenderer,
    policyResolver: () => ({ trustedHosts: ['codex'], allowedProviders: ['local'], allowedModels: ['demo-video'], maxSpend: 10, maxAttemptsPerJob: 1 }),
  })
  return service
}

describe('production qa 审片接线（W1.5 · 路径②）', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('qa 阶段对已生成镜头调 production.verify-shots，并把 per-shot 判决落成 qa.verdict 事件 + qa 摘要', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-qa-verdict-'))
    const seen: string[] = []
    // 一镜过检、一镜身份红标（第 2 档）——证明「过检 / 红标 + 维度理由」都进事件。
    const service = makeTwoShotService(root, (ids) => ({
      reviewedShotIds: ids,
      verdicts: ids.map((shotNodeId, index) => index === 1
        ? { shotNodeId, passed: false, shotTitle: `镜 ${index + 1}`, flagged: [{ dimension: 'identity', dimensionName: '身份', score: 2, reason: '主体换脸了' }] }
        : { shotNodeId, passed: true, shotTitle: `镜 ${index + 1}` }),
    }), seen)
    const runId = 'run-qa-1'
    await driveToRoughCut(service, runId)
    await waitForProduction(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review', WAIT_MS)

    // 确实走了审片 IPC（在 arrange 之前）。
    expect(seen).toContain('production.verify-shots')
    expect(seen.indexOf('production.verify-shots')).toBeLessThan(seen.indexOf('production.arrange'))

    // qa.verdict 事件：两镜各一条，过检/红标可辨、红标带维度与理由。
    const events = await service.readEvents('project-1', runId, 0, 0)
    const verdictEvents = events.events.filter((e) => (e as { type?: string }).type === 'qa.verdict')
    // First pass + one bounded targeted retry for the red-marked shot.
    expect(verdictEvents.length).toBeGreaterThanOrEqual(2)
    const messages = verdictEvents.map((e) => (e as { message: string }).message)
    expect(messages.some((m) => m.includes('审片通过'))).toBe(true)
    expect(messages.some((m) => m.includes('审片红标') && m.includes('身份') && m.includes('主体换脸了'))).toBe(true)
    expect(messages.some((m) => m.includes('已安排定向重滚'))).toBe(true)
    expect(seen.some((item) => item.startsWith('retry-directive:') && item.includes('身份'))).toBe(true)

    // qa 阶段摘要进投影（nomi_get_run 读得到），且 qa 阶段 completed。
    const projection = service.readProjection('project-1', runId)
    const qaStage = projection.stages.find((s) => s.stageId === 'qa')
    expect(qaStage?.status).toBe('completed')
    expect((qaStage as { qaSummary?: string })?.qaSummary).toContain('红标')
    const retryJob = projection.jobs.find((job) => job.retryCount === 1)
    expect(retryJob).toMatchObject({ parentJobId: expect.stringContaining('shot-2'), retryReason: expect.stringContaining('身份') })
    const retryArtifact = projection.artifacts.find((artifact) => artifact.retryCount === 1)
    expect(retryArtifact).toMatchObject({ parentArtifactId: expect.stringContaining('shot-2'), retryReason: expect.stringContaining('身份') })
    // 不新增门、不改花钱语义：qa 阶段没有新增任何 gate。
    expect(projection.gates.some((g) => g.gateId.startsWith('gate-qa'))).toBe(false)
  })

  it('审片失败（渲染层报错）→ 诚实降级：一条「审片跳过」事件 + 摘要，run 照常走到粗剪不阻断', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-qa-skip-'))
    const seen: string[] = []
    const service = makeTwoShotService(root, () => { throw new Error('renderer verify blew up') }, seen)
    const runId = 'run-qa-2'
    await driveToRoughCut(service, runId)
    // 判分抛错被吞 → qa 仍 completed → 照常进 assemble → 粗剪。
    await waitForProduction(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review', WAIT_MS)

    const events = await service.readEvents('project-1', runId, 0, 0)
    const verdictEvents = events.events.filter((e) => (e as { type?: string }).type === 'qa.verdict')
    expect(verdictEvents).toHaveLength(1)
    expect((verdictEvents[0] as { message: string }).message).toContain('审片跳过')

    const qaStage = service.readProjection('project-1', runId).stages.find((s) => s.stageId === 'qa')
    expect(qaStage?.status).toBe('completed')
    expect((qaStage as { qaSummary?: string })?.qaSummary).toContain('审片跳过')
  })
})

describe('buildQaStageOutcome / adoptedGenerationShotNodeIds（纯逻辑）', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('无镜头 / 主动跳过 → 单条审片跳过事件，不误报为全过', () => {
    expect(buildQaStageOutcome(null)).toMatchObject({ events: [{ summary: expect.stringContaining('审片跳过') }] })
    expect(buildQaStageOutcome({ skipped: true, skipReason: '关了' }).stageSummary).toContain('关了')
    expect(buildQaStageOutcome({ reviewedShotIds: [], verdicts: [] }).events).toHaveLength(1)
  })

  it('全部过检 / 有红标 → 每镜一条事件 + 总览摘要', () => {
    const allPass = buildQaStageOutcome({ reviewedShotIds: ['a', 'b'], verdicts: [
      { shotNodeId: 'a', passed: true }, { shotNodeId: 'b', passed: true },
    ] })
    expect(allPass.events).toHaveLength(2)
    expect(allPass.stageSummary).toContain('全部过检')

    const withFlag = buildQaStageOutcome({ reviewedShotIds: ['a', 'b'], verdicts: [
      { shotNodeId: 'a', passed: true, shotTitle: '开场' },
      { shotNodeId: 'b', passed: false, shotTitle: '结尾', flagged: [{ dimensionName: '构图', score: 1, reason: '机位错' }] },
    ] })
    expect(withFlag.events.map((e) => e.summary)).toEqual([
      expect.stringContaining('开场：审片通过'),
      expect.stringMatching(/结尾：审片红标.*构图.*机位错/),
    ])
    expect(withFlag.stageSummary).toMatch(/1\/2 镜过检.*1 镜红标.*构图/)
  })

  it('只收 adopted 的 generate 镜头、去重保序、丢空 nodeId', () => {
    const run = { jobs: [
      { stageId: 'generate', status: 'adopted', nodeId: 'shot-1' },
      { stageId: 'generate', status: 'adopted', nodeId: 'shot-1' }, // 重复
      { stageId: 'generate', status: 'submitting', nodeId: 'shot-2' }, // 未 adopted
      { stageId: 'assemble', status: 'adopted', nodeId: 'timeline' }, // 非 generate
      { stageId: 'generate', status: 'adopted', nodeId: '  ' }, // 空
      { stageId: 'generate', status: 'adopted', nodeId: 'shot-3' },
    ] } as unknown as Parameters<typeof adoptedGenerationShotNodeIds>[0]
    expect(adoptedGenerationShotNodeIds(run)).toEqual(['shot-1', 'shot-3'])
  })

  it('只为低分镜头生成定向重试计划，并受 attempt 与预算双重边界限制', () => {
    const run = {
      policy: { maxAttemptsPerJob: 1 },
      budget: { authorized: 1, reserved: 0, actual: 0, unsettled: 0 },
      jobs: [{ jobId: 'job:a', stageId: 'generate', nodeId: 'a', attempt: 0, updatedAt: '2026-01-01T00:00:00.000Z' },
        { jobId: 'job:b', stageId: 'generate', nodeId: 'b', attempt: 0, updatedAt: '2026-01-01T00:00:00.000Z' }],
    } as unknown as Parameters<typeof buildQaRetryPlans>[0]
    const plans = buildQaRetryPlans(run, [
      { shotNodeId: 'a', passed: false, flagged: [{ dimensionName: '身份', score: 2, reason: '换脸' }] },
      { shotNodeId: 'b', passed: false, flagged: [{ dimensionName: '构图', score: 0, reason: '无法判定' }] },
    ])
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ shotNodeId: 'a', eligible: true, retryCount: 1, nextAttempt: 1 })
    expect(plans[0].retryDirective).toContain('身份')

    const exhausted = buildQaRetryPlans({ ...run, budget: { ...run.budget, reserved: 1 } }, [
      { shotNodeId: 'a', passed: false, flagged: [{ dimensionName: '身份', score: 2 }] },
    ])
    expect(exhausted[0]).toMatchObject({ eligible: false, blockedReason: 'budget_exhausted' })

    const atLimit = buildQaRetryPlans({ ...run, jobs: [{ ...run.jobs[0], attempt: 1 }] }, [
      { shotNodeId: 'a', passed: false, flagged: [{ dimensionName: '身份', score: 2 }] },
    ])
    expect(atLimit[0]).toMatchObject({ eligible: false, blockedReason: 'attempt_limit' })
  })
})
