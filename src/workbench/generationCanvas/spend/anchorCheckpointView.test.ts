import { describe, expect, it } from 'vitest'

import type { ProductionRun } from '../../../../electron/productionRun/productionRunTypes'
import { buildAnchorCheckpointCard } from './anchorCheckpointView'

// P4 §3.2 形象确认卡投影的纯核测试：门 jobIds → 锚 job → shot(名称/reuse) + artifact(缩略图) 谱系正确、
// 缩略图缺失/越界不伪造图、shotId 缺失的锚被跳过（不放点了没反应的卡）、镜数/新拍数只算 included 非锚镜。

function anchorJob(jobId: string, shotId: string) {
  return {
    jobId, stageId: 'generate', status: 'ready' as const, attempt: 1,
    provider: 'apimart', model: 'image-model', idempotencyKey: `${jobId}:1`,
    metadata: { shotId },
    createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  }
}

function imageArtifact(jobId: string, rel: string, status: 'ready' | 'adopted' = 'ready') {
  return {
    artifactId: `art-${jobId}`, stageId: 'generate', jobId, kind: 'image' as const, status,
    projectRelativePath: rel, thumbnailRelativePath: rel,
    createdAt: '2026-08-25T00:00:00.000Z',
  }
}

function run(overrides: Partial<ProductionRun> = {}): ProductionRun {
  return {
    schemaVersion: 1, runId: 'op-batch', projectId: 'project-1', revision: 3,
    status: 'running', stageId: 'generate',
    playbook: { name: 'brand.promo', version: '1.0.0' }, origin: { host: 'nomi' },
    policy: { mode: 'balanced', trustedHosts: ['nomi'], allowedProviders: ['apimart'], allowedModels: ['image-model', 'video-model'], maxSpend: 30, maxAttemptsPerJob: 2, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 18, reserved: 0, actual: 0, unsettled: 0 },
    planVersion: 1, snapshotCursor: 3, stages: [], gates: [],
    jobs: [
      anchorJob('job-anchor-1', 'anchor-1'),
      anchorJob('job-anchor-2', 'anchor-2'),
    ],
    artifacts: [
      imageArtifact('job-anchor-1', '.nomi/out/anchor-1.png'),
      imageArtifact('job-anchor-2', '.nomi/out/anchor-2.png'),
    ],
    generationPlan: {
      operationId: 'op-batch', state: 'sealed',
      candidate: { candidateId: 'c0', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'image-model', mode: 'text-to-image', prompt: '', parameters: {}, references: [] },
      shots: [
        { shotId: 'anchor-1', role: 'anchor', candidate: { candidateId: 'c1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'image-model', mode: 'text-to-image', prompt: '男生 · 阿澈 的定妆照', parameters: {}, references: [] }, updatedAt: '2026-08-25T00:00:00.000Z' },
        { shotId: 'anchor-2', role: 'anchor', candidate: { candidateId: 'c2', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'image-model', mode: 'text-to-image', prompt: '女生 · 小满', parameters: {}, references: [] }, updatedAt: '2026-08-25T00:00:00.000Z' },
        { shotId: 'shot-1', role: 'shot', candidate: { candidateId: 'c3', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video-model', mode: 'image-to-video', prompt: '雨夜推门', parameters: {}, references: [] }, updatedAt: '2026-08-25T00:00:00.000Z' },
        { shotId: 'shot-2', role: 'shot', candidate: { candidateId: 'c4', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video-model', mode: 'image-to-video', prompt: '货架对视', parameters: {}, references: [] }, updatedAt: '2026-08-25T00:00:00.000Z' },
      ],
      updatedAt: '2026-08-25T00:00:00.000Z',
    },
    createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  }
}

const gate = { gateId: 'gate-anchor-checkpoint-op-batch', jobIds: ['job-anchor-1', 'job-anchor-2'] }

describe('buildAnchorCheckpointCard', () => {
  it('maps gate jobIds → anchors with name/roleLabel/thumbnail; shotCount/fresh count only included non-anchor shots', () => {
    const model = buildAnchorCheckpointCard(run(), gate)!
    expect(model).not.toBeNull()
    expect(model.gateId).toBe('gate-anchor-checkpoint-op-batch')
    expect(model.projectId).toBe('project-1')
    expect(model.approvedBudget).toBe(18)
    expect(model.budgetCurrency).toBe('CNY')
    expect(model.shotCount).toBe(2) // 2 included video shots (anchors excluded)
    expect(model.anchors).toHaveLength(2)

    const [a1, a2] = model.anchors
    expect(a1.shotId).toBe('anchor-1')
    expect(a1.name).toBe('阿澈') // 「男生 · 」前缀入 roleLabel、「的定妆照」尾巴剥掉
    expect(a1.roleLabel).toBe('男生')
    expect(a1.thumbnailUrl).toBe('nomi-local://asset/project-1/.nomi/out/anchor-1.png')
    expect(a1.reused).toBe(false) // origin/main 无 reuse 真相源 → 默认全「新拍」
    expect(a2.name).toBe('小满')
    expect(a2.roleLabel).toBe('女生')

    expect(model.freshCount).toBe(2)
    expect(model.reusedCount).toBe(0)
  })

  // ── 复用真相源（#161 语义）────────────────────────────────────────────────
  // 复用一个已有形象 = 把项目已有资产作 character 参考挂到视频镜的 references[]，**不是 role:'anchor' 的 shot**。
  // 故复用形象不进门 jobIds；view 从 references 侧补出不可重拍的复用条目。

  /** 给视频镜挂一个复用的 character 参考（模拟「用已有锚开新计划」）。 */
  function withReusedRefs(assetIdsPerShot: string[][]): ProductionRun {
    const base = run()
    const shots = base.generationPlan!.shots!.map((shot) => {
      if (shot.role === 'anchor') return shot
      const index = shot.shotId === 'shot-1' ? 0 : 1
      const ids = assetIdsPerShot[index] ?? []
      return {
        ...shot,
        candidate: {
          ...shot.candidate,
          references: ids.map((assetId) => ({ assetId, contentHash: `hash-${assetId}`, version: 1, kind: 'image' as const, role: 'character' as const })),
        },
      }
    })
    return run({ generationPlan: { ...base.generationPlan!, shots } })
  }

  it('counts reused looks from the video shots’ character references (they have no gate entry of their own)', () => {
    // 两镜引用同一张已有资产 → 复用 1（去重），新拍仍是门里那 2 张。
    const model = buildAnchorCheckpointCard(withReusedRefs([['asset-lastseason'], ['asset-lastseason']]), gate)!
    expect(model.reusedCount).toBe(1)
    expect(model.freshCount).toBe(2)
    // 复用形象没有自己的 job，但卡上仍要如实显示「复用上集」徽标；它不能走重拍链。
    expect(model.anchors).toHaveLength(3)
    expect(model.anchors.filter((anchor) => anchor.reused)).toEqual([
      expect.objectContaining({ sourceAssetId: 'asset-lastseason', canRework: false }),
    ])
    expect(model.anchors.filter((anchor) => !anchor.reused).every((anchor) => anchor.canRework)).toBe(true)
  })

  it('dedupes reused assetIds across shots and ignores non-character references', () => {
    const two = buildAnchorCheckpointCard(withReusedRefs([['asset-a'], ['asset-b']]), gate)!
    expect(two.reusedCount).toBe(2)
    expect(two.anchors.filter((anchor) => anchor.reused).map((anchor) => anchor.sourceAssetId)).toEqual(['asset-a', 'asset-b'])

    // first_frame/reference 这类不是「复用形象」，不计入。
    const base = run()
    const shots = base.generationPlan!.shots!.map((shot) =>
      shot.role === 'anchor'
        ? shot
        : { ...shot, candidate: { ...shot.candidate, references: [{ assetId: 'asset-ff', contentHash: 'h', version: 1, kind: 'image' as const, role: 'first_frame' as const }] } },
    )
    const model = buildAnchorCheckpointCard(run({ generationPlan: { ...base.generationPlan!, shots } }), gate)!
    expect(model.reusedCount).toBe(0)
  })

  it('excludes references carried by shots the user unchecked (not part of this batch)', () => {
    const base = run()
    const shots = base.generationPlan!.shots!.map((shot) =>
      shot.role === 'anchor'
        ? shot
        : { ...shot, included: false, candidate: { ...shot.candidate, references: [{ assetId: 'asset-skipped', contentHash: 'h', version: 1, kind: 'image' as const, role: 'character' as const }] } },
    )
    const model = buildAnchorCheckpointCard(run({ generationPlan: { ...base.generationPlan!, shots } }), gate)!
    expect(model.reusedCount).toBe(0)
    expect(model.shotCount).toBe(0)
  })

  it('thumbnail null when the anchor artifact is missing or the path is unsafe (never fabricates an image)', () => {
    const noArt = run({ artifacts: [] })
    const model = buildAnchorCheckpointCard(noArt, gate)!
    expect(model.anchors[0].thumbnailUrl).toBeNull()

    const unsafe = run({ artifacts: [imageArtifact('job-anchor-1', '../escape.png'), imageArtifact('job-anchor-2', '/abs/x.png')] })
    const m2 = buildAnchorCheckpointCard(unsafe, gate)!
    expect(m2.anchors[0].thumbnailUrl).toBeNull()
    expect(m2.anchors[1].thumbnailUrl).toBeNull()
  })

  it('skips a gate jobId whose job carries no shotId (would be a card that does nothing on rework)', () => {
    const bad = run({
      jobs: [
        { jobId: 'job-anchor-1', stageId: 'generate', status: 'ready', attempt: 1, provider: 'apimart', model: 'image-model', idempotencyKey: 'x', createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' },
        anchorJob('job-anchor-2', 'anchor-2'),
      ],
    })
    const model = buildAnchorCheckpointCard(bad, gate)!
    expect(model.anchors).toHaveLength(1)
    expect(model.anchors[0].shotId).toBe('anchor-2')
  })

  it('returns null when no gate jobId resolves to a shot (defensive; normally never happens)', () => {
    const model = buildAnchorCheckpointCard(run(), { gateId: gate.gateId, jobIds: ['job-nope'] })
    expect(model).toBeNull()
  })

  it('approvedBudget null when the ledger authorized nothing (does not fabricate a money figure)', () => {
    const model = buildAnchorCheckpointCard(run({ budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 } }), gate)!
    expect(model.approvedBudget).toBeNull()
  })
})
