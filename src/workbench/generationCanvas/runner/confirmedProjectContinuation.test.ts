import { docToPlainText, generateText, type GenerateTextOptions } from './textActions'
import { generationNodeRunRecordSchema } from '../model/generationCanvasSchema'
import { textDocumentDigest } from './textGenerationDocument'
import { buildDependencyWaves } from './dependencyWaves'
import { collectConnectedTextPromptParts } from './connectedTextPrompt'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { confirmAndRunNode, confirmAndRunNodeVariants } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { confirmAndRunPlan } from '../components/batchPlanPreview'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import type { GenerationNodeResult, TiptapDocJson } from '../model/generationCanvasTypes'
import type { GenerationNodeExecutor } from './generationNodeExecutor'
import { createDefaultWorkbenchProjectPayload, type WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'

const calls = vi.hoisted(() => ({ execute: vi.fn(), disk: new Map<string, WorkbenchProjectRecordV1>(), confirm: vi.fn(), mint: vi.fn() }))
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: async (id: string) => structuredClone(calls.disk.get(id) ?? null),
  saveLocalProject: async (id: string, payload: WorkbenchProjectRecordV1['payload'], name: string) => {
    const record = { ...calls.disk.get(id), id, name, version: 1 as const, payload } as WorkbenchProjectRecordV1
    calls.disk.set(id, structuredClone(record))
    return record
  },
}))
vi.mock('../../api/taskApi', () => ({ mintSpendGrant: calls.mint }))
vi.mock('./generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('./assetUploadConsent', async original => ({ ...await original<typeof import('./assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))

let session: ProjectSessionTestHarness
beforeEach(() => {
  calls.disk.clear()
  calls.confirm.mockReset().mockResolvedValue(true)
  calls.execute.mockReset()
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(calls.confirm)
  calls.mint.mockReset().mockResolvedValue('approved-three')
  session = createProjectSessionTestHarness()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })

it.each(['no-switch', 'canvas-switch', 'storyboard-switch'] as const)('approved ×3 continues at the original confirmation entry: %s', async scenario => {
  const target = await session.open('project-a')
  const interaction = withProjectAction(project => project)!
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved original shot' })
  const foreignNode = { id: 'b-node', kind: 'image' as const, title: 'B', prompt: 'unrelated B', shotIndex: 1, position: { x: 0, y: 0 } }
  const executor = vi.fn<GenerationNodeExecutor>(async (_node, context): Promise<GenerationNodeResult> => {
    expect(context.projectTarget).toEqual(target)
    expect(context.grantId).toBe('approved-three')
    if (executor.mock.calls.length === 1 && scenario !== 'no-switch') {
      const state = useGenerationCanvasStore.getState()
      calls.disk.set(target.projectId, structuredClone({ id: target.projectId, name: 'A', version: 1, createdAt: 1, updatedAt: 1,
        immutableProjectUuid: target.immutableProjectUuid, projectGeneration: target.projectGeneration, payload: { ...createDefaultWorkbenchProjectPayload(), generationCanvas: { nodes: state.nodes, edges: state.edges, groups: state.groups, selectedNodeIds: [] } } }) as WorkbenchProjectRecordV1)
      await session.open('project-b')
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [foreignNode], edges: [], groups: [], selectedNodeIds: [] })
    }
    return { id: `result-${executor.mock.calls.length}`, type: 'image', url: `nomi-local://asset/a/${executor.mock.calls.length}.png`, createdAt: executor.mock.calls.length }
  })
  await confirmAndRunNodeVariants(node.id, 3, scenario === 'storyboard-switch'
    ? { initiator: 'user' as const, executor, retry: { maxAttempts: 1 }, assertCurrent: async () => { interaction.assertCurrent() }, assertAuthorCurrent: async () => {} }
    : { initiator: 'user' as const, executor, retry: { maxAttempts: 1 } })
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.mint).toHaveBeenCalledExactlyOnceWith([node.id], 3, undefined)
  expect(executor).toHaveBeenCalledTimes(3)
  if (scenario !== 'no-switch') {
    expect(useGenerationCanvasStore.getState().nodes).toEqual([foreignNode])
    expect(calls.disk.get(target.projectId)?.payload.generationCanvas.nodes[0].result?.id).toBe('result-3')
  }
})


it.each(['prompt', 'references', 'model', 'parameter'] as const)('rejects changed approved node %s before remaining variants', async field => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved original shot' })
  useGenerationCanvasStore.getState().updateNode(node.id, { meta: { modelKey: 'gpt-image-2', modelVendor: 'kie', aspect_ratio: '1:1' } })
  const executor = vi.fn<GenerationNodeExecutor>(async (): Promise<GenerationNodeResult> => {
    if (executor.mock.calls.length === 1) useGenerationCanvasStore.getState().updateNode(node.id,
      field === 'prompt' ? { prompt: 'changed after approval' } : field === 'references' ? { references: ['nomi-local://asset/changed.png'] }
        : { meta: { modelKey: field === 'model' ? 'other-model' : 'gpt-image-2', modelVendor: 'kie', aspect_ratio: field === 'parameter' ? '16:9' : '1:1' } })
    return { id: `result-${executor.mock.calls.length}`, type: 'image', url: 'nomi-local://asset/a/result.png', createdAt: 1 }
  })
  await confirmAndRunNodeVariants(node.id, 3, { initiator: 'user' as const, executor, retry: { maxAttempts: 1 } })
  expect(executor).toHaveBeenCalledOnce()
  expect(useGenerationCanvasStore.getState().nodes[0]).toMatchObject({ status: 'error', result: { id: 'result-1' } })
})


it.each(['first-frame-video', 'batch'] as const)('original plan confirmation continues later waves in project A: %s', async kind => {
  const target = await session.open('project-a')
  const interaction = withProjectAction(project => project)!
  const first = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'first' })
  const second = useGenerationCanvasStore.getState().addNode({ kind: kind === 'batch' ? 'image' : 'video', prompt: 'second' })
  if (kind === 'first-frame-video') useGenerationCanvasStore.getState().connectNodes(first.id, second.id, 'first_frame')
  calls.execute.mockImplementation(async (node, context) => {
    expect(context.projectTarget).toEqual(target)
    if (calls.execute.mock.calls.length === 1) {
      const state = useGenerationCanvasStore.getState()
      calls.disk.set(target.projectId, structuredClone({ id: target.projectId, name: 'A', version: 1, createdAt: 1, updatedAt: 1,
        immutableProjectUuid: target.immutableProjectUuid, projectGeneration: target.projectGeneration,
        payload: { ...createDefaultWorkbenchProjectPayload(), generationCanvas: { nodes: state.nodes, edges: state.edges, groups: state.groups, selectedNodeIds: [] } } }) as WorkbenchProjectRecordV1)
      await session.open('project-b')
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    }
    return { id: `result-${node.id}`, type: node.kind, url: 'nomi-local://asset/a/result.png', createdAt: 1 }
  })
  await confirmAndRunPlan({ waves: [[first.id], [second.id]], edgesUsed: [], blocked: [] }, {
    initiator: 'user' as const, assertCurrent: async () => interaction.assertCurrent(), assertAuthorCurrent: async () => {},
  })
  expect(calls.execute).toHaveBeenCalledTimes(2)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.mint).toHaveBeenCalledOnce()
  expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  expect(calls.disk.get(target.projectId)?.payload.generationCanvas.nodes.map(node => node.status)).toEqual(['success', 'success'])
})

it.each(['confirmation', 'minting'] as const)('project switching during %s prevents the first submission', async boundary => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved original shot' })
  if (boundary === 'confirmation') calls.confirm.mockImplementation(async () => { await session.open('project-b'); return true })
  else calls.mint.mockImplementation(async () => { await session.open('project-b'); return 'grant' })
  await confirmAndRunNodeVariants(node.id, 3, { initiator: 'user' as const, executor: calls.execute })
  expect(calls.execute).not.toHaveBeenCalled()
  expect(calls.mint).toHaveBeenCalledTimes(boundary === 'confirmation' ? 0 : 1)
})


it.each(['author', 'node'] as const)('the original variants confirmation refuses a genuinely changed %s after first submission', async changed => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved shot' })
  let authorCurrent = true
  const assertAuthorCurrent = async () => { if (!authorCurrent) throw new Error('storyboard_content_conflict') }
  const executor = vi.fn<GenerationNodeExecutor>(async (): Promise<GenerationNodeResult> => {
    if (changed === 'author') authorCurrent = false
    else useGenerationCanvasStore.getState().deleteNode(node.id)
    return { id: 'first-result', type: 'image', url: 'nomi-local://asset/first.png', createdAt: 1 }
  })
  await confirmAndRunNodeVariants(node.id, 3, { initiator: 'user' as const, executor, assertCurrent: assertAuthorCurrent, assertAuthorCurrent })
  expect(executor).toHaveBeenCalledOnce()
  if (changed === 'author') expect(useGenerationCanvasStore.getState().nodes[0]).toMatchObject({ status: 'error', result: { id: 'first-result' } })
  else expect(useGenerationCanvasStore.getState().nodes).toEqual([])
})

it('permits result history and measured preview changes without changing approved generation inputs', async () => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved shot' })
  const executor = vi.fn<GenerationNodeExecutor>(async (): Promise<GenerationNodeResult> => {
    useGenerationCanvasStore.getState().updateNode(node.id, { size: { width: 250, height: 180 }, meta: { previewHeight: 180, intrinsicWidth: 640, intrinsicHeight: 480 } })
    return { id: `result-${executor.mock.calls.length}`, type: 'image', url: 'nomi-local://asset/first.png', createdAt: 1 }
  })
  await confirmAndRunNodeVariants(node.id, 3, { initiator: 'user' as const, executor })
  expect(executor).toHaveBeenCalledTimes(3)
  expect(useGenerationCanvasStore.getState().nodes[0].history).toHaveLength(3)
})


it('rejects a changed existing upstream asset while preserving the first variant', async () => {
  await session.open('project-a')
  const reference = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'reference' })
  useGenerationCanvasStore.getState().addNodeResult(reference.id, { id: 'reference-1', type: 'image', url: 'nomi-local://asset/ref1.png', createdAt: 1 })
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved shot' })
  useGenerationCanvasStore.getState().connectNodes(reference.id, node.id, 'reference')
  const executor = vi.fn<GenerationNodeExecutor>(async (): Promise<GenerationNodeResult> => {
    useGenerationCanvasStore.getState().addNodeResult(reference.id, { id: 'reference-2', type: 'image', url: 'nomi-local://asset/ref2.png', createdAt: 2 })
    return { id: 'first-result', type: 'image', url: 'nomi-local://asset/first.png', createdAt: 1 }
  })
  await confirmAndRunNodeVariants(node.id, 3, { initiator: 'user' as const, executor })
  expect(executor).toHaveBeenCalledOnce()
  expect(useGenerationCanvasStore.getState().nodes.find(value => value.id === node.id)).toMatchObject({ status: 'error', result: { id: 'first-result' } })
})

it('rejects a manual history selection on a first frame produced by the same approved plan', async () => {
  await session.open('project-a')
  const first = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'first frame' })
  useGenerationCanvasStore.getState().addNodeResult(first.id, { id: 'old-frame', type: 'image', url: 'nomi-local://asset/old.png', createdAt: 1 })
  const second = useGenerationCanvasStore.getState().addNode({ kind: 'video', prompt: 'video' })
  useGenerationCanvasStore.getState().connectNodes(first.id, second.id, 'first_frame')
  calls.execute.mockImplementation(async node => ({ id: `new-${node.id}`, type: node.kind, url: 'nomi-local://asset/new.png', createdAt: 2 }))
  const assertAuthorCurrent = async () => {
    if (calls.execute.mock.calls.length === 1) useGenerationCanvasStore.getState().rollbackHistory(first.id, 'old-frame')
  }
  await confirmAndRunPlan({ waves: [[first.id], [second.id]], edgesUsed: [], blocked: [] }, {
    initiator: 'user' as const, assertCurrent: async () => {}, assertAuthorCurrent,
  })
  expect(calls.execute).toHaveBeenCalledOnce()
  expect(useGenerationCanvasStore.getState().nodes.find(node => node.id === second.id)).toMatchObject({ status: 'error' })
})

it('rerun duplicate edited while mint is pending must not execute unapproved prompt', async () => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved original shot' })
  calls.mint.mockImplementation(async (ids: string[]) => {
    useGenerationCanvasStore.getState().updateNode(ids[0], { prompt: 'changed DURING mint' })
    return 'grant'
  })
  calls.execute.mockImplementation(async () => ({ id: 'generated', type: 'image', url: 'nomi-local://asset/a.png', createdAt: 1 }))
  await confirmAndRunNode(node.id, { rerun: true, initiator: 'user' })
  expect(calls.execute.mock.calls.map(([node]) => node.prompt)).toEqual([])
})
it('planned text manual draft edit must not replace approved connected prompt', async () => {
  await session.open('project-a')
  const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'text instruction' })
  const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'image instruction' })
  const doc = (text: string): TiptapDocJson => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  useGenerationCanvasStore.getState().updateNode(text.id, { contentJson: doc('original') })
  useGenerationCanvasStore.getState().connectNodes(text.id, image.id, 'reference')
  calls.execute.mockImplementation(async node => ({ id: 'new-' + node.id, type: node.kind, text: 'approved generated output', url: 'nomi-local://asset/a.png', createdAt: 1 }))
  const assertAuthorCurrent = async () => {
    if (calls.execute.mock.calls.length === 1) useGenerationCanvasStore.getState().updateNode(text.id, { contentJson: doc('MANUAL UNAPPROVED DRAFT') })
  }
  const graph = useGenerationCanvasStore.getState()
  const plan = buildDependencyWaves([text.id, image.id], graph)
  await confirmAndRunPlan(plan, { initiator: 'user' as const, concurrency: 1, assertCurrent: async () => {}, assertAuthorCurrent })
  const last = calls.execute.mock.calls.at(-1)
  expect(last && collectConnectedTextPromptParts(last[0], last[1])).not.toContain('MANUAL UNAPPROVED DRAFT')
  expect(calls.execute).toHaveBeenCalledTimes(1)
})

it.each(['contentJson', 'textGenMode', 'textGenSelection'] as const)('text %s changed during approval must not execute', async field => {
  // 这组测的是「确认卡弹着的那段窗口里内容被改」：用户自己点的单个生成不弹卡（2026-09-25），窗口只在要确认的路径上存在，用 Agent 发起来开这扇窗。
  await session.open('project-a')
  const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'approved instruction' })
  const doc = (text: string): TiptapDocJson => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  useGenerationCanvasStore.getState().updateNode(text.id, { contentJson: doc('approved content'), meta: { textGenMode: 'rewrite', textGenSelection: 'approved selection' } })
  calls.confirm.mockImplementation(async () => {
    useGenerationCanvasStore.getState().updateNode(text.id, field === 'contentJson' ? { contentJson: doc('UNAPPROVED CONTENT') } : { meta: { textGenMode: field === 'textGenMode' ? 'replace' : 'rewrite', textGenSelection: field === 'textGenSelection' ? 'UNAPPROVED SELECTION' : 'approved selection' } })
    return true
  })
  calls.execute.mockImplementation(async () => ({ id: 'generated', type: 'text', text: 'output', createdAt: 1 }))
  await confirmAndRunNode(text.id, { initiator: 'agent' })
  expect(calls.execute).not.toHaveBeenCalled()
})

it.each(['append', 'replace'] as const)('original generateText %s output is sealed and feeds the admitted batch', async mode => {
  await session.open('project-a')
  const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'text instruction' })
  const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'image instruction' })
  const doc = (text: string): TiptapDocJson => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  useGenerationCanvasStore.getState().updateNode(text.id, { contentJson: doc('original'), meta: { modelVendor: 'v', modelKey: 'm', textGenMode: mode } })
  useGenerationCanvasStore.getState().connectNodes(text.id, image.id, 'reference')
  calls.execute.mockImplementation(async (node, context) => {
    if (node.kind === 'text') return generateText(node, { projectTarget: context.projectTarget, runTask: async () => ({ id: 'text-task', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: 'generated output' } }] } }) })
    return { id: 'new-' + node.id, type: 'image', url: 'nomi-local://asset/a.png', createdAt: 1 }
  })
  await confirmAndRunPlan(buildDependencyWaves([text.id, image.id], useGenerationCanvasStore.getState()), { initiator: 'user' as const, concurrency: 1 })
  expect(calls.execute).toHaveBeenCalledTimes(2)
  const completed = useGenerationCanvasStore.getState().nodes.find(node => node.id === text.id)!
  expect(generationNodeRunRecordSchema.parse(completed.runs?.[0]).textDocumentDigest).toBe(textDocumentDigest(completed.contentJson))
  expect(completed.runs?.[0].resultId).toBe(completed.result?.id)
  const last = calls.execute.mock.calls.at(-1)!
  expect(collectConnectedTextPromptParts(last[0], last[1])).toEqual([mode === 'append' ? 'original\ngenerated output' : 'generated output'])
})

it.each(['append', 'replace'] as const)('manual edits after original generateText %s output cannot replace a sealed batch dependency', async mode => {
  await session.open('project-a')
  const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'text instruction' })
  const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'image instruction' })
  const doc = (text: string): TiptapDocJson => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  useGenerationCanvasStore.getState().updateNode(text.id, { contentJson: doc('original'), meta: { modelVendor: 'v', modelKey: 'm', textGenMode: mode } })
  useGenerationCanvasStore.getState().connectNodes(text.id, image.id, 'reference')
  calls.execute.mockImplementation(async (node, context) => generateText(node, {
    projectTarget: context.projectTarget,
    runTask: async () => ({ id: 'text-task', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: 'generated output' } }] } }),
  }))
  const assertAuthorCurrent = async () => {
    if (calls.execute.mock.calls.length === 1) useGenerationCanvasStore.getState().updateNode(text.id, { contentJson: doc('UNAPPROVED DRAFT') })
  }
  await confirmAndRunPlan(buildDependencyWaves([text.id, image.id], useGenerationCanvasStore.getState()), {
    initiator: 'user' as const, concurrency: 1, assertCurrent: async () => {}, assertAuthorCurrent,
  })
  expect(calls.execute).toHaveBeenCalledOnce()
  const completed = useGenerationCanvasStore.getState().nodes.find(node => node.id === text.id)!
  expect(completed.runs?.[0].textDocumentDigest).not.toBe(textDocumentDigest(completed.contentJson))
  expect(useGenerationCanvasStore.getState().nodes.find(node => node.id === image.id)?.status).toBe('error')
})

it('same-wave image admission during original text content delivery accepts legitimate final text', async () => {
  await session.open('project-a')
  const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'text instruction' })
  const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'image instruction' })
  const doc = (text: string): TiptapDocJson => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  useGenerationCanvasStore.getState().updateNode(text.id, { contentJson: doc('original'), meta: { modelVendor: 'v', modelKey: 'm', textGenMode: 'replace' } })
  useGenerationCanvasStore.getState().connectNodes(text.id, image.id, 'reference')
  let release: () => void = () => {}
  const contentChanged = new Promise<void>(resolve => { release = resolve })
  const unsubscribe = useGenerationCanvasStore.subscribe(state => { if (JSON.stringify(state.nodes.find(n => n.id === text.id)?.contentJson).includes('generated output')) release() })
  let guardCount = 0
  const assertAuthorCurrent = async () => { guardCount += 1; if (guardCount === 2) await contentChanged }
  calls.execute.mockImplementation(async (node, context) => {
    if (node.kind === 'text') return generateText(node, { projectTarget: context.projectTarget, runTask: async () => ({ id: 'text-task', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: 'generated output' } }] } }) })
    return { id: 'new-' + node.id, type: 'image', url: 'nomi-local://asset/a.png', createdAt: 1 }
  })
  try {
    await confirmAndRunPlan(buildDependencyWaves([text.id, image.id], useGenerationCanvasStore.getState()), { initiator: 'user' as const, concurrency: 2, assertCurrent: async () => {}, assertAuthorCurrent })
    expect(calls.execute).toHaveBeenCalledTimes(2)
  } finally { unsubscribe() }
})


it('same-wave downstream accepts the actual streaming body atomically sealed by its admitted text run', async () => {
  await session.open('project-a')
  const text = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'text instruction', meta: { modelVendor: 'v', modelKey: 'm', textGenMode: 'replace' } })
  const image = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'image instruction' })
  useGenerationCanvasStore.getState().connectNodes(text.id, image.id, 'reference')
  let releaseDelta!: () => void
  let releaseImage!: () => void
  const deltaDelivered = new Promise<void>(resolve => { releaseDelta = resolve })
  const imageExecuted = new Promise<void>(resolve => { releaseImage = resolve })
  let guardCount = 0
  const assertAuthorCurrent = async () => { if (++guardCount === 2) await deltaDelivered }
  calls.execute.mockImplementation(async (node, context) => {
    if (node.kind === 'text') return generateText(node, {
      projectTarget: context.projectTarget,
      runTextStream: async (_vendor, _request, _projectId, options) => {
        options.onDelta?.('streamed chunk')
        releaseDelta()
        await imageExecuted
        return { id: 'text-task', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: 'streamed chunk' } }] } }
      },
    })
    expect(collectConnectedTextPromptParts(node, context)).toEqual(['streamed chunk'])
    releaseImage()
    return { id: 'image-result', type: 'image', url: 'nomi-local://asset/a.png', createdAt: 1 }
  })
  await confirmAndRunPlan(buildDependencyWaves([text.id, image.id], useGenerationCanvasStore.getState()), {
    initiator: 'user' as const, concurrency: 2, assertCurrent: async () => {}, assertAuthorCurrent,
  })
  expect(calls.execute).toHaveBeenCalledTimes(2)
})

it.each(['append', 'replace'] as const)('original confirmation retries streamed %s from the approved document', async mode => {
  // 这组测的是「确认卡弹着的那段窗口里内容被改」：用户自己点的单个生成不弹卡（2026-09-25），窗口只在要确认的路径上存在，用 Agent 发起来开这扇窗。
  await session.open('project-a')
  const original: TiptapDocJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'approved initial document' }] }] }
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'approved instruction', meta: { modelVendor: 'v', modelKey: 'm', textGenMode: mode } })
  useGenerationCanvasStore.getState().updateNode(node.id, { contentJson: original })
  const stream = vi.fn<NonNullable<GenerateTextOptions['runTextStream']>>(async (_vendor, _request, _projectId, options) => {
    if (stream.mock.calls.length === 1) {
      options.onDelta?.('failed partial chunk')
      throw new TypeError('fetch failed')
    }
    options.onDelta?.('complete generated output')
    return { id: 'text-task', kind: 'chat', status: 'succeeded', assets: [], raw: { choices: [{ message: { content: 'complete generated output' } }] } }
  })
  // Keep the existing text executor boundary: runner keys are checked independently
  // because the production text executor currently does not forward them to generateText.
  const executor: GenerationNodeExecutor = async (current, context) => generateText(current, {
    projectTarget: context.projectTarget, runTextStream: stream,
  })
  calls.execute.mockImplementation(executor)
  await confirmAndRunNode(node.id, { initiator: 'agent' })
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(stream).toHaveBeenCalledTimes(2)
  expect(calls.execute).toHaveBeenCalledTimes(2)
  const keys = calls.execute.mock.calls.map(([, context]) => context.idempotencyKey)
  expect(keys[0]).toEqual(expect.any(String))
  expect(keys[1]).toBe(keys[0])
  for (const [, request] of stream.mock.calls) {
    expect(request.prompt).toContain('approved initial document')
    expect(request.prompt).not.toContain('failed partial chunk')
  }
  const completed = useGenerationCanvasStore.getState().nodes.find(candidate => candidate.id === node.id)!
  expect(completed.status).toBe('success')
  expect(docToPlainText(completed.contentJson)).toBe(mode === 'append' ? 'approved initial document\ncomplete generated output' : 'complete generated output')
})

it.each(['append', 'replace'] as const)('original confirmation rejects streamed %s retry after a manual document edit', async mode => {
  // 这组测的是「确认卡弹着的那段窗口里内容被改」：用户自己点的单个生成不弹卡（2026-09-25），窗口只在要确认的路径上存在，用 Agent 发起来开这扇窗。
  await session.open('project-a')
  const doc = (text: string): TiptapDocJson => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'text', prompt: 'approved instruction', meta: { modelVendor: 'v', modelKey: 'm', textGenMode: mode } })
  useGenerationCanvasStore.getState().updateNode(node.id, { contentJson: doc('approved initial document') })
  const stream = vi.fn<NonNullable<GenerateTextOptions['runTextStream']>>(async (_vendor, _request, _projectId, options) => {
    options.onDelta?.('failed partial chunk')
    useGenerationCanvasStore.getState().updateNode(node.id, { contentJson: doc('manual user document') })
    throw new TypeError('fetch failed')
  })
  const executor: GenerationNodeExecutor = async (current, context) => generateText(current, {
    projectTarget: context.projectTarget, runTextStream: stream,
  })
  calls.execute.mockImplementation(executor)
  await confirmAndRunNode(node.id, { initiator: 'agent' })
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(stream).toHaveBeenCalledOnce()
  expect(calls.execute).toHaveBeenCalledOnce()
  const rejected = useGenerationCanvasStore.getState().nodes.find(candidate => candidate.id === node.id)!
  expect(rejected.status).toBe('error')
  expect(docToPlainText(rejected.contentJson)).toBe('manual user document')
})
