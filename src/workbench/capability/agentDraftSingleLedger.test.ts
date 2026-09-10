// 「agent 草稿单一账本」的回归测试（2026-09-10 真机 bug）。
//
// 症状三件套：① agent 说草稿已建，画布上没节点（重开项目才冒出来）；② 冒出来的节点模型/提示词
// 与 agent 定的不一致；③ agent 重试堆出重复节点。三件的共同类根因是「候选是意图，节点是它的投影」
// 这条不变量没有 owner——落地报文不带模型身份、去重判据散在调用方。
//
// 这里钉的是**渲染半**：落地报文带上候选身份后，节点必须以候选为准；同 op 重放必须幂等。
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../generationCanvas/agent/availableModels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../generationCanvas/agent/availableModels')>()),
  listAvailableModelsForAgent: vi.fn(async () => [
    {
      modelKey: 'agent-picked-model',
      modelAlias: null,
      vendor: 'agent-picked-vendor',
      label: 'Agent picked model',
      kind: 'image' as const,
      defaultModeId: 'chat',
      modes: [{ modeId: 'chat', vendorTerm: '对话', intent: '', hint: '', params: [], slots: [] }],
    },
  ]),
}))

import { materializeShots } from './multiShotCanvasLanding'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { resetClientIdRegistry } from '../generationCanvas/agent/applyCanvasToolCall'
import { CANDIDATE_META_KEYS } from '../generationCanvas/agent/candidateNodeMeta'

const OPERATION_ID = 'canvas-landing:run-draft-1'

function draftShot(revision: number, prompt: string, modelKey = 'agent-picked-model') {
  return {
    shotId: 'shot-1',
    role: 'shot' as const,
    kind: 'image' as const,
    title: '镜头 1',
    prompt,
    candidate: {
      candidateId: 'candidate-1',
      revision,
      vendor: 'agent-picked-vendor',
      modelKey,
      modeId: 'chat',
      mode: 'text_to_image',
    },
  }
}

function landedNodes() {
  return useGenerationCanvasStore
    .getState()
    .nodes.filter((node) => (node.meta as Record<string, unknown> | undefined)?.materializationOperationId === OPERATION_ID)
}

describe('agent draft lands on the canvas as one ledger', () => {
  beforeEach(() => {
    resetClientIdRegistry()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
  })

  it('建草稿即落：节点当场存在，且 meta.modelKey 就是候选选的那个（不是渲染层另挑的默认）', async () => {
    const result = await materializeShots({
      materializationOperationId: OPERATION_ID,
      runId: 'run-draft-1',
      shots: [draftShot(1, '一只猫在窗台上')],
    })

    expect(result.createdNodeIds).toHaveLength(1)
    const [node] = landedNodes()
    expect(node).toBeTruthy()
    const meta = node.meta as Record<string, unknown>
    expect(meta.modelKey).toBe('agent-picked-model')
    expect(meta.modelVendor).toBe('agent-picked-vendor')
    expect(node.prompt).toBe('一只猫在窗台上')
    // 候选来源戳：节点从此知道自己是谁的意图（自愈 effect 据此不静默改写）。
    expect(meta[CANDIDATE_META_KEYS.candidateId]).toBe('candidate-1')
    expect(meta[CANDIDATE_META_KEYS.candidateRevision]).toBe(1)
    // bindings 回给主进程的 provider/model 也必须是候选那一份（主进程据此写回 Run）。
    expect(result.bindings[0]).toMatchObject({ provider: 'agent-picked-vendor', model: 'agent-picked-model' })
  })

  it('改草稿（generation.patch）：revision 变新 → 已落节点的 prompt 与模型同步', async () => {
    await materializeShots({
      materializationOperationId: OPERATION_ID,
      runId: 'run-draft-1',
      shots: [draftShot(1, '第一版提示词')],
    })
    const before = landedNodes()[0].id

    await materializeShots({
      materializationOperationId: OPERATION_ID,
      runId: 'run-draft-1',
      shots: [{ ...draftShot(2, '改过的提示词'), title: '镜头 1 改' }],
    })

    const after = landedNodes()
    expect(after).toHaveLength(1)
    // 重绑定改的是**同一个节点**，不是再建一个。
    expect(after[0].id).toBe(before)
    expect(after[0].prompt).toBe('改过的提示词')
    expect(after[0].title).toBe('镜头 1 改')
    expect((after[0].meta as Record<string, unknown>)[CANDIDATE_META_KEYS.candidateRevision]).toBe(2)
  })

  it('打开项目补齐（revision 没变的幂等重放）：不覆盖用户在画布上的手改', async () => {
    await materializeShots({
      materializationOperationId: OPERATION_ID,
      runId: 'run-draft-1',
      shots: [draftShot(1, 'agent 写的提示词')],
    })
    const nodeId = landedNodes()[0].id
    useGenerationCanvasStore.getState().updateNode(nodeId, { prompt: '用户自己改过的提示词' })

    await materializeShots({
      materializationOperationId: OPERATION_ID,
      runId: 'run-draft-1',
      shots: [draftShot(1, 'agent 写的提示词')],
    })

    expect(landedNodes()[0].prompt).toBe('用户自己改过的提示词')
  })

  it('agent 重试同一份草稿：不堆重复节点（幂等判据归写边界）', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await materializeShots({
        materializationOperationId: OPERATION_ID,
        runId: 'run-draft-1',
        shots: [draftShot(1, '一只猫在窗台上')],
      })
    }
    expect(landedNodes()).toHaveLength(1)
  })

  it('候选的模型此刻不可用：保留 agent 的意图戳，不悄悄换成别的模型', async () => {
    await materializeShots({
      materializationOperationId: OPERATION_ID,
      runId: 'run-draft-1',
      shots: [draftShot(1, '一只猫', 'model-not-in-catalog')],
    })
    const meta = landedNodes()[0].meta as Record<string, unknown>
    // 不在可用清单 → 不写 modelKey（写了就是编一个身份），但候选戳仍在，用户看得到 agent 要的是哪个。
    expect(meta.modelKey).toBeUndefined()
    expect(meta[CANDIDATE_META_KEYS.candidateModelKey]).toBe('model-not-in-catalog')
    expect(meta[CANDIDATE_META_KEYS.candidateModelVendor]).toBe('agent-picked-vendor')
  })
})
