import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildMaterializeShotsPayload, canvasLandingOperationId, landCanvasForRun } from './multiShotCanvasLanding'
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
    policy: { mode: 'balanced', trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 100, reserved: 0, actual: 0, unsettled: 0 }, planVersion: 1, snapshotCursor: 0,
    stages: [], gates: [], jobs, artifacts,
    generationPlan: { operationId: 'run-1', state: 'submitted', candidate: shots[0].candidate, shots, updatedAt: NOW },
    createdAt: NOW, updatedAt: NOW, brief: { goal: '雨夜便利店' },
  }
}

describe('buildMaterializeShotsPayload', () => {
  it('只投 included 的锚+镜；确认即落时无 result（还没生成）', () => {
    const r = run([
      shot('a1', { role: 'anchor' }),
      shot('s1', { role: 'shot' }),
      shot('s2', { role: 'shot', included: false }), // 未勾选 → 不投
    ])
    const payload = buildMaterializeShotsPayload(r, { projectRoot: '/tmp/x', previewSecret: 'secret', planName: '雨夜便利店' })
    expect(payload).not.toBeNull()
    expect(payload!.shots.map((s) => s.shotId)).toEqual(['a1', 's1'])
    expect(payload!.shots.every((s) => s.result === undefined)).toBe(true)
    expect(payload!.materializationOperationId).toBe(canvasLandingOperationId('run-1'))
    expect(payload!.groupName).toBe('分镜组·雨夜便利店')
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
    const payload = buildMaterializeShotsPayload(r, { projectRoot, previewSecret: 'secret' })
    const s1 = payload!.shots.find((s) => s.shotId === 's1')
    expect(s1?.result?.url.startsWith('nomi-local://')).toBe(true)
    expect(s1?.result?.type).toBe('video')
    fs.rmSync(projectRoot, { recursive: true, force: true })
  })

  it('单镜 semantic plan 没有 shots[] 时仍投影一个真实图片占位', () => {
    expect(buildMaterializeShotsPayload(run([shot('s1', { included: false })]), { projectRoot: '/tmp/x', previewSecret: 's' })).toBeNull()
    const catCandidate = { ...shot('cat').candidate, mode: 'text_to_image', prompt: '一只可爱的橘色小猫头像' }
    const noShots = run([shot('cat', { candidate: catCandidate })])
    noShots.generationPlan = { ...noShots.generationPlan!, shots: undefined }
    const payload = buildMaterializeShotsPayload(noShots, { projectRoot: '/tmp/x', previewSecret: 's' })
    expect(payload?.shots).toHaveLength(1)
    expect(payload?.shots[0]).toMatchObject({ shotId: 'cat', kind: 'image', title: '一只可爱的橘色小猫头像' })
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

    const payload = buildMaterializeShotsPayload(single, { projectRoot, previewSecret: 'secret' })
    expect(payload?.shots[0]?.shotId).toBe('cat')
    expect(payload?.shots[0]?.result?.url.startsWith('nomi-local://')).toBe(true)
    fs.rmSync(projectRoot, { recursive: true, force: true })
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
      previewSecret: 'secret',
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
      previewSecret: 'secret',
      isCurrent: () => current,
    })
    expect(result).toBe(false)
    expect(bindShotNodes).not.toHaveBeenCalled()
  })
})
