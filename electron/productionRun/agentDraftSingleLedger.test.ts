// 「agent 草稿单一账本」的**主进程半**（2026-09-10 真机 bug）。
//
// 三条不变量：
//   ① 落地报文必须带候选的模型身份（不带就等于让渲染层自己另挑一个 → 「agent 说的 ≠ 画布上的」）；
//   ② 报文**只带身份**，transportModelId 这类内部投影绝不许顺着 RPC 流出去；
//   ③ 草稿一建/一改就通知落地（同一条幂等链），不必等项目重开。
import { describe, expect, it, vi } from 'vitest'

import { buildMaterializeShotsPayload } from './multiShotCanvasLanding'
import { buildProductionRunDraftSummary, promptFirstLine } from './productionRunDraftSummary'
import { createProductionGenerationOperationStore } from './productionGenerationOperationStore'
import { createCanvasLandingHost } from './canvasLandingHost'
import type { PlanCandidate } from '../capabilityCore/executionContract'
import type { ProductionGenerationShot, ProductionRun } from './productionRunTypes'

const NOW = '2026-09-10T00:00:00.000Z'

function candidate(patch: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    candidateId: 'cand-1',
    revision: 3,
    moduleId: 'nomi.generation.single-shot',
    providerId: 'apimart',
    modelId: 'gpt-image-2',
    modeId: 't2i',
    mode: 'text_to_image',
    transportModelId: 'internal/gpt-image-2-wire',
    prompt: '雨夜便利店门口\n第二行不该出现在列表里',
    parameters: { aspect_ratio: '9:16' },
    references: [],
    ...patch,
  }
}

function shot(shotId: string, extra: Partial<ProductionGenerationShot> = {}): ProductionGenerationShot {
  return { shotId, candidate: candidate({ candidateId: shotId }), updatedAt: NOW, ...extra }
}

function run(patch: Partial<ProductionRun> = {}, shots?: ProductionGenerationShot[]): ProductionRun {
  return {
    schemaVersion: 1, runId: 'run-1', projectId: 'proj-1', revision: 1, status: 'draft', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1.0.0' }, origin: { host: 'semantic-mcp' },
    policy: { mode: 'balanced', trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0 }, planVersion: 1, snapshotCursor: 0,
    stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: {
      operationId: 'run-1',
      state: 'draft',
      candidate: candidate(),
      ...(shots ? { shots } : {}),
      updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
    ...patch,
  }
}

describe('materialize-shots wire carries the candidate model identity', () => {
  it('每一镜都带 vendor / modelKey / modeId / revision（节点模型从此以候选为准）', () => {
    const payload = buildMaterializeShotsPayload(run({}, [shot('a1', { role: 'anchor' }), shot('s1', { role: 'shot' })]), {
      projectRoot: null,
      previewSecret: 'secret',
    })
    expect(payload).not.toBeNull()
    for (const wire of payload!.shots) {
      expect(wire.candidate).toMatchObject({
        vendor: 'apimart',
        modelKey: 'gpt-image-2',
        modeId: 't2i',
        mode: 'text_to_image',
        revision: 3,
      })
    }
  })

  it('单镜草稿（shots[] 为空，候选在 plan 顶层）同样带身份', () => {
    const payload = buildMaterializeShotsPayload(run(), { projectRoot: null, previewSecret: 'secret' })
    expect(payload!.shots).toHaveLength(1)
    expect(payload!.shots[0].candidate?.modelKey).toBe('gpt-image-2')
  })

  it('绝不把 transportModelId（内部投影）或候选参数泄进 RPC 报文', () => {
    const payload = buildMaterializeShotsPayload(run({}, [shot('s1')]), { projectRoot: null, previewSecret: 'secret' })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('transportModelId')
    expect(serialized).not.toContain('internal/gpt-image-2-wire')
  })
})

describe('draft summary projection', () => {
  it('草稿态：投影模型 / 比例 / 提示词首行 / 镜数', () => {
    const summary = buildProductionRunDraftSummary(run({}, [shot('s1'), shot('s2'), shot('s3', { included: false })]))
    expect(summary).toMatchObject({
      vendor: 'apimart',
      modelKey: 'gpt-image-2',
      aspectRatio: '9:16',
      promptLine: '雨夜便利店门口',
      shotCount: 2,
    })
  })

  it('比例参数各家叫法不同（size / ratio / resolution）→ 按固定优先序 derive，取不到就省略而不是编一个', () => {
    expect(buildProductionRunDraftSummary(run({
      generationPlan: { operationId: 'run-1', state: 'draft', candidate: candidate({ parameters: { size: '1024x1536' } }), updatedAt: NOW },
    }))?.aspectRatio).toBe('1024x1536')
    expect(buildProductionRunDraftSummary(run({
      generationPlan: { operationId: 'run-1', state: 'draft', candidate: candidate({ parameters: {} }), updatedAt: NOW },
    }))?.aspectRatio).toBeUndefined()
  })

  it('已封存 / 无计划 → 不投影（那些状态另有自己的行文案）', () => {
    expect(buildProductionRunDraftSummary(run({
      generationPlan: { operationId: 'run-1', state: 'sealed', candidate: candidate(), updatedAt: NOW },
    }))).toBeUndefined()
    const noPlan = run()
    delete noPlan.generationPlan
    expect(buildProductionRunDraftSummary(noPlan)).toBeUndefined()
  })

  it('提示词首行跳过空行并裁剪长句', () => {
    expect(promptFirstLine('\n\n  真正的第一行  \n第二行')).toBe('真正的第一行')
    expect(promptFirstLine('x'.repeat(120))).toHaveLength(81)
  })
})

describe('draft lifecycle notifies the canvas landing', () => {
  function ownerFor(current: ProductionRun) {
    let state = current
    return {
      createGenerationDraft: vi.fn(() => state),
      readFull: vi.fn(() => state),
      command: vi.fn(async () => {
        state = { ...state, revision: state.revision + 1 }
        return { run: state }
      }),
    }
  }

  it('建草稿 → onPlanChanged 立刻触发（用户当场在画布上看到节点，不必重开项目）', async () => {
    const onPlanChanged = vi.fn()
    const owner = ownerFor(run())
    const store = createProductionGenerationOperationStore(owner as never, { onPlanChanged })
    await store.create({ operationId: 'run-1', projectId: 'proj-1', candidate: candidate(), now: NOW })
    expect(onPlanChanged).toHaveBeenCalledWith('proj-1', 'run-1')
  })

  it('改草稿 → 同样触发（重绑定已落节点的 prompt/模型）', async () => {
    const onPlanChanged = vi.fn()
    const owner = ownerFor(run())
    const store = createProductionGenerationOperationStore(owner as never, { onPlanChanged })
    await store.patch('proj-1', 'run-1', { prompt: '改过了' }, NOW)
    expect(onPlanChanged).toHaveBeenCalledWith('proj-1', 'run-1')
  })

  it('落地观察者抛错不许把草稿命令带崩（落地是 best-effort，§1 铁律）', async () => {
    const owner = ownerFor(run())
    const store = createProductionGenerationOperationStore(owner as never, {
      onPlanChanged: () => { throw new Error('renderer unavailable') },
    })
    expect(await store.create({ operationId: 'run-1', projectId: 'proj-1', candidate: candidate(), now: NOW })).toMatchObject({ operationId: 'run-1' })
  })
})

// 第四条不变量（2026-09-10 CI 的 C9 红）：**Nomi 自己的草稿投影不许作废用户的付费批准。**
//
// 机制：落地写画布 → 项目落盘 → project.revision 前进；而付费授权信封盖的就是 project.revision
// （收据只在它描述的那份项目文档还是当前版本时有效，approvalReceiptRuntime）。草稿落地是 fire-and-forget，
// 于是这次前进可能落在「封信封」与「用户点确认」之间，用户点了确认却被告知「此确认已失效」。
// 闸就一条：封信封前先等自家在飞的落地落完（settleCanvasLanding）。
// **用户自己改项目**照样作废收据——那是 #722 要的语义，这里不碰。
describe('付费信封与自家画布投影的先后', () => {
  const landingRun: ProductionRun = run({}, [shot('s1'), shot('s2')])

  function hostWith(requestRenderer: () => Promise<unknown>) {
    return createCanvasLandingHost({
      readRun: () => landingRun,
      command: async () => undefined,
      requestRenderer,
      resolveProjectRoot: () => '/tmp/nomi-proj',
      previewSecret: () => 'preview-secret',
      isProjectOpen: () => true,
    })
  }

  it('settleCanvasLanding 只在在飞的草稿落地真写完之后才放行', async () => {
    let releaseRenderer: () => void = () => {}
    const rendererGate = new Promise<void>((resolve) => { releaseRenderer = resolve })
    const order: string[] = []
    const host = hostWith(async () => {
      await rendererGate
      order.push('landed')
      return { bindings: [{ shotId: 's1', nodeId: 'node-1' }] }
    })

    host.landDraftOnCanvas('proj-1', 'run-1')
    const settled = host.settleCanvasLanding('proj-1').then(() => { order.push('sealed') })
    releaseRenderer()
    await settled

    // 顺序本身就是判据：闸先放行（['sealed','landed']）= 信封盖的是即将被自家写覆盖的旧 revision。
    expect(order).toEqual(['landed', 'sealed'])
  })

  it('落地失败也必须放行（best-effort 铁律：不许把付费闸挂死在渲染层上）', async () => {
    const host = hostWith(async () => { throw new Error('renderer unavailable') })
    host.landDraftOnCanvas('proj-1', 'run-1')
    await expect(host.settleCanvasLanding('proj-1')).resolves.toBeUndefined()
  })

  it('没有在飞的落地 → 立即放行（不给每次封信封加一次等待）', async () => {
    const host = hostWith(async () => ({ bindings: [] }))
    await expect(host.settleCanvasLanding('proj-untouched')).resolves.toBeUndefined()
  })
})
