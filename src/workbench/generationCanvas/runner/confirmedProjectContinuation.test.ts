import { docToPlainText, generateText, type GenerateTextOptions } from './textActions'
import { generationNodeRunRecordSchema } from '../model/generationCanvasSchema'
import { textDocumentDigest } from './textGenerationDocument'
import { buildDependencyWaves } from './dependencyWaves'
import { collectConnectedTextPromptParts } from './connectedTextPrompt'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { confirmAndRunNode } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { confirmAndRunPlan } from '../components/batchPlanPreview'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import type { GenerationNodeResult, TiptapDocJson } from '../model/generationCanvasTypes'
import type { GenerationNodeExecutor } from './generationNodeExecutor'
import { createDefaultWorkbenchProjectPayload, type WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'

const calls = vi.hoisted(() => ({ execute: vi.fn(), disk: new Map<string, WorkbenchProjectRecordV1>(), confirm: vi.fn(), mint: vi.fn(), consent: vi.fn() }))
const applyCanvasNodePatch = vi.hoisted(() => vi.fn())
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ projects: { applyCanvasNodePatch } }),
}))
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: async (id: string) => structuredClone(calls.disk.get(id) ?? null),
  saveLocalProject: async (id: string, payload: WorkbenchProjectRecordV1['payload'], name: string) => {
    const record = { ...calls.disk.get(id), id, name, version: 1 as const, payload } as WorkbenchProjectRecordV1
    calls.disk.set(id, structuredClone(record))
    return record
  },
}))
vi.mock('../../api/taskApi', () => ({ mintSpendGrant: calls.mint, consentCanvasShots: calls.consent, withdrawCanvasShots: vi.fn(), releaseCanvasShotRun: vi.fn(async () => undefined) }))
vi.mock('./generationNodeExecutor', () => ({ generationNodeExecutor: calls.execute }))
vi.mock('./assetUploadConsent', async original => ({ ...await original<typeof import('./assetUploadConsent')>(), resolveAssetUploadConsent: async () => ({ allowed: true, needsConfirmation: false }) }))

let session: ProjectSessionTestHarness
beforeEach(() => {
  calls.disk.clear()
  applyCanvasNodePatch.mockReset().mockImplementation(async ({ projectId, nodeId, patch }: {
    projectId: string
    nodeId: string
    patch: Record<string, unknown>
  }) => {
    const record = calls.disk.get(projectId)
    if (!record) return { applied: false }
    const canvas = record.payload.generationCanvas
    const nodes = canvas.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
    calls.disk.set(projectId, structuredClone({ ...record, payload: { ...record.payload, generationCanvas: { ...canvas, nodes } } }))
    return { applied: true }
  })
  calls.confirm.mockReset().mockResolvedValue(true)
  calls.execute.mockReset()
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(calls.confirm)
  calls.mint.mockReset().mockResolvedValue('approved-three')
  calls.consent.mockReset().mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map((shot) => `canvas-${shot.runRecordId}`))
  session = createProjectSessionTestHarness()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
})
afterEach(() => { session.dispose(); vi.restoreAllMocks() })

// 一份确认里有多次提交，现在只剩批量卡（波次）这一条（「×N 一次生成几个」2026-10-06 删除）：后面的波次照样逐个核已批准的输入。
function twoWavePlan(firstId: string, secondId: string) {
  return { waves: [[firstId], [secondId]], edgesUsed: [], blocked: [] }
}

it.each(['prompt', 'references', 'model', 'parameter'] as const)('rejects a later-wave node whose approved %s changed after the first submission', async field => {
  await session.open('project-a')
  const first = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'first approved shot' })
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved original shot' })
  useGenerationCanvasStore.getState().updateNode(node.id, { meta: { modelKey: 'gpt-image-2', modelVendor: 'kie', aspect_ratio: '1:1' } })
  calls.execute.mockImplementation(async (running: { id: string }): Promise<GenerationNodeResult> => {
    if (calls.execute.mock.calls.length === 1) useGenerationCanvasStore.getState().updateNode(node.id,
      field === 'prompt' ? { prompt: 'changed after approval' } : field === 'references' ? { references: ['nomi-local://asset/changed.png'] }
        : { meta: { modelKey: field === 'model' ? 'other-model' : 'gpt-image-2', modelVendor: 'kie', aspect_ratio: field === 'parameter' ? '16:9' : '1:1' } })
    return { id: `result-${running.id}`, type: 'image', url: 'nomi-local://asset/a/result.png', createdAt: 1 }
  })
  await confirmAndRunPlan(twoWavePlan(first.id, node.id), { initiator: 'user' as const })
  expect(calls.execute).toHaveBeenCalledOnce()
  expect(useGenerationCanvasStore.getState().nodes.find((value) => value.id === node.id)?.result).toBeUndefined()
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
  // 一张批量卡 = 一份授权：点了确认，卡上两个要花钱的节点在主进程各开一份出价（一次），不铸令牌。
  expect(calls.consent).toHaveBeenCalledOnce()
  expect(calls.consent.mock.calls[0][0].shots.map((shot: { nodeId: string }) => shot.nodeId)).toEqual([first.id, second.id])
  expect(calls.mint).not.toHaveBeenCalled()
  expect(useGenerationCanvasStore.getState().nodes).toEqual([])
  expect(calls.disk.get(target.projectId)?.payload.generationCanvas.nodes.map(node => node.status)).toEqual(['success', 'success'])
})

it('project switching during confirmation prevents the first submission', async () => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved original shot' })
  // 两镜才弹批量卡（用户自己点的单镜不弹卡，2026-09-25）：在卡上点确认的那一刻已经换了项目。
  const other = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'second shot' })
  calls.confirm.mockImplementation(async () => { await session.open('project-b'); return true })
  await confirmAndRunPlan({ waves: [[node.id, other.id]], edgesUsed: [], blocked: [] }, { initiator: 'user' as const }).catch(() => undefined)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.execute).not.toHaveBeenCalled()
  expect(calls.mint).not.toHaveBeenCalled()
})

// 批量卡点了确认之后、开始交之前还有一段异步：主进程为卡上每一镜开出价（一次 IPC）。这一段里换了项目 = 还没提交，
// 这一批不开始（刚开的出价收回），与以前「铸令牌时换项目」同一条规则。
it('project switching while the batch card opens its consents prevents the first submission', async () => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved original shot' })
  const other = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'second shot' })
  calls.consent.mockImplementation(async (input: { shots: Array<{ runRecordId: string }> }) => {
    await session.open('project-b')
    return input.shots.map((shot) => `canvas-${shot.runRecordId}`)
  })
  await expect(confirmAndRunPlan({ waves: [[node.id, other.id]], edgesUsed: [], blocked: [] }, { initiator: 'user' as const })).resolves.toBe('unavailable')
  expect(calls.execute).not.toHaveBeenCalled()
  expect(calls.mint).not.toHaveBeenCalled()
})


it.each(['author', 'node'] as const)('the original plan confirmation refuses a genuinely changed %s after the first submission', async changed => {
  await session.open('project-a')
  const first = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'first approved shot' })
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved shot' })
  let authorCurrent = true
  const assertAuthorCurrent = async () => { if (!authorCurrent) throw new Error('storyboard_content_conflict') }
  calls.execute.mockImplementation(async (): Promise<GenerationNodeResult> => {
    if (changed === 'author') authorCurrent = false
    else useGenerationCanvasStore.getState().deleteNode(node.id)
    return { id: 'first-result', type: 'image', url: 'nomi-local://asset/first.png', createdAt: 1 }
  })
  await confirmAndRunPlan(twoWavePlan(first.id, node.id), { initiator: 'user' as const, assertCurrent: async () => {}, assertAuthorCurrent }).catch(() => undefined)
  expect(calls.execute).toHaveBeenCalledOnce()
})

it('permits result history and measured preview changes without changing approved generation inputs', async () => {
  await session.open('project-a')
  const first = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'first approved shot' })
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved shot' })
  calls.execute.mockImplementation(async (running: { id: string }): Promise<GenerationNodeResult> => {
    if (running.id === first.id) useGenerationCanvasStore.getState().updateNode(node.id, { size: { width: 250, height: 180 }, meta: { previewHeight: 180, intrinsicWidth: 640, intrinsicHeight: 480 } })
    return { id: `result-${running.id}`, type: 'image', url: 'nomi-local://asset/first.png', createdAt: 1 }
  })
  await confirmAndRunPlan(twoWavePlan(first.id, node.id), { initiator: 'user' as const })
  expect(calls.execute).toHaveBeenCalledTimes(2)
})


it('rejects a later-wave node whose existing upstream asset changed after approval', async () => {
  await session.open('project-a')
  const reference = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'reference' })
  useGenerationCanvasStore.getState().addNodeResult(reference.id, { id: 'reference-1', type: 'image', url: 'nomi-local://asset/ref1.png', createdAt: 1 })
  const first = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'first approved shot' })
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved shot' })
  useGenerationCanvasStore.getState().connectNodes(reference.id, node.id, 'reference')
  calls.execute.mockImplementation(async (): Promise<GenerationNodeResult> => {
    useGenerationCanvasStore.getState().addNodeResult(reference.id, { id: 'reference-2', type: 'image', url: 'nomi-local://asset/ref2.png', createdAt: 2 })
    return { id: 'first-result', type: 'image', url: 'nomi-local://asset/first.png', createdAt: 1 }
  })
  await confirmAndRunPlan(twoWavePlan(first.id, node.id), { initiator: 'user' as const })
  expect(calls.execute).toHaveBeenCalledOnce()
  expect(useGenerationCanvasStore.getState().nodes.find(value => value.id === node.id)?.result).toBeUndefined()
})

it('rejects a manual history selection on a first frame produced by the same approved plan', async () => {
  await session.open('project-a')
  const first = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'first frame' })
  useGenerationCanvasStore.getState().addNodeResult(first.id, { id: 'old-frame', type: 'image', url: 'nomi-local://asset/old.png', createdAt: 1 })
  const second = useGenerationCanvasStore.getState().addNode({ kind: 'video', prompt: 'video' })
  useGenerationCanvasStore.getState().connectNodes(first.id, second.id, 'first_frame')
  calls.execute.mockImplementation(async node => ({ id: `new-${node.id}`, type: node.kind, url: 'nomi-local://asset/new.png', createdAt: 2 }))
  const assertAuthorCurrent = async () => {
    if (calls.execute.mock.calls.length === 1) useGenerationCanvasStore.getState().setNodeMainResult(first.id, 'old-frame')
  }
  await confirmAndRunPlan({ waves: [[first.id], [second.id]], edgesUsed: [], blocked: [] }, {
    initiator: 'user' as const, assertCurrent: async () => {}, assertAuthorCurrent,
  })
  expect(calls.execute).toHaveBeenCalledOnce()
  expect(useGenerationCanvasStore.getState().nodes.find(node => node.id === second.id)).toMatchObject({ status: 'error' })
})

it('a node edited while the batch card opens its consents must not execute the unapproved prompt', async () => {
  await session.open('project-a')
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'approved original shot' })
  const other = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'second shot' })
  calls.consent.mockImplementation(async (input: { shots: Array<{ nodeId: string; runRecordId: string }> }) => {
    useGenerationCanvasStore.getState().updateNode(input.shots[0].nodeId, { prompt: 'changed DURING consent' })
    return input.shots.map((shot) => `canvas-${shot.runRecordId}`)
  })
  calls.execute.mockImplementation(async (executed) => ({ id: 'generated-' + executed.id, type: 'image', url: 'nomi-local://asset/a.png', createdAt: 1 }))
  await confirmAndRunPlan({ waves: [[node.id, other.id]], edgesUsed: [], blocked: [] }, { initiator: 'user' as const })
  expect(calls.execute.mock.calls.map(([executed]) => executed.prompt)).not.toContain('changed DURING consent')
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
