import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, waitForProduction as waitFor } from './productionRunTestHelpers'
import { buildToolOutcome } from '../capabilityCore/mcpToolResults'

// B2 样片门 + 窗口化定档（plan 2026-08-11-mcp-conversation-native-phase-b）：
// 首镜落地后停一次样片门 → 剩余镜头在过目期间不提交（喊停最多亏样片这一镜）→
// 批准续跑到粗剪 / 否决暂停 run（改提示词后可继续，不作废已生成样片）。

function makeTwoShotRun(root: string, trackCalls: { count: number }) {
  fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
  fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')
  const requestRenderer = async (op: string) => {
    if (op === 'production.plan-directions') {
      return { candidates: [
        { key: 'a', title: '方向一', oneLiner: 'x' },
        { key: 'b', title: '方向二', oneLiner: 'y' },
      ] }
    }
    if (op === 'production.plan-script') return { text: 'sample gate script' }
    if (op === 'production.plan-storyboard') {
      return { plan: { title: 'promo', anchors: [], shots: [
        { index: 1, shotKind: 'video', prompt: 'shot one' },
        { index: 2, shotKind: 'video', prompt: 'shot two' },
      ] } }
    }
    if (op === 'production.generate-node') {
      trackCalls.count += 1
      return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
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

/** 走到「合同已批准、driver 已提第一镜」的公共前置。 */
async function driveToContract(service: ReturnType<typeof createProductionRunService>, runId: string) {
  service.createDraft({
    runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex' }, brief: { goal: 'sample gate', durationSeconds: 30 },
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
}

describe('sample gate (B2 · 首镜停门 + 窗口化)', () => {
  it('2 镜批次：镜 1 落地 → 样片门停 → 批准 → 镜 2 才提交 → 走到粗剪', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-sample-approve-'))
    const calls = { count: 0 }
    const service = makeTwoShotRun(root, calls)
    const runId = 'run-sample-1'
    await driveToContract(service, runId)

    // 首镜跑完 → 样片门 waiting；此刻镜 2 未提交（窗口化）。
    await waitFor(() => service.readFull('project-1', runId)!.gates.some((g) => g.gateId === 'gate-sample-v1' && g.status === 'waiting'))
    const atSample = service.readFull('project-1', runId)!
    expect(calls.count).toBe(1) // 只提交了镜 1
    expect(atSample.status).toBe('running') // run 保持 running + gate.waiting（不新增状态）
    expect(atSample.jobs.find((j) => j.nodeId === 'shot-1')?.status).toBe('adopted')
    expect(atSample.jobs.find((j) => j.nodeId === 'shot-2')?.status).toBe('authorized') // 未提交
    const sampleGate = atSample.gates.find((g) => g.gateId === 'gate-sample-v1')!
    expect(sampleGate.scope).toBe('stage')
    expect(sampleGate.jobIds).toEqual([]) // 不授权花钱，只呈现

    // MCP 转述：nomi_get_run 把「样片就绪、先过目再批量」摊给模型（终端看不了图，走深链）。
    const runProjection = service.readProjection('project-1', runId)
    const getRunNarration = buildToolOutcome('nomi_read', { target: 'run', projectId: 'project-1', runId }, runProjection, 'zh-CN')
    expect(getRunNarration.text).toContain('样片就绪')
    expect(getRunNarration.outcome).toMatchObject({ sampleGateId: 'gate-sample-v1', nextActions: ['review_sample'] })

    // 批准样片门 → driver 续跑镜 2 → 全批完成走到粗剪。
    await service.command('project-1', runId, {
      commandId: 'approve-sample', expectedRevision: atSample.revision, type: 'gate.decide',
      payload: { gateId: 'gate-sample-v1', status: 'approved' }, issuedAt: new Date().toISOString(),
    })
    await waitFor(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review')
    expect(calls.count).toBe(2) // 镜 2 提交了；镜 1 没重复提交
    const done = service.readFull('project-1', runId)!
    expect(done.jobs.every((j) => j.status === 'adopted')).toBe(true)
  })

  it('否决样片门 → run 暂停（改提示词后可继续，已生成样片不作废）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-sample-reject-'))
    const calls = { count: 0 }
    const service = makeTwoShotRun(root, calls)
    const runId = 'run-sample-2'
    await driveToContract(service, runId)

    await waitFor(() => service.readFull('project-1', runId)!.gates.some((g) => g.gateId === 'gate-sample-v1' && g.status === 'waiting'))
    const atSample = service.readFull('project-1', runId)!
    await service.command('project-1', runId, {
      commandId: 'reject-sample', expectedRevision: atSample.revision, type: 'gate.decide',
      payload: { gateId: 'gate-sample-v1', status: 'rejected' }, issuedAt: new Date().toISOString(),
    })
    // 否决 → run 落 paused（首镜无在途任务，直接落停）；镜 2 从未提交。
    await waitFor(() => service.readFull('project-1', runId)!.status === 'paused')
    const paused = service.readFull('project-1', runId)!
    expect(calls.count).toBe(1)
    expect(paused.gates.find((g) => g.gateId === 'gate-sample-v1')!.status).toBe('rejected')
    expect(paused.jobs.find((j) => j.nodeId === 'shot-1')?.status).toBe('adopted') // 样片保留不作废
    expect(paused.artifacts.filter((a) => a.kind === 'video')).toHaveLength(1)

    // MCP 转述：样片打回 → 「已暂停 + 样片保留 + 改提示词后可继续」，别让用户以为全废了。
    const rejectNarration = buildToolOutcome('nomi_run_gate', { action: 'decide', projectId: 'project-1', runId, gateId: 'gate-sample-v1', decision: 'rejected' }, service.readProjection('project-1', runId), 'zh-CN')
    expect(rejectNarration.text).toContain('样片打回')
    expect(rejectNarration.text).toContain('保留')
  })
})
