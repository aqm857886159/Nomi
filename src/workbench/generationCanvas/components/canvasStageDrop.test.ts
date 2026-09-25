import type { DragEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ASSET_LIBRARY_DRAG_MIME, serializeAssetLibraryDrag, type AssetLibraryDragPayload } from '../../assets/assetLibraryDrag'
import { WORKSPACE_FILE_DRAG_MIME } from '../../explorer/workspaceFileDrag'
import { getGenerationNodeDefaultSize, getGenerationNodeFootprintSize } from '../model/generationNodeKinds'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import {
  importBrowserAssetsToGenerationCanvas,
  handleCanvasStageDrop,
  layoutBrowserAssetDropPositions,
  resolveDropOrigin,
} from './canvasStageDrop'

// 放下时签发的是此刻打开的项目 project-a（替身）；复制通道由宿主桥提供（替身）。
const copyProjectAsset = vi.fn()
vi.mock('../../project/projectCanvasReadSurface', () => {
  const project = { binding: { projectId: 'project-a', immutableProjectUuid: 'uuid-a', projectGeneration: 1 }, signal: new AbortController().signal, assertCurrent: () => undefined }
  return { withProjectAction: (run: (issued: typeof project) => unknown) => run(project), isProjectExecutionContextCurrent: () => true }
})
vi.mock('../../../desktop/bridge', () => ({ getDesktopBridge: () => ({ assets: { copyProjectAsset } }) }))

function libraryDrop(items: AssetLibraryDragPayload[]): DragEvent<HTMLDivElement> {
  const raw = serializeAssetLibraryDrag(items)
  return {
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: { getData: (type: string) => (type === ASSET_LIBRARY_DRAG_MIME ? raw : ''), files: [] },
  } as unknown as DragEvent<HTMLDivElement>
}

const dropCtx = { readOnly: false, toCanvasPoint: () => ({ x: 400, y: 300 }), activeCategoryId: 'shots' }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('handleCanvasStageDrop — 素材库拖入只写当前项目自己的引用', () => {
  it('当前项目的素材直接落卡，不复制', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    copyProjectAsset.mockReset()
    handleCanvasStageDrop(libraryDrop([{ kind: 'image', name: 'a.png', renderUrl: 'nomi-local://asset/project-a/assets/a.png', origin: { source: 'project', projectId: 'project-a', relativePath: 'assets/a.png' } }]), dropCtx)
    await settle()
    const [node] = useGenerationCanvasStore.getState().nodes
    expect(copyProjectAsset).not.toHaveBeenCalled()
    expect(node?.result?.url).toBe('nomi-local://asset/project-a/assets/a.png')
  })

  it('别的项目的素材：先复制进当前项目，卡上是复制品的地址（此前整批被拒，拖不出来）', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    copyProjectAsset.mockReset()
    copyProjectAsset.mockResolvedValue({
      id: 'project-a:assets/imported/b-city.png', name: 'b-city.png', projectId: 'project-a', createdAt: '', updatedAt: '',
      data: { url: 'nomi-local://asset/project-a/assets/imported/b-city.png', relativePath: 'assets/imported/b-city.png', contentType: 'image/png' },
    })
    handleCanvasStageDrop(libraryDrop([{ kind: 'image', name: 'b-city.png', renderUrl: 'nomi-local://asset/project-b/assets/b-city.png', origin: { source: 'project', projectId: 'project-b', relativePath: 'assets/b-city.png' } }]), dropCtx)
    await settle()
    const nodes = useGenerationCanvasStore.getState().nodes
    expect(copyProjectAsset).toHaveBeenCalledWith({ sourceProjectId: 'project-b', targetProjectId: 'project-a', relativePath: 'assets/b-city.png' })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.result?.url).toBe('nomi-local://asset/project-a/assets/imported/b-city.png')
    expect(nodes[0]?.meta).toMatchObject({ source: 'workspace-file', workspaceRelativePath: 'assets/imported/b-city.png' })
  })

  it('复制失败就不落卡，也不退回引用别的项目的地址', async () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    copyProjectAsset.mockReset()
    copyProjectAsset.mockRejectedValue(new Error('Source project not found'))
    handleCanvasStageDrop(libraryDrop([{ kind: 'image', name: 'b.png', renderUrl: 'nomi-local://asset/project-b/assets/b.png', origin: { source: 'project', projectId: 'project-b', relativePath: 'assets/b.png' } }]), dropCtx)
    await settle()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  })
})

describe('layoutBrowserAssetDropPositions', () => {
  it('lays multiple browser assets into a non-overlapping grid', () => {
    const positions = layoutBrowserAssetDropPositions({ x: 120, y: 180 }, 5)
    const footprint = getGenerationNodeFootprintSize('asset')

    expect(positions).toHaveLength(5)
    expect(positions[0]).toEqual({ x: 120, y: 180 })
    expect(positions[1].x - positions[0].x).toBeGreaterThanOrEqual(footprint.width)
    expect(positions[3].y - positions[0].y).toBeGreaterThanOrEqual(footprint.height)

    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const separatedX =
          positions[i].x + footprint.width <= positions[j].x ||
          positions[j].x + footprint.width <= positions[i].x
        const separatedY =
          positions[i].y + footprint.height <= positions[j].y ||
          positions[j].y + footprint.height <= positions[i].y
        expect(separatedX || separatedY).toBe(true)
      }
    }
  })

  it('keeps the grabbed point under the mouse cursor', () => {
    const size = getGenerationNodeDefaultSize('asset')
    const cursor = { x: 640, y: 480 }
    const anchor = { xRatio: 0.25, yRatio: 0.75 }
    const position = resolveDropOrigin(cursor, anchor)

    expect(position.x + size.width * anchor.xRatio).toBe(cursor.x)
    expect(position.y + size.height * anchor.yRatio).toBe(cursor.y)
  })
})

describe('importBrowserAssetsToGenerationCanvas', () => {
  it('creates media and prompt nodes from browser asset box payloads', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })

    const result = importBrowserAssetsToGenerationCanvas(
      [
        { id: 'img-1', type: 'image', title: 'image.png', previewUrl: 'nomi-local://project/assets/image.png' },
        { id: 'vid-1', type: 'video', title: 'video.mp4', previewUrl: 'nomi-local://project/assets/video.mp4' },
        { id: 'txt-1', type: 'prompt', title: 'prompt.md', prompt: '雨夜街道\n霓虹反光' },
      ],
      { basePosition: { x: 100, y: 140 }, categoryId: 'shots' },
    )

    expect(result.createdCount).toBe(3)
    const state = useGenerationCanvasStore.getState()
    expect(state.nodes).toHaveLength(3)
    expect(state.nodes.map((node) => node.kind)).toEqual(['asset', 'asset', 'text'])
    expect(state.nodes.map((node) => node.categoryId)).toEqual(['shots', 'shots', 'shots'])
    expect(state.nodes[0]?.result).toMatchObject({ type: 'image', url: 'nomi-local://project/assets/image.png' })
    expect(state.nodes[1]?.result).toMatchObject({ type: 'video', url: 'nomi-local://project/assets/video.mp4' })
    expect(state.nodes[2]?.prompt).toBe('雨夜街道\n霓虹反光')
    expect(state.nodes[2]?.contentJson?.content).toHaveLength(2)
    expect(state.selectedNodeIds).toEqual(result.nodeIds)
  })
})

// 2026-09-21 用户反馈：「拖放图片/视频上来，不会落在我鼠标最后消失的地方……有时候还会在视线外」。
// 根因：落点被钳到 x/y ≥ 40（旧画布不许负坐标的遗留），视口在负坐标区时卡片被推到屏外；
// 且落点是手算的、卡片左上角贴光标。现在：内核换算、不钳制、卡片中心压在光标下、不避让挪位。
describe('handleCanvasStageDrop — 落在松手的那一点', () => {
  function workspaceDrop(clientX: number, clientY: number): DragEvent<HTMLDivElement> {
    const payload = JSON.stringify({ projectId: 'p1', relativePath: 'a.png', name: 'a.png', kind: 'image' })
    return {
      clientX,
      clientY,
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: { getData: (type: string) => (type === WORKSPACE_FILE_DRAG_MIME ? payload : ''), files: [] },
    } as unknown as DragEvent<HTMLDivElement>
  }

  it('视口在负坐标区时，卡片中心仍在光标换算出的画布点上（不被钳回 40）', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    const cursorOnCanvas = { x: -900, y: -350 }
    handleCanvasStageDrop(workspaceDrop(640, 480), {
      readOnly: false,
      toCanvasPoint: () => cursorOnCanvas,
      activeCategoryId: 'shots',
    })
    const [dropped] = useGenerationCanvasStore.getState().nodes
    const size = getGenerationNodeDefaultSize('asset')
    expect(dropped?.position.x + size.width / 2).toBeCloseTo(cursorOnCanvas.x, 0)
    expect(dropped?.position.y + size.height / 2).toBeCloseTo(cursorOnCanvas.y, 0)
  })

  it('落在已有卡上也不被避让推走（用户指定的点优先）', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    const ctx = { readOnly: false, toCanvasPoint: () => ({ x: 400, y: 300 }), activeCategoryId: 'shots' }
    handleCanvasStageDrop(workspaceDrop(0, 0), ctx)
    handleCanvasStageDrop(workspaceDrop(0, 0), ctx)
    const [first, second] = useGenerationCanvasStore.getState().nodes
    expect(second?.position).toEqual(first?.position)
  })
})
