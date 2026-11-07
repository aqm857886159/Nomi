// 类测试：素材库列出来的每一种素材 × 每扇删除门 × 项目开着 / 关着，删了必须有确定的结果——
// 要么「删掉」（结果从卡上摘掉 / 文件进回收站或延后真删，并且这扇门的列表里不再有它），
// 要么「留着」并计入 keptInUseCount（还被别处用着，列表里照样在）。
// 不许出现四个计数全 0 的格：那就是 2026-10-24 夜跑 asset-library-interactions ⑤ 的样子
// （删除口一张都没认出来，面板只能说「暂时无法删除」）。
//
// 素材不手写：三扇门的素材都由列表的真产出口造（canvasNodeToAssetRefs / workspaceNodeToAssetRef /
// assetRefFromDesktopAsset），两个页签再走一遍面板同款的合流去重、待删过滤——以后列表多一种素材，这张表跟着多一格。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../generationCanvas/model/generationCanvasTypes'
import type { ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import type { DesktopAssetDto } from '../../desktop/bridge'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import type { TimelineState } from '../timeline/timelineTypes'

const mocks = vi.hoisted(() => ({
  deleteFiles: vi.fn(),
  persistNow: vi.fn(),
  readLocalProjectAsync: vi.fn(),
  saveLocalProject: vi.fn(),
}))

vi.mock('../../desktop/bridge', () => ({
  getDesktopBridge: () => ({ workspace: { deleteFiles: mocks.deleteFiles } }),
}))
vi.mock('../project/workbenchProjectSession', () => ({
  persistActiveWorkbenchProjectNow: mocks.persistNow,
}))
vi.mock('../library/localProjectStore', () => ({
  readLocalProjectAsync: mocks.readLocalProjectAsync,
  saveLocalProject: mocks.saveLocalProject,
}))

import { deleteAssetResult, type DeleteAssetResultOutcome } from './deleteAssetResult'
import { canvasNodeToAssetRefs, workspaceNodeToAssetRef, type AssetRef } from './assetTypes'
import { assetRefFromDesktopAsset, mergeAssetRefs } from './useAllProjectAssets'
import { filterCanvasLibraryAssets } from './assetLibrarySources'
import {
  __resetPendingAssetDeletionsForTests,
  isAssetFileAwaitingTrash,
  listPersistedAssetDeletions,
  readPendingAssetDeletionsVersion,
  releaseLoadedProjectAssetDeletions,
  subscribePendingAssetDeletions,
  withoutFilesAwaitingTrash,
} from './pendingAssetDeletions'
import { __resetCanvasUndoJournalForTests } from '../generationCanvas/events/canvasUndoJournal'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { createDefaultTimeline } from '../timeline/timelineMath'

const PROJECT = 'p1'
const OTHER_PROJECT = 'p2'
const url = (relativePath: string, projectId = PROJECT): string => `nomi-local://asset/${projectId}/${relativePath}`

const FILES = {
  gen: 'assets/generated/gen.png',
  shared: 'assets/generated/shared.png',
  video: 'assets/generated/v.mp4',
  poster: 'assets/generated/poster.png',
  boardOut: 'assets/generated/board-out.png',
  spare: 'assets/imported/spare.png',
  clip: 'assets/imported/clip.mp4',
  onTimeline: 'assets/imported/on-timeline.png',
  layer: 'assets/imported/layer.png',
} as const

function imageResult(id: string, resultUrl: string): GenerationNodeResult {
  return { id, type: 'image', url: resultUrl, createdAt: 1 }
}

function node(id: string, result: GenerationNodeResult, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return { id, kind: result.type === 'video' ? 'video' : 'image', title: id, position: { x: 0, y: 0 }, status: 'success', result, history: [result], ...extra }
}

/** 一个项目里能同时出现的全部素材形态。 */
function fixtureNodes(): GenerationCanvasNode[] {
  return [
    node('n-gen', imageResult('g1', url(FILES.gen))),
    node('n-shared-a', imageResult('sa', url(FILES.shared))),
    node('n-shared-b', imageResult('sb', url(FILES.shared))),
    // 视频结果的封面是一张独立落盘的图：它出现在列表里，但它不是任何结果「本身」。
    node('n-video', { id: 'v1', type: 'video', url: url(FILES.video), thumbnailUrl: url(FILES.poster), createdAt: 1 }),
    // 白板：图层文件只挂在 meta.whiteboardState 里。
    node('n-board', imageResult('b1', url(FILES.boardOut)), { meta: { whiteboardState: { canvasAssets: [{ url: url(FILES.layer) }] } } }),
    node('n-remote', imageResult('r1', 'https://cdn.example.test/r.png')),
    // 画布结果指向别的项目的文件（旧数据）：那份文件永远轮不到这个项目来删。
    node('n-foreign', imageResult('f1', url('assets/x.png', OTHER_PROJECT))),
  ]
}

function fixtureTimeline(): TimelineState {
  return {
    ...createDefaultTimeline(),
    tracks: [{
      id: 'imageTrack', type: 'image', label: 'image', clips: [{
        id: 'clip-1', type: 'image', sourceNodeId: 'n-gone', label: 'on-timeline', startFrame: 0, endFrame: 30, frameCount: 30,
        offsetStartFrame: 0, offsetEndFrame: 0, url: url(FILES.onTimeline),
      }],
    }],
  } as TimelineState
}

function workspaceFile(relativePath: string): WorkspaceFileNode {
  const name = relativePath.split('/').pop() ?? relativePath
  const kind = name.endsWith('.mp4') ? 'video' : 'image'
  return { id: relativePath, name, relativePath, kind, contentType: kind === 'video' ? 'video/mp4' : 'image/png' }
}

function desktopAsset(relativePath: string, ownerNodeId?: string): DesktopAssetDto {
  const name = relativePath.split('/').pop() ?? relativePath
  return {
    id: `asset-${name}`, name, userId: 'local', projectId: PROJECT,
    createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z',
    data: { relativePath, contentType: name.endsWith('.mp4') ? 'video/mp4' : 'image/png', ...(ownerNodeId ? { ownerNodeId } : {}) },
  }
}

const ALL_FILES: readonly string[] = Object.values(FILES)

/** 「项目素材」页签：画布结果 + 落盘文件，和面板同款合流去重（画布优先）、不列待删的文件。 */
function projectTabAssets(nodes: readonly GenerationCanvasNode[], onDisk: readonly string[] = ALL_FILES): AssetRef[] {
  const canvas = nodes.flatMap(canvasNodeToAssetRefs)
  const files = onDisk.flatMap((relativePath) => workspaceNodeToAssetRef(workspaceFile(relativePath), PROJECT) ?? [])
  return filterCanvasLibraryAssets(mergeAssetRefs(canvas, withoutFilesAwaitingTrash(files)))
}

/** 「全部素材」页签：项目落盘素材清单（sidecar 里可能带着生成它的节点），不列待删的文件。 */
function allTabAssets(onDisk: readonly string[] = ALL_FILES): AssetRef[] {
  const owners: Partial<Record<string, string>> = { [FILES.gen]: 'n-gen', [FILES.shared]: 'n-shared-a', [FILES.video]: 'n-video', [FILES.boardOut]: 'n-board' }
  return filterCanvasLibraryAssets(withoutFilesAwaitingTrash(onDisk.flatMap((relativePath) => assetRefFromDesktopAsset(desktopAsset(relativePath, owners[relativePath])) ?? [])))
}

/** 版本卡片：只删某一张卡上的某一版。 */
function versionCardAssets(nodes: readonly GenerationCanvasNode[]): AssetRef[] {
  return nodes.flatMap(canvasNodeToAssetRefs)
}

function loadedContext(): ProjectExecutionContext {
  return { binding: { projectId: PROJECT, immutableProjectUuid: `uuid-${PROJECT}`, projectGeneration: 1 }, signal: new AbortController().signal, assertCurrent: () => undefined }
}

/** 删除排队期间项目已经换掉：这一刻它是关闭的项目，删除口按盘上的 record 改。 */
function closedContext(): ProjectExecutionContext {
  return { ...loadedContext(), assertCurrent: () => { throw new Error('project switched') } }
}

type Fate = 'trash' | 'keep' | 'none'
type Cell = { door: 'multi-select' | 'single' | 'version-card'; pick: (assets: AssetRef[]) => AssetRef | undefined; label: string; removed: number; file: Fate }

const byFile = (relativePath: string) => (assets: AssetRef[]) => assets.find((asset) => (
  asset.origin.source === 'project' ? asset.origin.relativePath === relativePath : asset.renderUrl === url(relativePath)
))
const byRenderUrl = (renderUrl: string) => (assets: AssetRef[]) => assets.find((asset) => asset.renderUrl === renderUrl)

const CELLS: Cell[] = [
  // 项目素材页签（多选删除）——夜跑 ⑤ 删的就是 spare / clip 这两种。
  { door: 'multi-select', label: '画布结果（只它用这份文件）', pick: byFile(FILES.gen), removed: 1, file: 'trash' },
  { door: 'multi-select', label: '画布结果（文件还被另一张卡用着）', pick: byFile(FILES.shared), removed: 1, file: 'keep' },
  { door: 'multi-select', label: '画布视频结果', pick: byFile(FILES.video), removed: 1, file: 'trash' },
  { door: 'multi-select', label: '画布结果（网络地址，无落盘文件）', pick: byRenderUrl('https://cdn.example.test/r.png'), removed: 1, file: 'none' },
  { door: 'multi-select', label: '画布结果（指向别的项目的文件）', pick: byRenderUrl(url('assets/x.png', OTHER_PROJECT)), removed: 1, file: 'none' },
  { door: 'multi-select', label: '白板卡的结果', pick: byFile(FILES.boardOut), removed: 1, file: 'trash' },
  { door: 'multi-select', label: '只在项目里的图（导入、没上画布）', pick: byFile(FILES.spare), removed: 0, file: 'trash' },
  { door: 'multi-select', label: '只在项目里的视频（导入、没上画布）', pick: byFile(FILES.clip), removed: 0, file: 'trash' },
  { door: 'multi-select', label: '只被时间轴片段用着的图', pick: byFile(FILES.onTimeline), removed: 0, file: 'keep' },
  { door: 'multi-select', label: '白板图层文件', pick: byFile(FILES.layer), removed: 0, file: 'keep' },
  { door: 'multi-select', label: '视频结果的封面文件', pick: byFile(FILES.poster), removed: 0, file: 'keep' },
  // 全部素材页签（格子上的单张删除）：每一张都是落盘文件。
  { door: 'single', label: '生成文件（sidecar 记着节点）', pick: byFile(FILES.gen), removed: 1, file: 'trash' },
  { door: 'single', label: '两张卡共用的文件', pick: byFile(FILES.shared), removed: 2, file: 'trash' },
  { door: 'single', label: '视频文件', pick: byFile(FILES.video), removed: 1, file: 'trash' },
  { door: 'single', label: '只在项目里的图', pick: byFile(FILES.spare), removed: 0, file: 'trash' },
  { door: 'single', label: '只被时间轴用着的图', pick: byFile(FILES.onTimeline), removed: 0, file: 'keep' },
  { door: 'single', label: '白板图层文件', pick: byFile(FILES.layer), removed: 0, file: 'keep' },
  { door: 'single', label: '视频封面文件', pick: byFile(FILES.poster), removed: 0, file: 'keep' },
  // 版本卡片：删一版。
  { door: 'version-card', label: '删一版（文件只它用）', pick: byFile(FILES.gen), removed: 1, file: 'trash' },
  { door: 'version-card', label: '删一版（文件还被另一张卡用着）', pick: byFile(FILES.shared), removed: 1, file: 'keep' },
  { door: 'version-card', label: '删一版视频', pick: byFile(FILES.video), removed: 1, file: 'trash' },
]

function populationFor(door: Cell['door'], nodes: readonly GenerationCanvasNode[], onDisk: readonly string[] = ALL_FILES): AssetRef[] {
  if (door === 'multi-select') return projectTabAssets(nodes, onDisk)
  if (door === 'single') return allTabAssets(onDisk)
  return versionCardAssets(nodes)
}

/** 删完以后盘上还剩哪些文件（进了回收站的就没了；延后真删的还在盘上，由待删过滤藏起来）。 */
function filesStillOnDisk(): string[] {
  const trashed = new Set(mocks.deleteFiles.mock.calls.flatMap(([payload]) => (payload as { relativePaths: string[] }).relativePaths))
  return ALL_FILES.filter((relativePath) => !trashed.has(relativePath))
}

/** 这扇门的列表里还认不认得出这一张：项目素材按地址合流（同一份文件只一格），另两扇门按身份。 */
function stillListed(door: Cell['door'], asset: AssetRef, listed: readonly AssetRef[]): boolean {
  return door === 'multi-select'
    ? listed.some((candidate) => candidate.renderUrl === asset.renderUrl)
    : listed.some((candidate) => candidate.id === asset.id)
}

/** 删掉的不该再列；留着的（还被用着）照样列。版本卡片删的是这一版，删了就一定不在这张卡上了。 */
function expectListedAfter(cell: Cell): boolean {
  return cell.door !== 'version-card' && cell.file === 'keep'
}

function expectedOutcome(cell: Cell, mode: 'loaded' | 'closed'): DeleteAssetResultOutcome {
  const trash = cell.file === 'trash'
  // 已加载项目里摘了结果 = 打了一个撤销步：文件等撤销退不回这一步再真删；没有撤销步可挂的（只删文件）当场进回收站。
  const deferred = mode === 'loaded' && trash && cell.removed > 0 ? 1 : 0
  return {
    removedResultCount: cell.removed,
    deletedFileCount: trash && !deferred ? 1 : 0,
    deferredFileCount: deferred,
    failedFileCount: 0,
    keptInUseCount: cell.file === 'keep' ? 1 : 0,
  }
}

let diskProject: { id: string; name: string; payload: { generationCanvas: { nodes: GenerationCanvasNode[]; edges: never[]; groups: never[] }; timeline: TimelineState } }

function resetFixture(): void {
  __resetPendingAssetDeletionsForTests()
  __resetCanvasUndoJournalForTests()
  mocks.deleteFiles.mockReset()
  mocks.persistNow.mockReset()
  mocks.readLocalProjectAsync.mockReset()
  mocks.saveLocalProject.mockReset()
  mocks.persistNow.mockResolvedValue({ id: PROJECT })
  mocks.deleteFiles.mockImplementation(async ({ relativePaths }: { relativePaths: string[] }) => ({ deletedCount: relativePaths.length, failedCount: 0 }))
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: fixtureNodes(), edges: [], groups: [], selectedNodeIds: [] })
  useWorkbenchStore.getState().setTimeline(fixtureTimeline())
  diskProject = { id: PROJECT, name: 'matrix', payload: { generationCanvas: { nodes: fixtureNodes(), edges: [], groups: [] }, timeline: fixtureTimeline() } }
  mocks.readLocalProjectAsync.mockImplementation(async () => diskProject)
  mocks.saveLocalProject.mockImplementation(async (_id: string, payload: typeof diskProject.payload) => {
    diskProject = { ...diskProject, payload }
    return diskProject
  })
}

function liveNodes(mode: 'loaded' | 'closed'): GenerationCanvasNode[] {
  return mode === 'loaded' ? useGenerationCanvasStore.getState().nodes : diskProject.payload.generationCanvas.nodes
}

describe('素材库删除：每种素材 × 每扇门 × 项目开着 / 关着', () => {
  beforeEach(resetFixture)

  for (const mode of ['loaded', 'closed'] as const) {
    for (const cell of CELLS) {
      it(`${mode} · ${cell.door} · ${cell.label}`, async () => {
        const asset = cell.pick(populationFor(cell.door, fixtureNodes()))
        expect(asset, '这一种素材得出现在这扇门的列表里').toBeDefined()
        const videoBefore = liveNodes(mode).find((candidate) => candidate.id === 'n-video')?.result?.id

        const outcome = await deleteAssetResult(asset!, mode === 'loaded' ? loadedContext() : closedContext())

        expect({ ...outcome, keptInUseCount: outcome.keptInUseCount ?? 0 }).toEqual(expectedOutcome(cell, mode))
        // 别的项目的文件：这个项目永远不删、也不记待删。
        for (const call of mocks.deleteFiles.mock.calls) expect(call[0].projectId).toBe(PROJECT)
        expect((listPersistedAssetDeletions() ?? []).every((entry) => !entry.relativePath.startsWith('assets/x.png'))).toBe(true)
        // 删封面 / 白板图层 / 时间轴上的图：画布一张结果都不许少（「其他结果都会保留」）。
        if (cell.file === 'keep' && cell.removed === 0) {
          expect(liveNodes(mode).map((candidate) => candidate.result?.id)).toEqual(fixtureNodes().map((candidate) => candidate.result?.id))
        }
        if (cell.label.includes('封面')) expect(liveNodes(mode).find((candidate) => candidate.id === 'n-video')?.result?.id).toBe(videoBefore)
        // 删完以后这扇门的列表：删掉的不再列（延后真删的文件也不列），留着的照样在。
        const listedAfter = populationFor(cell.door, liveNodes(mode), filesStillOnDisk())
        expect(stillListed(cell.door, asset!, listedAfter), '删完以后列表里还在不在').toBe(expectListedAfter(cell))
      })
    }
  }

  it('已加载项目删画布卡的素材：等撤销窗口的文件两个页签都不列，⌘Z 撤回后回来', async () => {
    const asset = byFile(FILES.gen)(projectTabAssets(fixtureNodes()))!
    const notifications = vi.fn()
    const unsubscribe = subscribePendingAssetDeletions(notifications)
    const versionBefore = readPendingAssetDeletionsVersion()

    const outcome = await deleteAssetResult(asset, loadedContext())

    expect(outcome.deferredFileCount).toBe(1)
    expect(readPendingAssetDeletionsVersion()).toBeGreaterThan(versionBefore)
    expect(notifications).toHaveBeenCalled()
    // 文件还在盘上（等撤销窗口），但已经删了：两个页签都不列。
    expect(filesStillOnDisk()).toContain(FILES.gen)
    expect(isAssetFileAwaitingTrash({ projectId: PROJECT, relativePath: FILES.gen })).toBe(true)
    expect(stillListed('multi-select', asset, projectTabAssets(liveNodes('loaded')))).toBe(false)
    expect(allTabAssets().some((candidate) => candidate.origin.source === 'project' && candidate.origin.relativePath === FILES.gen)).toBe(false)

    // ⌘Z：那一版回到卡上 = 又有人用，照常列；到点也只销账、不删。
    useGenerationCanvasStore.getState().undo()
    expect(isAssetFileAwaitingTrash({ projectId: PROJECT, relativePath: FILES.gen })).toBe(false)
    expect(stillListed('multi-select', asset, projectTabAssets(liveNodes('loaded')))).toBe(true)
    expect(allTabAssets().some((candidate) => candidate.origin.source === 'project' && candidate.origin.relativePath === FILES.gen)).toBe(true)
    await releaseLoadedProjectAssetDeletions()
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('延后真删到点、正在进回收站时照样不列；进完以后待删清单放手（列表由删除广播刷新）', async () => {
    const asset = byFile(FILES.gen)(projectTabAssets(fixtureNodes()))!
    await deleteAssetResult(asset, loadedContext())
    let finishTrash: (value: { deletedCount: number; failedCount: number }) => void = () => undefined
    mocks.deleteFiles.mockImplementationOnce(() => new Promise((resolve) => { finishTrash = resolve }))

    const releasing = releaseLoadedProjectAssetDeletions()

    expect(mocks.deleteFiles).toHaveBeenCalledWith({ projectId: PROJECT, relativePaths: [FILES.gen] })
    expect(isAssetFileAwaitingTrash({ projectId: PROJECT, relativePath: FILES.gen })).toBe(true)
    expect(allTabAssets().some((candidate) => candidate.origin.source === 'project' && candidate.origin.relativePath === FILES.gen)).toBe(false)
    finishTrash({ deletedCount: 1, failedCount: 0 })
    await releasing
    expect(isAssetFileAwaitingTrash({ projectId: PROJECT, relativePath: FILES.gen })).toBe(false)
    expect(listPersistedAssetDeletions()).toBeUndefined()
  })

  it('列表里的每一张素材删了都有结果（没有四个计数全 0 的格）', async () => {
    for (const mode of ['loaded', 'closed'] as const) {
      for (const door of ['multi-select', 'single', 'version-card'] as const) {
        for (const asset of populationFor(door, fixtureNodes())) {
          resetFixture()
          const outcome = await deleteAssetResult(asset, mode === 'loaded' ? loadedContext() : closedContext())
          const total = outcome.removedResultCount + outcome.deletedFileCount + outcome.deferredFileCount + outcome.failedFileCount + (outcome.keptInUseCount ?? 0)
          expect(total, `${mode} · ${door} · ${asset.name}`).toBeGreaterThan(0)
        }
      }
    }
  })
  it.each([FILES.onTimeline, FILES.layer, FILES.poster])('browser origin-only request preserves referenced file %s without invented display metadata', async (relativePath) => {
    const before = useGenerationCanvasStore.getState().nodes
    const outcome = await deleteAssetResult({ origin: { source: 'project', projectId: PROJECT, relativePath } }, loadedContext())
    expect(outcome.keptInUseCount).toBe(1)
    expect(outcome.removedResultCount).toBe(0)
    expect(useGenerationCanvasStore.getState().nodes).toBe(before)
    expect(mocks.deleteFiles).not.toHaveBeenCalled()
  })

  it('a bound child request queued behind another deletion is revoked when its parent epoch changes', async () => {
    let finishTrash!: (value: { deletedCount: number; failedCount: number }) => void
    mocks.deleteFiles.mockImplementationOnce(() => new Promise(resolve => { finishTrash = resolve }))
    const first = deleteAssetResult({ origin: { source: 'project', projectId: PROJECT, relativePath: FILES.spare } }, loadedContext())
    await vi.waitFor(() => expect(mocks.deleteFiles).toHaveBeenCalledOnce())
    let current = true
    const queued = deleteAssetResult({ origin: { source: 'project', projectId: PROJECT, relativePath: FILES.clip } }, loadedContext(), () => {
      if (!current) throw new Error('project_binding_stale')
    })
    const rejected = expect(queued).rejects.toThrow('project_binding_stale')
    current = false
    finishTrash({ deletedCount: 1, failedCount: 0 })
    await first
    await rejected
    expect(mocks.deleteFiles).toHaveBeenCalledOnce()
  })

})
