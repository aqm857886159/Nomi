// 素材文件存活：真 store + 真删除入口 + 真写盘的项目文件 + 真删除 IPC（只把系统回收站换成临时目录里的改名）。
// 创作者把一张结果挂到分镜参考 / 节点参考 / 助手输入上，再删掉产出它的那一版：
// 删除当场、关项目释放、重开清扫、撤销日志挤出到点，四个时刻文件都必须还在原路径；对照组「真没人用」的照旧回收。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'

const io = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: new Map<string, (event: unknown, payload: unknown) => Promise<any>>(),
  root: '', persistNow: vi.fn(), trash: [] as string[],
}))
vi.mock('electron', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipcMain: { handle: (key: string, handler: any) => io.handlers.set(key, handler) },
  shell: { trashItem: async (target: string) => {
    // 只替换系统回收站这一步：字节真的离开项目目录。
    const destination = path.join(io.root, 'TEST-TRASH', `${io.trash.length}-${path.basename(target)}`)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.renameSync(target, destination)
    io.trash.push(destination)
  } },
}))
vi.mock('../../../electron/ipcSenderGuard', () => ({ assertTrustedSender: () => undefined, assertTrustedUiSender: () => undefined }))
vi.mock('../../../electron/assets/assetEvents', () => ({ broadcastAssetsUpdated: () => undefined }))
vi.mock('../../../electron/capabilityCore/rendererBridge', () => ({ requestRenderer: () => { throw new Error('unexpected relay') } }))
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({ workspace: {
  deleteFiles: (payload: unknown) => io.handlers.get('nomi:workspace:delete-files')!({ sender: {} }, payload),
} }) }))
vi.mock('../project/workbenchProjectSession', () => ({ persistActiveWorkbenchProjectNow: io.persistNow }))

import { readWorkspaceManifest, writeWorkspaceManifest } from '../../../electron/workspace/workspaceManifest'
import { registerWorkspaceFileDeleteIpc } from '../../../electron/workspace/workspaceFileDelete'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { clearHistory } from '../generationCanvas/events/canvasPatchHistory'
import { readCurrentWorkbenchProjectContent } from '../project/workbenchProjectContent'
import { deleteAssetResult } from './deleteAssetResult'
import { __resetPendingAssetDeletionsForTests, listPersistedAssetDeletions, releaseLoadedProjectAssetDeletions, sweepPersistedAssetDeletions } from './pendingAssetDeletions'
import { createDefaultTimeline } from '../timeline/timelineMath'
import { appendShotBinding } from '../creation/storyboard/shotRow/shotReferenceSlots'
import { referenceListPatch } from '../generationCanvas/nodes/controls/referenceList'

const projectId = 'project-1'
const relativePath = 'assets/generated/a.png'
const url = `nomi-local://asset/${projectId}/${relativePath}`
const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const asset: AssetRef = { id: 'producer:a', kind: 'image', name: 'a', renderUrl: url, source: 'canvas', origin: { source: 'canvas', nodeId: 'producer', resultId: 'a' } }
const loaded = { binding: { projectId, immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }, signal: new AbortController().signal, assertCurrent: () => undefined }
const baseNode = (id: string): GenerationCanvasNode => ({ id, kind: 'image', title: id, position: { x: 0, y: 0 }, status: 'idle' })
const filePath = () => path.join(io.root, relativePath)
let originalRoot: string

/** 写盘：和存盘同一个投影（`readCurrentWorkbenchProjectContent`）+ 待删清单，经真 manifest 写进项目目录。 */
function saveProject() {
  const record = { id: projectId, name: 'isolated liveness fixture', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: loaded.binding.immutableProjectUuid, projectGeneration: 1,
    payload: { ...readCurrentWorkbenchProjectContent(), pendingAssetDeletions: listPersistedAssetDeletions() } }
  writeWorkspaceManifest(io.root, record as never)
  return record
}

/** 重开：从盘上读回项目文件，装回画布与工作台（会话态清零，撤销日志为空）。 */
function reopenProject() {
  const record = readWorkspaceManifest(io.root)
  if (!record) throw new Error('project file missing')
  const payload = record.payload as unknown as Record<string, unknown> & { generationCanvas: unknown }
  clearHistory()
  useWorkbenchStore.setState({ storyboardDesignsByDocumentId: (payload.storyboardDesignsByDocumentId ?? {}) as never, projectAgentAttachments: [] })
  useGenerationCanvasStore.getState().restoreSnapshot(payload.generationCanvas, projectId)
  return payload
}

type Case = 'storyboard-binding' | 'ordinary-node-reference' | 'assistant-input' | 'unused-control'

/** 分镜第 1 镜的参考位挂上这份文件（走分镜自己的挂参考入口）。 */
function arrangeStoryboardBinding() {
  const shot = { index: 1, durationSec: 3, anchorIds: [], prompt: 'fixture' }
  const added = appendShotBinding(shot, { kind: 'image_ref', label: 'reference', asArray: true, min: 0, max: 3 }, { url, name: 'a', sourceNodeId: 'producer' }, 'image')
  if (added.status !== 'added') throw new Error('fixture binding failed')
  useWorkbenchStore.setState({ storyboardDesignsByDocumentId: { 'doc-1': [{ id: 'design-1', documentId: 'doc-1', title: 'fixture', committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1,
    plan: { title: 'fixture', anchors: [], shots: [{ ...shot, ...added.patch }] } }] } as never })
}

function arrange(kind: Case) {
  const result = { id: 'a', type: 'image' as const, url, createdAt: 1 }
  const nodes: GenerationCanvasNode[] = [{ ...baseNode('producer'), status: 'success', result, history: [result] }]
  if (kind === 'ordinary-node-reference') nodes.push({ ...baseNode('consumer'), meta: referenceListPatch([url]) } as GenerationCanvasNode)
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [], selectedNodeIds: [] }, projectId)
  if (kind === 'storyboard-binding') arrangeStoryboardBinding()
  if (kind === 'assistant-input') useWorkbenchStore.getState().setProjectAgentAttachments([{ id: 'att-1', fileName: 'a.png', kind: 'image', contentType: 'image/png', sizeBytes: bytes.length, status: 'ready', url, assetId: 'fixture-original', contentHash: 'fixture', version: 1,
    referenceNode: { nodeId: 'producer', resultId: 'a', originalUrl: url } }] as never)
}

/** 那一处引用此刻的样子（删除前后必须一字不差）。 */
function retainedReference(kind: Case): unknown {
  const wb = useWorkbenchStore.getState()
  if (kind === 'storyboard-binding') return (wb.storyboardDesignsByDocumentId['doc-1']?.[0]?.plan.shots[0] as { referenceBindings?: unknown } | undefined)?.referenceBindings
  if (kind === 'ordinary-node-reference') return useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'consumer')?.meta
  if (kind === 'assistant-input') return wb.projectAgentAttachments[0]?.url
  return null
}

function record(kind: string, phase: string, values: Record<string, unknown>) {
  console.log('ASSET_LIVENESS ' + JSON.stringify({ kind, phase, ...values }))
}

beforeEach(() => {
  io.root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-asset-liveness-'))
  originalRoot = io.root
  io.handlers.clear(); io.trash.length = 0
  __resetPendingAssetDeletionsForTests(); clearHistory()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }, projectId)
  useWorkbenchStore.setState({ storyboardDesignsByDocumentId: {}, projectAgentAttachments: [] })
  useWorkbenchStore.getState().setTimeline(createDefaultTimeline())
  fs.mkdirSync(path.dirname(filePath()), { recursive: true })
  fs.writeFileSync(filePath(), bytes)
  io.persistNow.mockImplementation(async () => saveProject())
  registerWorkspaceFileDeleteIpc({ readProject: () => ({ lastKnownRootPath: io.root }), childWindowProject: () => undefined } as never)
})
afterEach(() => {
  __resetPendingAssetDeletionsForTests()
  useWorkbenchStore.setState({ storyboardDesignsByDocumentId: {}, projectAgentAttachments: [] })
  fs.rmSync(originalRoot, { recursive: true, force: true })
})

const UNDO_STEPS_TO_EVICT = 81 // 撤销日志上限 80 步：再多一步，删除那一步就退不回去了。

describe('删掉原结果后，别处还在用的文件不进回收站（真文件）', () => {
  const cases: Case[] = ['storyboard-binding', 'ordinary-node-reference', 'assistant-input', 'unused-control']
  for (const kind of cases) it(kind, async () => {
    const expectKeep = kind !== 'unused-control'
    arrange(kind)
    saveProject()
    const before = JSON.stringify(retainedReference(kind))

    const deleted = await deleteAssetResult(asset, loaded)
    expect(deleted).toMatchObject({ removedResultCount: 1, deletedFileCount: 0, deferredFileCount: expectKeep ? 0 : 1, keptInUseCount: expectKeep ? 1 : 0 })
    expect(fs.existsSync(filePath())).toBe(true)
    const pending = listPersistedAssetDeletions()
    record(kind, 'delete-result', { outcome: deleted, fileAtOriginalPath: true, pending })

    // 关项目：这一刻的待删全部到点。
    const released = await releaseLoadedProjectAssetDeletions()
    expect(fs.existsSync(filePath())).toBe(!expectKeep ? false : true)
    expect(JSON.stringify(retainedReference(kind))).toBe(before)
    record(kind, 'close-project-release', { outcome: released, fileAtOriginalPath: fs.existsSync(filePath()) })

    // 重开清扫：模拟 App 直接退出——结果已摘、文件没删、待删清单在项目文件里（按旧版本会写下的样子补一笔）。
    if (!expectKeep) fs.renameSync(io.trash[0], filePath())
    io.trash.length = 0
    const onDisk = reopenProject()
    const leftover = (onDisk.pendingAssetDeletions as unknown[] | undefined) ?? [{ relativePath }]
    if (kind === 'assistant-input') useWorkbenchStore.getState().setProjectAgentAttachments([{ id: 'att-1', fileName: 'a.png', kind: 'image', contentType: 'image/png', sizeBytes: bytes.length, status: 'ready', url, assetId: 'fixture-original', contentHash: 'fixture', version: 1 }] as never)
    const swept = await sweepPersistedAssetDeletions(projectId, leftover)
    expect(fs.existsSync(filePath())).toBe(expectKeep)
    expect(JSON.stringify(retainedReference(kind))).toBe(before)
    expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'producer')?.history ?? []).toHaveLength(0)
    record(kind, 'reopen-sweep', { outcome: swept, fileAtOriginalPath: fs.existsSync(filePath()) })
    if (!expectKeep) expect(fs.readFileSync(io.trash[0])).toEqual(bytes)
  })
})

// 撤销日志挤出到点：删的那一刻没人用（记待删），之后创作者把同一份文件挂进分镜 / 节点参考（例如撤销回来、挂上、再删那一版），
// 再编辑 81 步把删除那一步挤出撤销日志——到点再判一次引用，挂上的那一处让文件留下；对照组没人挂，照旧进回收站。
describe('撤销日志挤出到点：之后挂上的分镜参考 / 节点参考让文件留下（真文件）', () => {
  const cases = ['storyboard-binding', 'ordinary-node-reference', 'unused-control'] as const
  for (const kind of cases) it(kind, async () => {
    const result = { id: 'a', type: 'image' as const, url, createdAt: 1 }
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ ...baseNode('producer'), status: 'success', result, history: [result] }, baseNode('consumer')], edges: [], groups: [], selectedNodeIds: [] }, projectId)
    saveProject()

    const deleted = await deleteAssetResult(asset, loaded)
    expect(deleted).toMatchObject({ removedResultCount: 1, deferredFileCount: 1, keptInUseCount: 0 })
    expect(listPersistedAssetDeletions()).toEqual([{ relativePath, source: 'asset-library' }])

    if (kind === 'ordinary-node-reference') useGenerationCanvasStore.getState().updateNodes([{ nodeId: 'consumer', patch: { meta: referenceListPatch([url]) } }])
    if (kind === 'storyboard-binding') arrangeStoryboardBinding()
    const before = JSON.stringify(retainedReference(kind))

    for (let step = 0; step < UNDO_STEPS_TO_EVICT; step += 1) useGenerationCanvasStore.getState().updateNodes([{ nodeId: 'producer', patch: { title: `edit ${step}` } }])
    // 挤出时待删同步领走（领走即离开清单），删不删在异步的那一段里定。
    expect(listPersistedAssetDeletions()).toBeUndefined()
    if (kind === 'unused-control') await vi.waitFor(() => expect(fs.existsSync(filePath())).toBe(false))
    else await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fs.existsSync(filePath())).toBe(kind !== 'unused-control')
    expect(JSON.stringify(retainedReference(kind))).toBe(before)
    record(kind, 'undo-eviction-release', { fileAtOriginalPath: fs.existsSync(filePath()), trashed: io.trash.length })
    if (kind === 'unused-control') expect(fs.readFileSync(io.trash[0])).toEqual(bytes)
  })
})
