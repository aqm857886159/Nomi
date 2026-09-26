import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveArchetypeForModel } from '../../../../../electron/shared/modelArchetypes'
import { notifyModelOptionsRefresh, preloadModelOptions } from '../../../../config/modelCatalogCache'
import type { ModelCatalogHealthDto, ModelCatalogModelDto } from '../../../api/modelCatalogApi'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../../project/projectSessionTestHarness'
import { useWorkbenchStore } from '../../../workbenchStore'
import type { PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { ensureArchetypeNodeMeta } from '../../../generationCanvas/nodes/controls/archetypeMeta'
import { resolveGenerationReferences } from '../../../generationCanvas/runner/generationReferenceResolver'
import type { GenerationNodeExecutor } from '../../../generationCanvas/runner/generationNodeExecutor'
import { useGenerationQueueStore } from '../../../generationCanvas/runner/generationQueueStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { generateShotRow, runStoryboardBatch } from './storyboardRowActions'
import { deriveStoryboardBatch, deriveStoryboardRowRuntimes } from './storyboardRowStatus'
import { presentStoryboard } from '../../../capability/storyboardPresent'

const calls = vi.hoisted(() => ({ execute: vi.fn<GenerationNodeExecutor>(), confirm: vi.fn(), mint: vi.fn() }))
const models: ModelCatalogModelDto[] = [
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
vi.mock('../../../api/taskApi', () => ({ mintSpendGrant: calls.mint }))
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

beforeEach(async () => {
  notifyModelOptionsRefresh()
  calls.execute.mockReset().mockImplementation(async (node, execution) => {
    expect(execution.projectTarget?.projectId).toBe('project-a')
    expect(execution.grantId).toBe('approved-frame-and-video')
    if (node.kind === 'video') {
      expect(resolveGenerationReferences(node, execution).firstFrameUrl).toBe('https://fixture.invalid/frame.jpg')
    }
    return { id: `result-${node.kind}`, type: node.kind === 'image' ? 'image' : 'video',
      url: `https://fixture.invalid/${node.kind === 'image' ? 'frame.jpg' : 'video.mp4'}`, createdAt: 1 }
  })
  calls.confirm.mockReset().mockResolvedValue(true)
  calls.mint.mockReset().mockResolvedValue('approved-frame-and-video')
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
  expect(calls.mint).not.toHaveBeenCalled()
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
  await presentStoryboard(agentInput('https://fixture.invalid/frame.jpg'))
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.mint).toHaveBeenCalledOnce()
  expect(calls.execute).toHaveBeenCalledOnce()
  const [submitted, execution] = calls.execute.mock.calls[0]
  expect(resolveGenerationReferences(submitted, execution).firstFrameUrl).toBe('https://fixture.invalid/frame.jpg')
  expect(shotNodes()).toHaveLength(1)
  expect(video().status).toBe('success')
  if (nodeId) expect(submitted.id).toBe(nodeId)
})

it('original batch includes a planned first frame and accepts the existing default variant initializer during confirmation', async () => {
  calls.confirm.mockImplementation(async () => {
    expect(state().nodes).toHaveLength(2)
    expect(video().meta).toMatchObject({ modelKey: 'approval-video', modelVendor: 'approval-fixture',
      archetype: { id: 'seedance-2', modeId: 'first' }, duration: 5 })
    const frame = state().nodes.find(node => node.kind === 'image')!
    expect(frame.meta).toMatchObject({ modelKey: 'approval-image', modelVendor: 'approval-fixture',
      archetype: { id: 'agnes-image', modeId: 't2i' }, storyboardKeyframe: true })
    expect(state().edges).toMatchObject([{ source: frame.id, target: video().id, mode: 'first_frame' }])
    const current = video()
    const archetype = resolveArchetypeForModel({ modelKey: 'approval-video', vendorKey: 'approval-fixture', meta: current.meta })!
    const meta = ensureArchetypeNodeMeta(current.meta!, archetype)
    expect(meta).not.toBeNull()
    state().updateNode(current.id, { meta: meta! }, { history: false })
    return true
  })
  const rows = deriveStoryboardRowRuntimes({ plan, designId: context.designId, nodes: state().nodes,
    imageModelOptions: await preloadModelOptions('image', 'any-published'),
    videoModelOptions: await preloadModelOptions('video', 'any-published') })
  const batch = deriveStoryboardBatch(rows)
  await runStoryboardBatch(context, batch.runnable)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.mint).toHaveBeenCalledOnce()
  expect(calls.execute.mock.calls.map(([node]) => node.kind)).toEqual(['image', 'video'])
  expect(state().nodes.map(node => node.status)).toEqual(['success', 'success'])
})

it.each(['prompt', 'model', 'reference'] as const)('original row refuses a real video %s change during confirmation', async changed => {
  calls.confirm.mockImplementation(async () => {
    const current = video()
    state().updateNode(current.id, changed === 'prompt' ? { prompt: 'Unapproved edit' }
      : changed === 'model' ? { meta: { ...current.meta, modelKey: 'different-video' } }
        : { references: ['https://fixture.invalid/unapproved.jpg'] })
    return true
  })
  await generateShotRow(context, shot, null)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.execute).not.toHaveBeenCalled()
  expect(state().nodes.find(node => node.kind === 'image')?.error).toBe('generation_input_changed')
})
