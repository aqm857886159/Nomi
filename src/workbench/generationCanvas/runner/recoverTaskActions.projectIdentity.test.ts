// 找回（免费续查）只认任务自己的项目身份：运行记录在提交时固定的 projectId。
// 旧记录没有这一栏时由「记录持久化在哪个项目」派生（点击找回时就在签发的项目画布上）；
// 记录说它属于别的项目就拒绝并说明，绝不把原项目的产物落进当前项目。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeRunRecord } from '../model/generationCanvasTypes'
import type { WorkbenchProjectRecordV1 } from '../../project/projectRecordSchema'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { recoverNodeResult } from './recoverTaskActions'
import { fetchWorkbenchTaskResultByVendor, type FetchWorkbenchTaskResultResponseDto } from '../../api/taskApi'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { createProjectSessionTestHarness, testProjectBinding, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import i18n from '../../../i18n'

const disk = vi.hoisted(() => new Map<string, unknown>())
const applyCanvasNodePatch = vi.hoisted(() => vi.fn())
vi.mock('../../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ projects: { applyCanvasNodePatch } }),
}))
vi.mock('../../library/localProjectStore', () => ({
  readLocalProjectAsync: vi.fn(async (projectId: string) => structuredClone(disk.get(projectId) ?? null)),
  saveLocalProject: vi.fn(async (projectId: string, payload: unknown, name?: string) => {
    disk.set(projectId, structuredClone({ id: projectId, name, version: 1, immutableProjectUuid: testProjectBinding(projectId).immutableProjectUuid, projectGeneration: testProjectBinding(projectId).projectGeneration, payload }))
    return disk.get(projectId)
  }),
}))
// 这些是旧运行记录（没有单镜 Run）：Run 那一侧回 null，照旧路查。
vi.mock('../../api/taskApi', () => ({ fetchWorkbenchTaskResultByVendor: vi.fn(), pollCanvasShotRun: vi.fn(async () => null) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function recoverableNode(run: Partial<GenerationNodeRunRecord>): string {
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({ kind: 'image', prompt: '镜头 1', meta: { modelVendor: 'apimart', modelKey: 'image-model' } })
  store.appendNodeRun(node.id, { id: 'run-1', status: 'running', startedAt: 1, updatedAt: 1, taskId: 'task-paid-1', ...run })
  store.setNodeStatus(node.id, 'recoverable', 'timed out')
  return node.id
}

const recoverInOpenProject = (nodeId: string) => withProjectAction((project) => recoverNodeResult(nodeId, project))

const succeeded = (url: string): FetchWorkbenchTaskResultResponseDto => ({
  vendor: 'apimart',
  result: { id: 'task-paid-1', kind: 'text_to_image', status: 'succeeded', assets: [{ type: 'image', url }], raw: {} },
})

let session: ProjectSessionTestHarness
beforeEach(async () => {
  disk.clear()
  applyCanvasNodePatch.mockReset().mockImplementation(async ({ projectId, nodeId, patch }: {
    projectId: string
    nodeId: string
    patch: Record<string, unknown>
  }) => {
    const record = disk.get(projectId) as WorkbenchProjectRecordV1 | undefined
    if (!record) return { applied: false }
    const canvas = record.payload.generationCanvas
    const nodes = canvas.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
    disk.set(projectId, structuredClone({ ...record, payload: { ...record.payload, generationCanvas: { ...canvas, nodes } } }))
    return { applied: true }
  })
  vi.mocked(fetchWorkbenchTaskResultByVendor).mockReset()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
  setCanvasEventSinkForTests(() => {})
  session = createProjectSessionTestHarness()
  await session.open('project-a')
})
afterEach(() => {
  setCanvasEventSinkForTests(null)
  session.dispose()
})

describe('recovery reads only the task identity', () => {
  it('an old record without a projectId derives it from the project the record is persisted in', async () => {
    const nodeId = recoverableNode({})
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockResolvedValue(succeeded('nomi-local://asset/project-a/recovered.png'))
    await recoverInOpenProject(nodeId)
    expect(vi.mocked(fetchWorkbenchTaskResultByVendor)).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-paid-1', projectId: 'project-a' }))
    expect(useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)).toMatchObject({
      status: 'success', result: { url: 'nomi-local://asset/project-a/recovered.png' },
    })
  })

  it('a record that names another project is refused with an explanation and never polled from here', async () => {
    const nodeId = recoverableNode({ projectId: 'project-z' })
    await recoverInOpenProject(nodeId)
    expect(vi.mocked(fetchWorkbenchTaskResultByVendor)).not.toHaveBeenCalled()
    expect(useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)).toMatchObject({
      status: 'error', error: i18n.t('generationCommon.recoverable.otherProjectTask'),
    })
  })

  it('switching projects while recovery polls lands the result on the original project, not the new one', async () => {
    const nodeId = recoverableNode({ projectId: 'project-a' })
    const poll = deferred<FetchWorkbenchTaskResultResponseDto>()
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockReturnValue(poll.promise)
    const recovering = recoverInOpenProject(nodeId)
    await vi.waitFor(() => expect(vi.mocked(fetchWorkbenchTaskResultByVendor)).toHaveBeenCalledOnce())

    const a = useGenerationCanvasStore.getState()
    disk.set('project-a', structuredClone({ id: 'project-a', name: 'A', version: 1, immutableProjectUuid: testProjectBinding('project-a').immutableProjectUuid, projectGeneration: testProjectBinding('project-a').projectGeneration, payload: { generationCanvas: { nodes: a.nodes, edges: a.edges, groups: a.groups, selectedNodeIds: [] } } }))
    await session.open('project-b')
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })

    poll.resolve(succeeded('nomi-local://asset/project-a/recovered.png'))
    await recovering
    expect(useGenerationCanvasStore.getState().nodes).toEqual([])
    const record = disk.get('project-a') as WorkbenchProjectRecordV1
    expect(record.payload.generationCanvas.nodes.find((node: GenerationCanvasNode) => node.id === nodeId)).toMatchObject({
      status: 'success', result: { url: 'nomi-local://asset/project-a/recovered.png' },
    })
  })

  // C6（⑬）：已付费任务「重新取回」时，查询被 Nomi 自己挂了提交前的码（出站守卫按提交挂码）——
  // 节点必须留在可找回（主动作 = 再查一次），绝不进带「重试生成」的错误态。
  it('a recovery query refused with a pre-submit code stays recoverable, never the paid-retry error state', async () => {
    const nodeId = recoverableNode({ projectId: 'project-a' })
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockRejectedValue(new Error('NOMI_ERR::outbound-blocked-submit:: 这次生成**没有发出去**'))
    await recoverInOpenProject(nodeId)
    expect(useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)?.status).toBe('recoverable')
  })
})

// 一次出 N 张（设计卡 docs/plan/2026-11-09-multi-result-landing.md ★9 第 4 条）：可找回的那一笔重新取回，
// 交回几张就落几张，都挂这一笔自己的运行记录号；以前只落第一张。
describe('recovery lands every output of the task', () => {
  it.each([1, 2, 4])('重新取回出 %i 张：版本历史 N 条、都挂这一笔的运行记录、当前是最后一张', async (count) => {
    const nodeId = recoverableNode({ projectId: 'project-a' })
    const urls = Array.from({ length: count }, (_, index) => `nomi-local://asset/project-a/recovered-${index + 1}.png`)
    vi.mocked(fetchWorkbenchTaskResultByVendor).mockResolvedValue({
      vendor: 'apimart',
      result: { id: 'task-paid-1', kind: 'text_to_image', status: 'succeeded', assets: urls.map((url) => ({ type: 'image', url })), raw: {} },
    })
    await recoverInOpenProject(nodeId)

    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)!
    const history = [...(node.history ?? [])].sort((left, right) => (left.versionNo ?? 0) - (right.versionNo ?? 0))
    expect(history.map((entry) => entry.url)).toEqual(urls)
    expect(history.every((entry) => entry.taskId === 'task-paid-1')).toBe(true)
    expect(node.runs).toHaveLength(1)
    expect(node.runs?.[0]).toMatchObject({ id: 'run-1', status: 'success', resultId: history.at(-1)!.id })
    expect(node.result?.url).toBe(urls.at(-1))
    expect(vi.mocked(fetchWorkbenchTaskResultByVendor)).toHaveBeenCalledOnce()
  })
})
