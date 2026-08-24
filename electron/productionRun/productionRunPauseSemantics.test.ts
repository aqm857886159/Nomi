import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { createProductionRunRepository } from './productionRunRepository'
import { createProductionRunService } from './productionRunService'
import { approveLatestScript, approveLatestStoryboard, waitForProduction, PRODUCTION_DRIVER_TEST_TIMEOUT_MS } from './productionRunTestHelpers'

// 暂停的花钱语义（2026-08-11 用户质疑「中转已提交的收不回」后补的三洞修复）：
// ① 提交门：pausing/paused 后 driver 不再提交新任务（能守住的唯一花钱边界）；
// ② 收尾落停：在途任务跑完后 pausing 自动 settle 成 paused（不再永远卡 pausing）；
// ③ resume 重踢：恢复后剩余任务从断点继续提交，不重做不重付。
// 已提交的任务无法撤回=物理现实，测试同时断言它「跑完并保留产物」。

const WAIT_MS = 3000

describe('pause spend semantics (提交门 + 收尾落停 + resume 重踢)', { timeout: PRODUCTION_DRIVER_TEST_TIMEOUT_MS }, () => {
  it('两镜批次中途暂停：镜 2 不提交；镜 1 跑完保留；落 paused；resume 后镜 2 续跑到粗剪', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-pause-semantics-'))
    fs.mkdirSync(path.join(root, 'assets/generated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'assets/generated/shot.mp4'), 'video', 'utf8')

    let generateCalls = 0
    let releaseFirst!: () => void
    const firstJobParked = new Promise<void>((resolve) => { releaseFirst = resolve })
    // 提交顺序守护：driver 必须一次只在途一镜（顺序 for 循环）。并发化会悄悄放大喊停敞口 → 这里锁死。
    let inFlightGenerate = 0
    let maxConcurrentGenerate = 0
    const requestRenderer = async (op: string) => {
      if (op === 'production.plan-directions') {
        return { candidates: [
          { key: 'a', title: '方向一', oneLiner: 'x' },
          { key: 'b', title: '方向二', oneLiner: 'y' },
        ] }
      }
      if (op === 'production.plan-script') return { text: 'pause semantics script' }
      if (op === 'production.plan-storyboard') {
        return { plan: { title: 'promo', anchors: [], shots: [
          { index: 1, shotKind: 'video', prompt: 'shot one' },
          { index: 2, shotKind: 'video', prompt: 'shot two' },
        ] } }
      }
      if (op === 'production.generate-node') {
        generateCalls += 1
        inFlightGenerate += 1
        maxConcurrentGenerate = Math.max(maxConcurrentGenerate, inFlightGenerate)
        try {
          if (generateCalls === 1) await firstJobParked // 镜 1 停在「已提交、供应商在跑」的窗口期
          return { assets: [{ type: 'video', url: 'nomi-local://asset/project-1/assets/generated/shot.mp4' }] }
        } finally {
          inFlightGenerate -= 1
        }
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
    const runId = 'run-pause-1'
    service.createDraft({
      runId, projectId: 'project-1', playbook: { name: 'brand.promo', version: '1.0.0' },
      origin: { host: 'codex' }, brief: { goal: 'pause semantics', durationSeconds: 30 },
    })
    await service.command('project-1', runId, {
      commandId: 'direction', expectedRevision: 0, type: 'gate.decide',
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

    // 镜 1 已提交（driver 停在供应商窗口期），此刻用户喊停。
    await waitForProduction(() => generateCalls === 1, WAIT_MS)
    const midFlight = service.readFull('project-1', runId)!
    const paused = await service.command('project-1', runId, {
      commandId: 'user-pause', expectedRevision: midFlight.revision, type: 'run.control',
      payload: { action: 'pause' }, issuedAt: new Date().toISOString(),
    })
    expect(paused.run.status).toBe('pausing') // 有在途任务 → 停在 pausing，不谎称已停

    releaseFirst() // 供应商跑完镜 1（钱已花、结果保留）
    await waitForProduction(() => service.readFull('project-1', runId)!.status === 'paused', WAIT_MS)
    const settled = service.readFull('project-1', runId)!
    expect(generateCalls).toBe(1) // ① 提交门：镜 2 从未提交
    expect(settled.jobs.find((j) => j.nodeId === 'shot-1')?.status).toBe('adopted') // 已提交的跑完保留
    expect(settled.jobs.find((j) => j.nodeId === 'shot-2')?.status).toBe('authorized') // 未提交的原地待命
    expect(settled.artifacts.filter((a) => a.kind === 'video')).toHaveLength(1)

    // ③ resume 重踢：镜 2 续跑，全批完成走到粗剪审阅。
    await service.command('project-1', runId, {
      commandId: 'user-resume', expectedRevision: settled.revision, type: 'run.control',
      payload: { action: 'resume' }, issuedAt: new Date().toISOString(),
    })
    await waitForProduction(() => service.readFull('project-1', runId)!.status === 'awaiting_rough_cut_review', 5000)
    expect(generateCalls).toBe(2) // 不重做不重付：镜 1 没有被重新提交
    const done = service.readFull('project-1', runId)!
    expect(done.jobs.every((j) => j.status === 'adopted')).toBe(true)
    // B2 守护：全程在途最多一镜（顺序提交=喊停敞口恒为 1 镜）。并发化会让此断言变红。
    expect(maxConcurrentGenerate).toBe(1)
  })
})
