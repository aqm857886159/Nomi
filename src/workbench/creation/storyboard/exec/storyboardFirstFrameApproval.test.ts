import { applyCanvasToolCall } from '../../../generationCanvas/agent/applyCanvasToolCall'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { notifyModelOptionsRefresh, preloadModelOptions } from '../../../../config/modelCatalogCache'
import type { ModelCatalogHealthDto, ModelCatalogModelDto } from '../../../api/modelCatalogApi'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../../project/projectSessionTestHarness'
import { useWorkbenchStore } from '../../../workbenchStore'
import type { PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { resolveGenerationReferences } from '../../../generationCanvas/runner/generationReferenceResolver'
import type { GenerationNodeExecutor } from '../../../generationCanvas/runner/generationNodeExecutor'
import { useGenerationQueueStore } from '../../../generationCanvas/runner/generationQueueStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { generateShotRow, materializeShotRow, runStoryboardBatch } from './storyboardRowActions'
import { deriveStoryboardBatch, deriveStoryboardRowRuntimes } from './storyboardRowStatus'
import { presentStoryboard } from '../../../capability/storyboardPresent'

const calls = vi.hoisted(() => ({ execute: vi.fn<GenerationNodeExecutor>(), confirm: vi.fn(), consent: vi.fn() }))
const models: ModelCatalogModelDto[] = [
  { modelKey: 'approval-imported-i2v', labelZh: 'Imported I2V', kind: 'video', vendorKey: 'approval-fixture',
    meta: { comfyWorkflowImport: { binding: { outputKind: 'video' } }, parameters: [{ key: 'first_frame_url', label: 'Load Image', type: 'image-url', mediaKind: 'image' }] },
    enabled: true, published: true, publishedModes: ['image_to_video'], availability: { usable: true }, createdAt: 't', updatedAt: 't' },
  { modelKey: 'approval-image', labelZh: 'Image', kind: 'image', vendorKey: 'approval-fixture', meta: { archetypeId: 'agnes-image' },
    enabled: true, published: true, publishedModes: ['text_to_image'], availability: { usable: true }, createdAt: 't', updatedAt: 't' },
  { modelKey: 'approval-video', labelZh: 'Video', kind: 'video', vendorKey: 'approval-fixture', meta: { archetypeId: 'seedance-2' },
    enabled: true, published: true, publishedModes: ['image_to_video'], availability: { usable: true }, createdAt: 't', updatedAt: 't' },
]
const health: ModelCatalogHealthDto = { ok: true, counts: { vendors: 1, enabledVendors: 1, models: 2, enabledModels: 2,
  mappings: 2, enabledMappings: 2, enabledApiKeys: 0 }, byKind: ['image', 'video'].map(kind => ({
    kind: kind as 'image' | 'video', enabledModels: 1, executableModels: 1 })), issues: [] }
// Replace catalog IPC and supplier/approval endpoints, retaining the actual model
// projection, row action, confirmation funnel, input guard and wave runner.
vi.mock('../../../api/modelCatalogApi', () => ({
  listWorkbenchModelCatalogModels: async ({ kind }: { kind: string }) => models.filter(model => model.kind === kind),
  listWorkbenchModelCatalogVendors: async () => [{ key: 'approval-fixture', name: 'Fixture', enabled: true, authType: 'none', createdAt: 't', updatedAt: 't' }],
  getWorkbenchModelCatalogHealth: async () => health,
}))
vi.mock('../../../api/vendorPreferenceApi', () => ({ getVendorPreference: async () => ({ orderedVendorKeys: [] }) }))
vi.mock('../../../api/taskApi', () => ({ consentCanvasShots: calls.consent, withdrawCanvasShots: vi.fn(), releaseCanvasShotRun: vi.fn(async () => undefined) }))
vi.mock('../../../generationCanvas/runner/generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))

const shot: PlanShot = {
  index: 1, shotId: 'approved-shot', shotKind: 'video', prompt: 'Approved video', durationSec: 5, anchorIds: [],
  modelKey: 'approval-video', modelVendor: 'approval-fixture', modeId: 'first',
  keyframe: { enabled: true, prompt: 'Approved frame', modelKey: 'approval-image', modelVendor: 'approval-fixture', modeId: 't2i' },
}
const plan: StoryboardPlan = { title: 'Original first-frame action', anchors: [], shots: [shot] }
const context = { initiator: 'user' as const, documentId: 'doc', designId: 'design', plan }
const state = () => useGenerationCanvasStore.getState()
/** 方案写入会顺带建它的分镜表视图（与手建方案同一条路）；这里数的是生成类节点。 */
const shotNodes = () => state().nodes.filter(node => node.kind !== 'shot_table')
const video = () => state().nodes.find(node => node.kind === 'video')!
let session: ProjectSessionTestHarness
const consentedRecordFor = (nodeId: string): string | undefined => calls.consent.mock.calls
  .flatMap(([input]) => (input as { shots: Array<{ nodeId: string; runRecordId: string }> }).shots)
  .find((one) => one.nodeId === nodeId)?.runRecordId

beforeEach(async () => {
  notifyModelOptionsRefresh()
  calls.execute.mockReset().mockImplementation(async (node, execution) => {
    expect(execution.projectTarget?.projectId).toBe('project-a')
    // 批量卡点了确认 = 卡上每一镜在主进程开好的出价；每一镜交的时候带它自己那一份运行记录号（不铸令牌）。
    expect(execution.canvasRun?.runRecordId).toBe(consentedRecordFor(node.id))
    if (node.kind === 'video') {
      expect(resolveGenerationReferences(node, execution).firstFrameUrl).toBe('https://fixture.invalid/frame.jpg')
    }
    return { id: `result-${node.kind}`, type: node.kind === 'image' ? 'image' : 'video',
      url: `https://fixture.invalid/${node.kind === 'image' ? 'frame.jpg' : 'video.mp4'}`, createdAt: 1 }
  })
  calls.confirm.mockReset().mockResolvedValue(true)
  calls.consent.mockReset().mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map((one) => `canvas-${one.runRecordId}`))
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(calls.confirm)
  session = createProjectSessionTestHarness()
  await session.open('project-a')
  state().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  useWorkbenchStore.getState().hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: plan.title, contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], 'doc')
  useWorkbenchStore.getState().hydrateStoryboardDesigns({ doc: [{ id: 'design', documentId: 'doc', title: plan.title, plan,
    committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })

/** Agent 要生成的就是用户那份方案本身；这里只把它改成 Agent 刚写进去的样子。 */
function agentInput(referenceUrl?: string) {
  const agentShot: PlanShot = { ...shot, keyframe: { enabled: false },
    ...(referenceUrl ? { referenceBindings: { first_frame: [{ url: referenceUrl }] } } : {}) }
  useWorkbenchStore.getState().setStoryboardPlan({ ...plan, shots: [agentShot] }, 'doc', 'design')
  return { projectId: 'project-a', designId: 'design', sourceDocumentId: 'doc', shotIds: [shot.shotId!] }
}

it('original Agent presentation rejects a missing required first frame before confirmation', async () => {
  await presentStoryboard(agentInput())
  expect(calls.confirm).not.toHaveBeenCalled()
  expect(calls.consent).not.toHaveBeenCalled()
  expect(calls.execute).not.toHaveBeenCalled()
  expect(shotNodes()).toHaveLength(0)
})

it.each(['fresh', 'existing'] as const)('original Agent presentation projects the selected first frame onto a %s node', async existing => {
  let nodeId: string | undefined
  if (existing === 'existing') {
    nodeId = state().addNode({ kind: 'video', prompt: shot.prompt,
      meta: { storyboardDesignId: 'design', shotId: shot.shotId, modelKey: shot.modelKey,
        modelVendor: shot.modelVendor, archetype: { id: 'seedance-2', modeId: 'first' },
        firstFrameUrl: 'https://fixture.invalid/obsolete-frame.jpg' } }).id
  }
  const receipt = await presentStoryboard(agentInput('https://fixture.invalid/frame.jpg'))
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.consent).toHaveBeenCalledOnce()
  // 交回 operation（发动机收敛第一刀第 3 步）：点了确认、出价开好就回话，带上每一镜的 Run 号；整批在画布上接着跑完。
  expect(receipt).toMatchObject({ status: 'presented', decision: 'started', operations: [`canvas-${consentedRecordFor(video().id)}`] })
  await vi.waitFor(() => expect(video().status).toBe('success'))
  expect(calls.execute).toHaveBeenCalledOnce()
  const [submitted, execution] = calls.execute.mock.calls[0]
  expect(resolveGenerationReferences(submitted, execution).firstFrameUrl).toBe('https://fixture.invalid/frame.jpg')
  expect(shotNodes()).toHaveLength(1)
  expect(video().status).toBe('success')
  if (nodeId) expect(submitted.id).toBe(nodeId)
})

it('original batch includes a planned first frame and accepts the existing default variant initializer during confirmation', async () => {
  calls.confirm.mockImplementation(async () => {
    // The spend confirmation is a plan boundary: materialization must not happen before consent.
    expect(state().nodes).toHaveLength(0)
    return true
  })
  const rows = deriveStoryboardRowRuntimes({ plan, designId: context.designId, nodes: state().nodes,
    imageModelOptions: await preloadModelOptions('image', 'any-published'),
    videoModelOptions: await preloadModelOptions('video', 'any-published') })
  const batch = deriveStoryboardBatch(rows)
  await runStoryboardBatch(context, batch.runnable)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.consent).toHaveBeenCalledOnce()
  expect(calls.consent.mock.calls[0][0].shots).toHaveLength(2)
  expect(state().nodes).toHaveLength(2)
  expect(video().meta).toMatchObject({ modelKey: 'approval-video', modelVendor: 'approval-fixture',
    archetype: { id: 'seedance-2', modeId: 'first' }, duration: 5 })
  const frame = state().nodes.find(node => node.kind === 'image')!
  expect(frame.meta).toMatchObject({ modelKey: 'approval-image', modelVendor: 'approval-fixture',
    archetype: { id: 'agnes-image', modeId: 't2i' }, storyboardKeyframe: true })
  expect(state().edges).toMatchObject([{ source: frame.id, target: video().id, mode: 'first_frame' }])
  expect(calls.execute.mock.calls.map(([node]) => node.kind)).toEqual(['image', 'video'])
  expect(state().nodes.map(node => node.status)).toEqual(['success', 'success'])
})

it.each(['prompt', 'model', 'reference'] as const)('original row keeps the %s confirmation free of pre-confirmation nodes', async _changed => {
  calls.confirm.mockImplementation(async () => {
    // The creation contract is now explicit: confirmation sees the draft only;
    // no canvas node exists until the user accepts this card.
    expect(shotNodes()).toHaveLength(0)
    return true
  })
  await generateShotRow(context, shot, null)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.execute).toHaveBeenCalledTimes(2)
  expect(shotNodes()).toHaveLength(2)
})

it('reuses an already-generated storyboard image, realizes one video, and submits video only after confirmation', async () => {
  const frameResult = { id: 'existing-storyboard-frame', type: 'image' as const, url: 'https://fixture.invalid/frame.jpg', createdAt: 1 }
  const original = state().addNode({ kind: 'image', title: 'Storyboard frame', prompt: 'Original image prompt',
    meta: { storyboardDesignId: 'design', shotId: shot.shotId, materializationOperationId: 'storyboard:design', materializationClientId: shot.shotId,
      modelKey: 'approval-image', modelVendor: 'approval-fixture' } })
  state().updateNode(original.id, { status: 'success', result: frameResult })
  calls.confirm.mockImplementation(async () => {
    expect(state().nodes).toHaveLength(1)
    expect(state().nodes[0].result).toEqual(frameResult)
    return true
  })
  const rows = deriveStoryboardRowRuntimes({ plan, designId: 'design', nodes: state().nodes,
    imageModelOptions: await preloadModelOptions('image', 'any-published'),
    videoModelOptions: await preloadModelOptions('video', 'any-published') })
  const batch = deriveStoryboardBatch(rows)
  expect(batch.runnable).toHaveLength(1)
  await runStoryboardBatch(context, batch.runnable)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.execute.mock.calls.map(([node]) => node.kind)).toEqual(['video'])
  expect(state().nodes).toHaveLength(2)
  expect(state().nodes.find(node => node.id === original.id)?.result).toEqual(frameResult)
  expect(state().edges).toMatchObject([{ source: original.id, target: video().id, mode: 'first_frame' }])
  expect(video().kind).toBe('video')
  expect(resolveGenerationReferences(calls.execute.mock.calls[0][0], calls.execute.mock.calls[0][1]).firstFrameUrl).toBe(frameResult.url)
  await vi.waitFor(() => expect({ status: video().status, error: video().error }).toEqual({ status: 'success', error: undefined }))
  await materializeShotRow(context, shot, null, true)
  expect(state().nodes).toHaveLength(2)
  const after = deriveStoryboardRowRuntimes({ plan, designId: 'design', nodes: state().nodes,
    imageModelOptions: await preloadModelOptions('image', 'any-published'),
    videoModelOptions: await preloadModelOptions('video', 'any-published') })
  expect(deriveStoryboardBatch(after).runnable).toHaveLength(0)
})

it('official patch converts all 26 image-only shots to imported I2V, preserves frames, and reaches the existing batch runner', async () => {
  const imagePlan: StoryboardPlan = { title: '26 original images', anchors: [], shots: Array.from({ length: 26 }, (_, i) => ({
    index: i + 1, shotId: `long-shot-${i + 1}`, shotKind: 'image', durationSec: 5, anchorIds: [], prompt: `Motion for shot ${i + 1}`,
    modelKey: 'approval-image', modelVendor: 'approval-fixture', modeId: 't2i',
  })) }
  useWorkbenchStore.getState().setStoryboardPlan(imagePlan, 'doc', 'design')
  const imageIds: string[] = []
  for (const one of imagePlan.shots) {
    const image = state().addNode({ kind: 'image', title: `Shot ${one.index}`, prompt: one.prompt,
      meta: { storyboardDesignId: 'design', shotId: one.shotId, materializationOperationId: 'storyboard:design', materializationClientId: one.shotId,
        modelKey: 'approval-image', modelVendor: 'approval-fixture' } })
    state().updateNode(image.id, { status: 'success', result: { id: `existing-frame-${one.index}`, type: 'image', url: 'https://fixture.invalid/frame.jpg', createdAt: 1 } })
    imageIds.push(image.id)
  }
  await applyCanvasToolCall('nomi_canvas_edit', { operation: 'patch_shots', select: { kind: 'all' },
    patch: { shotKind: 'video', modelKey: 'approval-imported-i2v', modelVendor: 'approval-fixture' } }, undefined, undefined, 'doc', 'design')
  const next = useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc.find(d => d.id === 'design')!.plan
  expect(next.shots).toHaveLength(26)
  expect(next.shots.every(one => one.shotKind === 'video' && one.keyframe?.enabled && one.modelVendor === 'approval-fixture')).toBe(true)
  expect(state().nodes).toHaveLength(26) // author mutation does not generate or create new nodes
  const rows = deriveStoryboardRowRuntimes({ plan: next, designId: 'design', nodes: state().nodes,
    imageModelOptions: await preloadModelOptions('image', 'any-published'), videoModelOptions: await preloadModelOptions('video', 'any-published') })
  expect(deriveStoryboardBatch(rows).runnable).toHaveLength(26)
  calls.confirm.mockImplementation(async () => { expect(state().nodes).toHaveLength(26); return true })
  const completed = new Promise<void>(resolve => {
    const complete = () => state().nodes.filter(node => node.kind === 'video' && node.status === 'success').length === 26
    const unsubscribe = useGenerationCanvasStore.subscribe(() => { if (complete()) { unsubscribe(); resolve() } })
    if (complete()) { unsubscribe(); resolve() }
  })
  await runStoryboardBatch({ ...context, plan: next }, deriveStoryboardBatch(rows).runnable)
  await completed
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.execute).toHaveBeenCalledTimes(26)
  expect(calls.execute.mock.calls.every(([node]) => node.kind === 'video')).toBe(true)
  expect(state().nodes).toHaveLength(52)
  expect(state().edges.filter(edge => edge.mode === 'first_frame')).toHaveLength(26)
  for (const id of imageIds) expect(state().nodes.find(node => node.id === id)?.result?.type).toBe('image')
})
