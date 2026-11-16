// 素材文件存活判定（整份项目内容扫描）的性质与边界：地址的各种写法、读不全一律保留、撤销材料何时算、
// 列表记忆随 store 失效、旧版本存下的待删清单按新判定重判、真实落地的结果删掉后照旧回收。
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'

const mocks = vi.hoisted(() => ({ deleteFiles: vi.fn(), persistNow: vi.fn() }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({ workspace: { deleteFiles: mocks.deleteFiles } }) }))

import { collectProjectFileReferences, isProjectFileReferenced, planAssetDeletion } from './assetResultDeletion'
import { readLoadedProjectLivenessContent } from './projectLivenessContent'
import {
  __resetPendingAssetDeletionsForTests,
  deferAssetFileDeletion,
  isAssetFileAwaitingTrash,
  releaseLoadedProjectAssetDeletions,
  sweepPersistedAssetDeletions,
  withoutFilesAwaitingTrash,
} from './pendingAssetDeletions'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { __resetCanvasUndoJournalForTests } from '../generationCanvas/events/canvasUndoJournal'
import { restoreWorkbenchProjectPayload } from '../project/workbenchProjectSession'
import * as projectContent from '../project/workbenchProjectContent'
import { createDefaultTimeline } from '../timeline/timelineMath'
import { buildClipFromAssetRef } from '../timeline/buildClipFromAssetRef'
import type { WorkbenchProjectPayload } from '../project/projectRecordSchema'
import type { AssetRef } from './assetTypes'

const P = 'project-1'
const target = { projectId: P, relativePath: 'assets/generated/a.png' }
const scan = (rest: unknown, nodes: GenerationCanvasNode[] = []) => isProjectFileReferenced(target, collectProjectFileReferences(nodes, rest))

beforeEach(() => {
  mocks.deleteFiles.mockReset()
  mocks.deleteFiles.mockImplementation(async ({ relativePaths }: { relativePaths: string[] }) => ({ deletedPaths: relativePaths, failed: [] }))
  __resetPendingAssetDeletionsForTests(); __resetCanvasUndoJournalForTests()
  useWorkbenchStore.setState({ storyboardDesignsByDocumentId: {}, workbenchDocuments: [], projectAgentAttachments: [], projectAgentReferences: [], projectAgentRecoveredDrafts: [], timelineUndoStack: [], timelineRedoStack: [], detachedTimelineClips: {} } as never)
  useGenerationCanvasStore.setState({ generationAiDraft: '' } as never)
  useWorkbenchStore.getState().setTimeline(createDefaultTimeline())
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] }, P)
})

describe('地址的写法：指向这份文件的都算有人用', () => {
  const hits: Array<[string, unknown]> = [
    ['本地地址', 'nomi-local://asset/project-1/assets/generated/a.png'],
    ['带查询串和锚点', 'nomi-local://asset/project-1/assets/generated/a.png?v=3#crop'],
    ['百分号编码', 'nomi-local://asset/project-1/assets/generated/%61.png'],
    ['制作预览地址', 'nomi-local://production-preview/project-1/run-1/artifact-1/assets/generated/a.png?preview=1'],
    ['长文本里夹着', '镜头 3 参考 nomi-local://asset/project-1/assets/generated/a.png 的光线'],
    ['富文本 JSON 串里', JSON.stringify({ type: 'image', attrs: { src: 'nomi-local://asset/project-1/assets/generated/a.png' } })],
    ['裸相对路径', 'assets/generated/a.png'],
    ['时间轴 asset: 前缀', 'asset:assets/generated/a.png'],
    ['时间轴片段来源 asset:<项目>:<路径>', 'asset:project-1:assets/generated/a.png'],
    ['file:// 绝对路径', 'file:///Users/someone/Nomi/project-1/assets/generated/a.png'],
    ['Windows 反斜杠', 'C:\\Nomi\\project-1\\assets\\generated\\a.png'],
    ['大小写不同', 'nomi-local://asset/project-1/Assets/Generated/A.PNG'],
    ['对象的键', { 'nomi-local://asset/project-1/assets/generated/a.png': { weight: 1 } }],
    ['Map 里', new Map([['ref', 'nomi-local://asset/project-1/assets/generated/a.png']])],
    ['Set 里', new Set(['assets/generated/a.png'])],
    ['深层数组', [[[[{ deep: ['nomi-local://asset/project-1/assets/generated/a.png'] }]]]]],
  ]
  for (const [label, value] of hits) it(label, () => expect(scan({ value })).toBe(true))

  it('Unicode 组合形式不同（NFD 存、NFC 比）也算', () => {
    const nfc = { projectId: P, relativePath: 'assets/generated/é.png' }
    const refs = collectProjectFileReferences([], { s: 'nomi-local://asset/project-1/assets/generated/e\u0301.png' })
    expect(isProjectFileReferenced(nfc, refs)).toBe(true)
  })

  const misses: Array<[string, unknown]> = [
    ['别的项目的同名文件', 'nomi-local://asset/project-2/assets/generated/a.png'],
    ['data: 内嵌图', 'data:image/png;base64,assets/generated/a.png'],
    ['外网地址', 'https://cdn.example.invalid/assets/generated/a.png'],
    ['只是同名不同目录', 'assets/other/a.png'],
    ['只有文件名', 'a.png'],
    ['类型串', 'image/png'],
  ]
  for (const [label, value] of misses) it(`不算：${label}`, () => expect(scan({ value })).toBe(false))

  it('循环引用不卡死', () => {
    const loop: Record<string, unknown> = { url: 'nomi-local://asset/project-1/assets/generated/a.png' }
    loop.self = loop
    expect(scan(loop)).toBe(true)
  })

  it('节点的运行记录不算（它回显的是那次落盘的文件，不是在用）', () => {
    const node = { id: 'n', kind: 'image', position: { x: 0, y: 0 },
      runs: [{ id: 'r', status: 'success', raw: { asset: { data: { relativePath: 'assets/generated/a.png' } } } }] } as unknown as GenerationCanvasNode
    expect(scan({}, [node])).toBe(false)
  })
})

describe('经装配口：项目里各处挂着这份文件都算（真 store）', () => {
  const url = 'nomi-local://asset/project-1/assets/generated/a.png'
  const node = (patch: Partial<GenerationCanvasNode>): GenerationCanvasNode => ({ id: 'consumer', kind: 'image', title: 'c', position: { x: 0, y: 0 }, ...patch } as GenerationCanvasNode)
  const places: Array<[string, () => void]> = [
    ['节点提示词里夹着', () => useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node({ prompt: `参考 ${url} 的构图` })], edges: [], groups: [] }, P)],
    ['节点 meta 任意字段（artifact.url）', () => useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node({ meta: { artifact: { url } } as never })], edges: [], groups: [] }, P)],
    ['别的节点的结果封面', () => useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node({ result: { id: 'v', type: 'video', url: 'nomi-local://asset/project-1/assets/generated/v.mp4', thumbnailUrl: url, createdAt: 1 } as never })], edges: [], groups: [] }, P)],
    ['原稿正文', () => useWorkbenchStore.setState({ workbenchDocuments: [{ id: 'doc', title: 't', contentJson: { type: 'doc', content: [{ type: 'image', attrs: { src: url } }] } }] as never })],
    ['分镜方案的首帧规划图', () => useWorkbenchStore.setState({ storyboardDesignsByDocumentId: { d: [{ plan: { shots: [{ firstFramePlan: { imageUrl: url } }] } }] } as never })],
    ['时间轴片段（素材库拖进来的，真构造器）', () => {
      const clip = buildClipFromAssetRef({ id: 'project-1:assets/generated/a.png', kind: 'image', name: 'a', renderUrl: url, source: 'project', origin: { source: 'project', ...target } }, { fps: 30, startFrame: 0 })
      const timeline = createDefaultTimeline()
      useWorkbenchStore.getState().setTimeline({ ...timeline, tracks: timeline.tracks.map((track) => track.type === 'image' ? { ...track, clips: [clip!] } : track) })
      expect(JSON.stringify(useWorkbenchStore.getState().timeline)).toContain('a.png')
    }],
    ['助手输入框的引用', () => useWorkbenchStore.setState({ projectAgentReferences: [{ url }] } as never)],
    ['找回的未发草稿', () => useWorkbenchStore.setState({ projectAgentRecoveredDrafts: [{ projectUuid: 'uuid-1', attachments: [{ url }] }] } as never)],
    ['画布 AI 输入框草稿', () => useGenerationCanvasStore.setState({ generationAiDraft: `看看 ${url}` } as never)],
  ]
  for (const [label, arrange] of places) it(label, () => {
    arrange()
    const live = readLoadedProjectLivenessContent(P, 'alive')
    expect(live).not.toBeNull()
    expect(isProjectFileReferenced(target, collectProjectFileReferences(live!.nodes, live!.rest))).toBe(true)
  })

  it('性质：往项目内容里任意新字段、任意深度放这份文件的任意一种写法，都判有人用（300 次随机）', () => {
    const forms = [url, `${url}?v=2`, `前后文 ${url} 前后文`, 'assets/generated/a.png', 'asset:assets/generated/a.png', 'nomi-local://asset/project-1/assets/generated/%61.png']
    let seed = 20261117
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const live = readLoadedProjectLivenessContent(P, 'alive')!
    for (let round = 0; round < 300; round += 1) {
      let leaf: unknown = forms[rand(forms.length)]
      for (let depth = rand(8); depth > 0; depth -= 1) leaf = rand(2) ? [leaf] : { [`k${rand(1000)}`]: leaf, other: rand(10) }
      const rest = { ...(live.rest as Record<string, unknown>), [`newField${round}`]: leaf }
      expect(isProjectFileReferenced(target, collectProjectFileReferences(live.nodes, rest))).toBe(true)
    }
  })
})

describe('读不全一律保留', () => {
  it('没有索引 = 有人用', () => expect(isProjectFileReferenced(target, null)).toBe(true))
  it('画布没载入 / 载入的不是这个项目 → 读不到', () => {
    expect(readLoadedProjectLivenessContent('project-2', 'alive')).toBeNull()
    useGenerationCanvasStore.setState({ isReady: false })
    expect(readLoadedProjectLivenessContent(P, 'alive')).toBeNull()
  })
  it('装配抛错 → 读不到 → 删除判保留', () => {
    const spy = vi.spyOn(projectContent, 'readCurrentWorkbenchProjectContent').mockImplementation(() => { throw new Error('boom') })
    try {
      expect(readLoadedProjectLivenessContent(P, 'alive')).toBeNull()
      const node = { id: 'n', kind: 'image', position: { x: 0, y: 0 }, result: image('a'), history: [image('a')] } as GenerationCanvasNode
      const plan = planAssetDeletion(canvasAsset('n', 'a'), { projectId: P, nodes: [node], rest: null })
      expect(plan.file?.fate).toBe('keep')
    } finally { spy.mockRestore() }
  })
  it('关项目释放时读不到（条目属于别的项目）：不删、只销账', async () => {
    deferAssetFileDeletion({ projectId: 'project-2', relativePath: 'assets/generated/a.png', journalGeneration: 0, journalPosition: 0 })
    const outcome = await releaseLoadedProjectAssetDeletions()
    expect(outcome.keptReferencedCount).toBe(1)
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })
})

describe('会话撤销材料：会话活着算，关项目那一刻不算', () => {
  it('时间轴撤销栈里的片段', async () => {
    useWorkbenchStore.setState({ timelineUndoStack: [{ tracks: [{ clips: [{ url: 'nomi-local://asset/project-1/assets/generated/a.png' }] }] }] as never })
    const alive = readLoadedProjectLivenessContent(P, 'alive')!
    const ending = readLoadedProjectLivenessContent(P, 'ending')!
    expect(isProjectFileReferenced(target, collectProjectFileReferences(alive.nodes, alive.rest))).toBe(true)
    expect(isProjectFileReferenced(target, collectProjectFileReferences(ending.nodes, ending.rest))).toBe(false)
    deferAssetFileDeletion({ ...target, journalGeneration: 0, journalPosition: 0 })
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId: P, relativePaths: [target.relativePath] })
  })
  it('未发的助手输入关项目时照样算', async () => {
    useWorkbenchStore.getState().setProjectAgentAttachments([{ id: 'att', url: 'nomi-local://asset/project-1/assets/generated/a.png' }] as never)
    deferAssetFileDeletion({ ...target, journalGeneration: 0, journalPosition: 0 })
    const outcome = await releaseLoadedProjectAssetDeletions()
    expect(outcome.keptReferencedCount).toBe(1)
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })
})

describe('素材库列表：记忆跟着 store 变化失效', () => {
  it('删掉后列表不列；之后分镜挂上它，列表马上又列回来', () => {
    const fileAsset: AssetRef = { id: 'f', kind: 'image', name: 'a.png', renderUrl: 'nomi-local://asset/project-1/assets/generated/a.png', source: 'project',
      origin: { source: 'project', ...target } }
    deferAssetFileDeletion({ ...target, journalGeneration: 0, journalPosition: 0 })
    expect(isAssetFileAwaitingTrash(target)).toBe(true)
    expect(withoutFilesAwaitingTrash([fileAsset])).toHaveLength(0)
    useWorkbenchStore.setState({ storyboardDesignsByDocumentId: { d: [{ plan: { shots: [{ referenceBindings: { image_ref: [{ url: fileAsset.renderUrl }] } }] } }] } as never })
    expect(isAssetFileAwaitingTrash(target)).toBe(false)
    expect(withoutFilesAwaitingTrash([fileAsset])).toHaveLength(1)
  })
  it('同一刻的整张列表只扫一次', () => {
    const spy = vi.spyOn(projectContent, 'readCurrentWorkbenchProjectContent')
    try {
      const assets = Array.from({ length: 50 }, (_, index): AssetRef => {
        const relativePath = `assets/generated/${index}.png`
        deferAssetFileDeletion({ projectId: P, relativePath, journalGeneration: 0, journalPosition: 0 })
        return { id: String(index), kind: 'image', name: relativePath, renderUrl: '', source: 'project', origin: { source: 'project', projectId: P, relativePath } }
      })
      spy.mockClear()
      expect(withoutFilesAwaitingTrash(assets)).toHaveLength(0)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally { spy.mockRestore() }
  })
})

describe('老用户：旧版本存下的待删清单按新判定重判（v0.24.1 真实项目文件）', () => {
  it('分镜参考还在用的留下，真没人用的照旧回收', async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/old-user-data/projects/v0.24.1-storyboard/project/.nomi/project.json'), 'utf8'))
    const projectId: string = fixture.id
    // v0.24.1 写下的分镜参考绑定，换成指向本项目文件的地址（旧版本落盘的就是这种地址）。
    const text = JSON.stringify(fixture.payload).replaceAll('https://example.invalid/old-reader.png', `nomi-local://asset/${projectId}/assets/generated/bound.png`)
    const payload = { ...JSON.parse(text), pendingAssetDeletions: [{ relativePath: 'assets/generated/bound.png' }, { relativePath: 'assets/generated/unused.png' }] } as WorkbenchProjectPayload
    restoreWorkbenchProjectPayload(payload, projectId)
    const outcome = await sweepPersistedAssetDeletions(projectId, payload.pendingAssetDeletions)
    expect(outcome.keptReferencedCount).toBe(1)
    expect(mocks.deleteFiles).toHaveBeenCalledTimes(1)
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId, relativePaths: ['assets/generated/unused.png'] })
  })
})

describe('对照：真实落地的结果删掉后照旧回收（扫描不能把什么都留下）', () => {
  it('经运行结局落地的一版，删掉后进待删、关项目时真删', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ id: 'n', kind: 'image', title: 'n', position: { x: 0, y: 0 }, status: 'idle' }], edges: [], groups: [] }, P)
    const store = useGenerationCanvasStore.getState()
    store.applyRunOutcome('n', { kind: 'run-started', run: { id: 'run-1', status: 'running', startedAt: 1, updatedAt: 1 } as never })
    store.addNodeResult('n', { ...image('a'), assetId: 'asset-a', taskId: 'task-1',
      raw: { asset: { data: { relativePath: target.relativePath, url: image('a').url } } } } as GenerationNodeResult, undefined, 'run-1')
    const landed = useGenerationCanvasStore.getState().nodes[0]
    expect(landed.result?.id).toBe('a')
    const live = readLoadedProjectLivenessContent(P, 'alive')!
    const plan = planAssetDeletion(canvasAsset('n', 'a'), { projectId: P, nodes: useGenerationCanvasStore.getState().nodes, rest: live.rest })
    expect(plan.file).toEqual({ target, fate: 'trash' })
  })
})

function image(id: string): GenerationNodeResult {
  return { id, type: 'image', url: `nomi-local://asset/${P}/assets/generated/${id}.png`, createdAt: 1 }
}

function canvasAsset(nodeId: string, resultId: string): AssetRef {
  return { id: `${nodeId}:${resultId}`, kind: 'image', name: resultId, renderUrl: image(resultId).url!, ownerResultId: resultId, source: 'canvas', origin: { source: 'canvas', nodeId, resultId } }
}
