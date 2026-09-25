import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildMaterializeShotsPayload, canvasLandingOperationId, landCanvasForRun, materializeShotsSignature } from './multiShotCanvasLanding'
import type { ProductionRun, ProductionJob, ProductionGenerationShot, ProductionArtifact } from './productionRunTypes'

// P4 S5 — 从 Run 投影出 materialize-shots 载荷（确认即落只投占位；打开项目补齐带上已完成 result）。

const NOW = '2026-08-25T00:00:00.000Z'

function shot(shotId: string, extra: Partial<ProductionGenerationShot> = {}): ProductionGenerationShot {
  return {
    shotId,
    candidate: { candidateId: shotId, revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: `画面 ${shotId}`, parameters: {}, references: [] },
    updatedAt: NOW, ...extra,
  }
}

function run(shots: ProductionGenerationShot[], jobs: ProductionJob[] = [], artifacts: ProductionArtifact[] = []): ProductionRun {
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'proj-1', revision: 1, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'semantic-mcp' },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 }, planVersion: 1, snapshotCursor: 0,
    stages: [], gates: [], jobs, artifacts,
    generationPlan: { operationId: 'run-1', state: 'submitted', candidate: shots[0].candidate, shots, updatedAt: NOW },
    createdAt: NOW, updatedAt: NOW, brief: { goal: '雨夜便利店' },
  }
}

describe('buildMaterializeShotsPayload', () => {
  it('投影完整草稿，included 仅决定付费批次；未生成时无 result', () => {
    const r = run([
      shot('a1', { role: 'anchor' }),
      shot('s1', { role: 'shot' }),
      shot('s2', { role: 'shot', included: false }), // 未纳入当前批次，草稿仍可见
    ])
    const payload = buildMaterializeShotsPayload(r, { projectRoot: '/tmp/x', planName: '雨夜便利店' })
    expect(payload).not.toBeNull()
    expect(payload!.shots.map((s) => s.shotId)).toEqual(['a1', 's1', 's2'])
    expect(payload!.shots.every((s) => s.result === undefined)).toBe(true)
    expect(payload!.materializationOperationId).toBe(canvasLandingOperationId('run-1'))
    expect(payload!.planName).toBe('雨夜便利店')
    // 组名由渲染层按 i18n 拼；主进程不再发任何面向用户的文案（英文用户不该看到中文组名）。
    expect(payload).not.toHaveProperty('groupName')
    // anchor → image kind + referenceSheet 语义（role）；镜 → video。
    expect(payload!.shots.find((s) => s.shotId === 'a1')?.kind).toBe('image')
    expect(payload!.shots.find((s) => s.shotId === 's1')?.kind).toBe('video')
  })

  it('已完成镜（ready + 本地 artifact）带上 nomi-local:// result（补齐回填）', () => {
    // createArtifactProjection 会 resolveOwnedArtifactFile 校验文件真实存在（拒越界/符号链接）→ 写真文件。
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-s5-landing-'))
    const rel = '.nomi/runs/run-1/shot-s1.mp4'
    fs.mkdirSync(path.dirname(path.join(projectRoot, rel)), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, rel), 'fake-mp4')
    const jobs: ProductionJob[] = [{ jobId: 'job-s1', stageId: 'generate', status: 'ready', attempt: 1, provider: 'apimart', model: 'video', idempotencyKey: 'k', metadata: { shotId: 's1' }, createdAt: NOW, updatedAt: NOW }]
    const artifacts: ProductionArtifact[] = [{ artifactId: 'art-1', stageId: 'generate', jobId: 'job-s1', kind: 'video', status: 'ready', version: 1, projectRelativePath: rel, createdAt: NOW }]
    const r = run([shot('s1', { role: 'shot' })], jobs, artifacts)
    const payload = buildMaterializeShotsPayload(r, { projectRoot })
    const s1 = payload!.shots.find((s) => s.shotId === 's1')
    expect(s1?.result?.url.startsWith('nomi-local://')).toBe(true)
    expect(s1?.result?.type).toBe('video')
    fs.rmSync(projectRoot, { recursive: true, force: true })
  })

  it('单镜 semantic plan 没有 shots[] 时仍投影一个真实图片占位', () => {
    expect(buildMaterializeShotsPayload(run([shot('s1', { included: false })]), { projectRoot: '/tmp/x' })?.shots).toHaveLength(1)
    const catCandidate = { ...shot('cat').candidate, mode: 'text_to_image', prompt: '一只可爱的橘色小猫头像' }
    const noShots = run([shot('cat', { candidate: catCandidate })])
    noShots.generationPlan = { ...noShots.generationPlan!, shots: undefined }
    const payload = buildMaterializeShotsPayload(noShots, { projectRoot: '/tmp/x' })
    expect(payload?.shots).toHaveLength(1)
    expect(payload?.shots[0]).toMatchObject({ shotId: 'cat', kind: 'image', title: '一只可爱的橘色小猫头像' })
  })

  // 2026-09-22 下午用户拍板：报价卡上的 × **只收回这一次出价**（「节点和草稿都留着」）。
  // 计划回到 `draft` / 未 present（`cardHidden`），所以落地这一侧一个字不变——占位照旧在画布上，
  // 用户说一句「还是生成吧」就能对同一份草稿重新出价。
  //
  // 当天上午那一版把 × 落成 `cancelled + cancelReason:"declined"`，并在这里加了一条「不投影」。
  // 它在 33 镜的计划上说不通：卡上只摆 3 镜，× 终结整份计划，另外 30 个占位成了孤儿。已随裁决删。
  it('× 收回出价之后计划回到未 present 的 draft：占位照旧投影，一个不少', () => {
    const multi = run([shot('s1'), shot('s2')])
    multi.generationPlan = { ...multi.generationPlan!, state: 'draft', cardHidden: true }
    expect(buildMaterializeShotsPayload(multi, { projectRoot: '/tmp/x' })?.shots).toHaveLength(2)
    const single = run([shot('cat')])
    single.generationPlan = { ...single.generationPlan!, shots: undefined, state: 'draft', cardHidden: true }
    expect(buildMaterializeShotsPayload(single, { projectRoot: '/tmp/x' })?.shots).toHaveLength(1)
  })

  it('阳性对照：真终态（用户删了这份草稿）照旧投影——落地不看 cancelled，那一格由别处管', () => {
    const cancelled = run([shot('s1')])
    cancelled.generationPlan = { ...cancelled.generationPlan!, state: 'cancelled' }
    expect(buildMaterializeShotsPayload(cancelled, { projectRoot: '/tmp/x' })?.shots).toHaveLength(1)
  })

  it('单镜默认 job 没有 shot metadata 时仍把已物化结果带回同一个占位', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-s5-single-landing-'))
    const rel = '.nomi/runs/run-1/single.png'
    fs.mkdirSync(path.dirname(path.join(projectRoot, rel)), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, rel), 'fake-png')
    const catCandidate = { ...shot('cat').candidate, mode: 'text_to_image', prompt: '一只可爱的橘色小猫头像' }
    const single = run([shot('cat', { candidate: catCandidate })])
    single.generationPlan = { ...single.generationPlan!, shots: undefined }
    single.jobs = [{ jobId: 'job-single', stageId: 'generate', status: 'ready', attempt: 1, provider: 'apimart', model: 'image', idempotencyKey: 'k', createdAt: NOW, updatedAt: NOW }]
    single.artifacts = [{ artifactId: 'art-single', stageId: 'generate', jobId: 'job-single', kind: 'image', status: 'ready', version: 1, projectRelativePath: rel, createdAt: NOW }]

    const payload = buildMaterializeShotsPayload(single, { projectRoot })
    expect(payload?.shots[0]?.shotId).toBe('cat')
    expect(payload?.shots[0]?.result?.url.startsWith('nomi-local://')).toBe(true)
    fs.rmSync(projectRoot, { recursive: true, force: true })
  })
})

// 2026-09-25 用户报：Agent 付费卡建出的视频镜头一直转圈，视频其实早就出好了。
// 根因之一是「一镜在生成中」有两个 owner：节点自己的运行记录（普通生成）与渲染层另轮询的 Run 快照（制作）。
// 现在制作的运行状态也由这条投影写进节点的运行记录——投影必须把每一镜的真实段带过去。
describe('buildMaterializeShotsPayload projects each shot\'s run state onto its node', () => {
  const job = (shotId: string, status: ProductionJob['status'], extra: Partial<ProductionJob> = {}): ProductionJob => ({
    jobId: `job-${shotId}`, stageId: 'generate', status, attempt: 1, provider: 'apimart', model: 'video', idempotencyKey: `k-${shotId}`,
    metadata: { shotId }, createdAt: NOW, updatedAt: NOW, ...extra,
  })

  it('供应商受理后还在等结论的镜 → running（节点显示普通生成那张等待画面，不是另一套）', () => {
    const payload = buildMaterializeShotsPayload(run([shot('s1'), shot('s2')], [job('s1', 'polling')]), { projectRoot: null })
    const s1 = payload!.shots.find((s) => s.shotId === 's1')
    expect(s1?.generation).toEqual({ state: 'running', runRecordId: 'production-job-s1', startedAt: Date.parse(NOW) })
    // 还没派发的镜不是「生成中」（禁假进度）。
    expect(payload!.shots.find((s) => s.shotId === 's2')?.generation).toEqual({ state: 'ended' })
  })

  it('供应商拒了的镜 → failed（带人话原因，节点显示普通生成那张失败卡）；预算触顶 → ended（已停小标另管）', () => {
    const payload = buildMaterializeShotsPayload(run([shot('s1'), shot('s2')], [
      job('s1', 'needs_attention', { errorCode: 'provider_task_failed', errorMessage: '供应商拒绝了这次生成' }),
      job('s2', 'needs_attention', { errorCode: 'budget_exhausted' }),
    ]), { projectRoot: null })
    expect(payload!.shots.find((s) => s.shotId === 's1')?.generation)
      .toEqual({ state: 'failed', runRecordId: 'production-job-s1', startedAt: Date.parse(NOW), message: '供应商拒绝了这次生成' })
    expect(payload!.shots.find((s) => s.shotId === 's2')?.generation).toEqual({ state: 'ended' })
  })

  it('出片落盘的镜 → 带 result、不带 generation；result 用素材库的永久地址，不是 5 分钟过期的签名预览链', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-landing-asset-url-'))
    const rel = 'assets/generated/materialized/video-abc.mp4'
    const poster = 'assets/generated/materialized/video-abc-poster.png'
    fs.mkdirSync(path.dirname(path.join(projectRoot, rel)), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, rel), 'fake-mp4')
    fs.writeFileSync(path.join(projectRoot, poster), 'fake-png')
    try {
      const artifacts: ProductionArtifact[] = [{ artifactId: 'art-1', stageId: 'generate', jobId: 'job-s1', kind: 'video', status: 'ready', version: 1, projectRelativePath: rel, thumbnailRelativePath: poster, createdAt: NOW }]
      const payload = buildMaterializeShotsPayload(run([shot('s1')], [job('s1', 'ready')], artifacts), { projectRoot })
      const s1 = payload!.shots[0]
      expect(s1.generation).toBeUndefined()
      expect(s1.result).toEqual({
        id: 'production-job-s1', type: 'video',
        // 视频节点的 url 是**视频本身**，封面走 thumbnailUrl（以前两者都指向封面，而且 5 分钟后失效）。
        url: `nomi-local://asset/proj-1/${rel}`,
        thumbnailUrl: `nomi-local://asset/proj-1/${poster}`,
        createdAt: Date.parse(NOW),
      })
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('单镜计划（没有 shots[]）同一条规则：受理后 → running', () => {
    const single = run([shot('cat')], [job('ignored', 'polling', { metadata: {} })])
    single.generationPlan = { ...single.generationPlan!, candidate: shot('cat').candidate, shots: undefined }
    const payload = buildMaterializeShotsPayload(single, { projectRoot: null })
    expect(payload!.shots[0].generation).toMatchObject({ state: 'running', runRecordId: 'production-job-ignored' })
  })

  it('用户删掉的镜（canvasDetached）不投影：补齐 / 跟随都不把它复活', () => {
    const payload = buildMaterializeShotsPayload(run([shot('s1'), shot('s2', { canvasDetached: true })]), { projectRoot: null })
    expect(payload!.shots.map((s) => s.shotId)).toEqual(['s1'])
    expect(buildMaterializeShotsPayload(run([shot('s1', { canvasDetached: true })]), { projectRoot: null })).toBeNull()
  })

  it('指纹只看「绑到哪 / 结果是哪个 / 运行态」：同一份状态重投影指纹不变，状态一变指纹就变', () => {
    const polling = buildMaterializeShotsPayload(run([shot('s1')], [job('s1', 'polling')]), { projectRoot: null })!
    const pollingAgain = buildMaterializeShotsPayload(run([shot('s1')], [job('s1', 'polling', { lastPollAt: '2026-08-25T00:05:00.000Z' })]), { projectRoot: null })!
    const failed = buildMaterializeShotsPayload(run([shot('s1')], [job('s1', 'needs_attention', { errorCode: 'provider_task_failed' })]), { projectRoot: null })!
    expect(materializeShotsSignature(pollingAgain)).toBe(materializeShotsSignature(polling))
    expect(materializeShotsSignature(failed)).not.toBe(materializeShotsSignature(polling))
  })
})

describe('landCanvasForRun lifecycle guard', () => {
  it('does not touch the renderer when an observer has become stale', async () => {
    const requestRenderer = vi.fn()
    const bindShotNodes = vi.fn()
    const result = await landCanvasForRun(run([shot('s1')]), {
      requestRenderer,
      bindShotNodes,
      projectRoot: null,
      isCurrent: () => false,
    })
    expect(result).toBe(false)
    expect(requestRenderer).not.toHaveBeenCalled()
    expect(bindShotNodes).not.toHaveBeenCalled()
  })

  it('does not persist a stale node binding after the renderer response', async () => {
    let current = true
    const requestRenderer = vi.fn(async () => {
      current = false
      return { bindings: [{ shotId: 's1', nodeId: 'node-1' }] }
    })
    const bindShotNodes = vi.fn()
    const result = await landCanvasForRun(run([shot('s1')]), {
      requestRenderer,
      bindShotNodes,
      projectRoot: null,
      isCurrent: () => current,
    })
    expect(result).toBe(false)
    expect(bindShotNodes).not.toHaveBeenCalled()
  })
})
