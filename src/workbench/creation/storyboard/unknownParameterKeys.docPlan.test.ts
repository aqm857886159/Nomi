// 文稿方案那条路上，模型写进 `parameters` 的未知键（设计卡 `docs/plan/2026-10-27-unknown-param-keys.md` §1.3）。
//
// 同一份写错的输入，文稿方案的三扇门待遇不一样：
//   · 建方案（create）、补镜头（extend）——先过主进程的写入准入（`admitDraftShots` → `compileParameters`），当场拒；
//   · 改一镜（patch）——主进程不碰：方案正本在渲染层，主进程手里的候选是一次性的作者载荷，用户在编辑器里换过模型它也不知道，
//     按它判会判错。于是 `patchStoryboardAuthoring` 把 patch 原样交给渲染层，渲染层 `patchStoryboardSubject` 只合并、不核键，
//     回一个 `saved`。未知键住进方案那一镜的 `params`，落画布时 `buildPlannedNodeMeta` 只认控件同名的键、把它丢掉——
//     模型得到的是成功，用户卡上是默认值。
//
// 走的是真链（模型面 draft_shots → lane 翻译 → 传输适配器 → 规划 handler → 渲染层落方案的那几个函数），零额度。
// 前两扇门钉成回归；第三扇是已知缺口，留可执行的复现（`it.fails`）：修好那一刀，它会转绿、`it.fails` 随之变红，提醒翻回 `it`。
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkbenchStore } from '../../workbenchStore'
import { extendAgentStoryboardDesign, patchAgentStoryboardDesign, upsertAgentStoryboardDesign } from './agentStoryboardDesign'
import { createModuleRegistry } from '../../../../electron/capabilityCore/moduleRegistry'
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from '../../../../electron/capabilityCore/mcpGenerationTools'
import { createPiGenerationTransportAdapter } from '../../../../electron/capabilityCore/generationTransportAdapters'
import { verbToTransportCall } from '../../../../electron/agentLane/laneVerbTransport'
import { writeVerbs } from '../../../../electron/shared/agentCapabilities/verbs/writeVerbs'
import type { StoryboardRequestTarget } from '../../../../electron/shared/agentCapabilities/generationInvocationContext'
import type { ProjectLeaseV2 } from '../../../../electron/capabilityCore/projectLease'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { buildAgentModelEntries } from '../../generationCanvas/agent/availableModels'
import { buildModelEntryIndex, buildPlannedNodeMeta } from '../../generationCanvas/agent/plannedNodeMeta'

vi.mock('../../project/projectCanvasReadSurface', () => ({
  withProjectAction: (action: (value: unknown) => unknown) => action({
    binding: { projectId: 'project-1' }, signal: new AbortController().signal, assertCurrent: () => undefined,
  }),
}))

const CAPABILITIES = { submitIdempotency: true, query: true, reconcile: true, cancel: true }
const IMAGE_SCHEMA = { size: { type: 'string', enum: ['1024x1024', '1536x1024'] }, steps: { type: 'number' } } as const
const registry = createModuleRegistry([{
  moduleId: 'generation.single-shot', version: '1.0.0', inputKinds: ['text', 'image'], outputKinds: ['image'],
  modes: ['text_to_image'], parameterSchema: {}, assetInputSchema: { references: { kind: 'image', max: 4 } },
  providers: [{ providerId: 'acme', models: [{ modelId: 'doc-img', modes: ['text_to_image'], parameterSchema: IMAGE_SCHEMA, capabilities: CAPABILITIES }] }],
}])

const binding = { projectId: 'project-1', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
const lease = { ...binding, version: 2, keyId: 'k', algorithm: 'HMAC-SHA256', issuer: 'nomi-main', canonicalRootDigest: 'r',
  leasePrincipal: 'mcp:codex', sessionId: 'mcp-session:test', connectionNonce: 'n', manifestDigest: 'm', audience: 'nomi-mcp',
  issuedAt: '2026-10-27T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', nonce: 'x', scopeSet: ['generation:create', 'generation:plan'],
  scopeHash: 'h', revocationEpoch: 0, mac: 'mac' } as ProjectLeaseV2

/** 渲染层那一侧：`capabilityApplyHandler` 对这三个 op 调的就是这三个函数。 */
const renderer = async (op: string, payload: unknown): Promise<unknown> => {
  const data = payload as Record<string, unknown>
  if (op === 'storyboard.upsert-design') return upsertAgentStoryboardDesign(data)
  if (op === 'storyboard.patch-design') return patchAgentStoryboardDesign(data)
  if (op === 'storyboard.extend-design') return extendAgentStoryboardDesign(data)
  throw new Error(`unexpected renderer op ${op}`)
}

const draftShotsVerb = writeVerbs().find(verb => verb.name === 'draft_shots')!
const designs = () => useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc ?? []
const planOf = (id: string): StoryboardPlan => designs().find(design => design.id === id)!.plan as StoryboardPlan
const paramsOfShots = (id: string) => planOf(id).shots.map(shot => (shot as { params?: Record<string, unknown> }).params ?? {})

type Reply = { ok: boolean; result?: Record<string, unknown>; message?: string; code?: string; admission?: string }

function lane() {
  const operations = createInMemoryGenerationOperationStore()
  const handler = createGenerationPlanningHandler({ registry, operations, requestRenderer: renderer, now: () => '2026-10-27T00:00:00.000Z' })
  const adapter = createPiGenerationTransportAdapter(binding, { planning: handler, leaseFor: () => lease })
  let seq = 0
  return (requestId: string) => {
    const target: StoryboardRequestTarget = { projectId: 'project-1', sourceDocumentId: 'doc', sourceDocumentRevision: 1,
      sourceDocumentContentHash: 'hash', targetKind: 'storyboard', requestId,
      plans: designs().map(design => ({ id: design.id, title: design.title })) }
    return async (args: Record<string, unknown>): Promise<Reply> => {
      const admitted = draftShotsVerb.schema.parse(draftShotsVerb.prepareArguments ? draftShotsVerb.prepareArguments(args) : args)
      const translated = verbToTransportCall({ toolCallId: `call-${++seq}`, toolName: 'draft_shots', args: admitted })!
      return adapter.tryExecute(translated.call, new AbortController().signal, {
        storyboardTarget: target, sourceDocument: { documentId: 'doc', revision: 1, contentHash: 'hash' },
      }) as Promise<Reply>
    }
  }
}

beforeEach(() => {
  const store = useWorkbenchStore.getState()
  store.hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: 'Doc', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
  store.hydrateStoryboardDesigns({})
})

const model = { providerId: 'acme', modelId: 'doc-img' }
const shot = (title: string, parameters?: Record<string, unknown>) =>
  ({ title, prompt: `${title}：海边日出`, taskKind: 'text_to_image', candidate: model, ...(parameters ? { parameters } : {}) })

describe('文稿方案 · 模型写的未知键', () => {
  it('建方案（create）：未知键当场拒，一份方案都不落', async () => {
    const reply = await lane()('r1')({ shots: [shot('开场', { motion_strength: 0.5 })] })
    expect(reply.ok).toBe(false)
    expect(reply.admission).toBe('unknown_parameter')
    expect(designs()).toHaveLength(0)
  })

  it('补镜头（extend）：未知键当场拒，方案保持原样', async () => {
    const request = lane()
    expect((await request('r1')({ shots: [shot('开场')] })).ok).toBe(true)
    const designId = designs()[0].id
    const before = JSON.stringify(planOf(designId))
    const reply = await request('r2')({ operationId: designId, shots: [shot('第二镜', { motion_strength: 0.5 })] })
    expect(reply.ok).toBe(false)
    expect(reply.admission).toBe('unknown_parameter')
    expect(JSON.stringify(planOf(designId))).toBe(before)
  })

  it('改一镜（patch）写这个模型声明过的键：照常存进那一镜', async () => {
    const request = lane()
    await request('r1')({ shots: [shot('开场')] })
    const designId = designs()[0].id
    const reply = await request('r2')({ operationId: designId, shots: [{ shotId: 'shot-1', parameters: { steps: 20 } }] })
    expect(reply.ok).toBe(true)
    expect(paramsOfShots(designId)).toEqual([{ steps: 20 }])
  })

  // 为什么「patch 门不拒」会变成用户付了默认值的钱：方案那一镜的 `params` 落到画布节点时，唯一的筛子是
  // `buildPlannedNodeMeta`——只认这个模式控件同名的键，其余静默丢掉，而且不报告。这条钉住这个后果本身
  // （真实档案；Z-Image 没有 motion_strength 这个控件）。
  it('落画布时只认控件同名的键：方案那一镜里的未知键被静默丢掉，节点上是档案默认', () => {
    const entries = buildModelEntryIndex(buildAgentModelEntries([{ value: 'z-image-turbo', label: 'z-image-turbo', vendor: 'apimart', kind: 'image' }]))
    const meta = buildPlannedNodeMeta({ modelKey: 'z-image-turbo', modelVendor: 'apimart', params: { motion_strength: 0.5 } }, entries)!
    expect(meta).toBeDefined()
    expect(meta).not.toHaveProperty('motion_strength')
    expect(meta).toHaveProperty('size')
  })

  // 已知缺口。改一镜（patch）写这个模型没有的键：现在回 `ok: true`，未知键住进方案那一镜的 `params`，
  // 到落画布时被丢掉（设计卡 §1.3 的复现命令里有落画布那一段的输出）。与 create / extend 对不上：同一份输入，
  // 前两扇门拒、这一扇说成功。修法要渲染层把「拒」带回主进程（给 `storyboard.patch-design` 加一个类型化回执），
  // 属于方向检查之外的 IPC 回执改动，所以这里只留复现。
  it.fails('改一镜（patch）写这个模型没有的键：和 create / extend 一样当场拒，那一镜的 params 不变', async () => {
    const request = lane()
    await request('r1')({ shots: [shot('开场', { steps: 10 })] })
    const designId = designs()[0].id
    const before = JSON.stringify(planOf(designId))
    const reply = await request('r2')({ operationId: designId, shots: [{ shotId: 'shot-1', parameters: { motion_strength: 0.5 } }] })
    expect(reply.ok).toBe(false)
    expect(reply.admission).toBe('unknown_parameter')
    expect(JSON.stringify(planOf(designId))).toBe(before)
  })
})
