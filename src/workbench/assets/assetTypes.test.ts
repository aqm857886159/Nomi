import { describe, it, expect } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvasV2/model/generationCanvasTypes'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import { canvasNodeToAssetRef, workspaceNodeToAssetRef, flattenWorkspaceFiles, filterAssets, moveArrayItem } from './assetTypes'
import type { AssetRef } from './assetTypes'

const canvasNode = (overrides: Partial<GenerationCanvasNode>): GenerationCanvasNode =>
  ({ id: 'n1', title: '', ...overrides } as GenerationCanvasNode)

const wsNode = (overrides: Partial<WorkspaceFileNode>): WorkspaceFileNode =>
  ({ id: '', name: '', relativePath: '', kind: 'file', ...overrides } as WorkspaceFileNode)

describe('canvasNodeToAssetRef', () => {
  it('maps an image result node, carrying canvas origin', () => {
    const ref = canvasNodeToAssetRef(
      canvasNode({ id: 'n1', title: '日落', result: { id: 'r1', type: 'image', url: 'nomi-local://asset/p/a.png' } as never }),
    )
    expect(ref).toMatchObject({
      id: 'n1',
      kind: 'image',
      name: '日落',
      renderUrl: 'nomi-local://asset/p/a.png',
      source: 'canvas',
      origin: { source: 'canvas', nodeId: 'n1' },
    })
  })

  it('skips text results and nodes without a url', () => {
    expect(canvasNodeToAssetRef(canvasNode({ result: { id: 'r', type: 'text', text: 'hi' } as never }))).toBeNull()
    expect(canvasNodeToAssetRef(canvasNode({ result: { id: 'r', type: 'image' } as never }))).toBeNull()
    expect(canvasNodeToAssetRef(canvasNode({}))).toBeNull()
  })

  it('falls back to thumbnailUrl when url is absent and defaults name to kind', () => {
    const ref = canvasNodeToAssetRef(canvasNode({ result: { id: 'r', type: 'video', thumbnailUrl: 'nomi-local://t.jpg' } as never }))
    expect(ref?.renderUrl).toBe('nomi-local://t.jpg')
    expect(ref?.name).toBe('video')
  })
})

describe('workspaceNodeToAssetRef', () => {
  it('derives a nomi-local url and keeps project origin', () => {
    const ref = workspaceNodeToAssetRef(wsNode({ name: 'a.png', relativePath: 'refs/a.png', kind: 'image' }), 'proj1')
    expect(ref?.kind).toBe('image')
    expect(ref?.renderUrl.startsWith('nomi-local://asset/')).toBe(true)
    expect(ref?.origin).toEqual({ source: 'project', projectId: 'proj1', relativePath: 'refs/a.png' })
  })

  it('skips non-asset kinds (directory / document / text)', () => {
    expect(workspaceNodeToAssetRef(wsNode({ kind: 'directory' }), 'p')).toBeNull()
    expect(workspaceNodeToAssetRef(wsNode({ kind: 'document' }), 'p')).toBeNull()
    expect(workspaceNodeToAssetRef(wsNode({ kind: 'text' }), 'p')).toBeNull()
  })

  it('keeps audio and video', () => {
    expect(workspaceNodeToAssetRef(wsNode({ relativePath: 'a.mp3', kind: 'audio' }), 'p')?.kind).toBe('audio')
    expect(workspaceNodeToAssetRef(wsNode({ relativePath: 'a.mp4', kind: 'video' }), 'p')?.kind).toBe('video')
  })
})

describe('filterAssets', () => {
  const ref = (over: Partial<AssetRef>): AssetRef =>
    ({ id: '', kind: 'image', name: '', renderUrl: '', source: 'project', origin: { source: 'project', projectId: 'p', relativePath: '' }, ...over } as AssetRef)
  const pool = [
    ref({ id: '1', name: '日落.png', kind: 'image' }),
    ref({ id: '2', name: 'clip.mp4', kind: 'video' }),
    ref({ id: '3', name: 'bgm.mp3', kind: 'audio' }),
  ]

  it('keeps everything when no opts', () => {
    expect(filterAssets(pool).map((a) => a.id)).toEqual(['1', '2', '3'])
  })

  it('filters by accept kinds', () => {
    expect(filterAssets(pool, { accept: ['image'] }).map((a) => a.id)).toEqual(['1'])
    expect(filterAssets(pool, { accept: ['image', 'video'] }).map((a) => a.id)).toEqual(['1', '2'])
  })

  it('filters by case-insensitive name query', () => {
    expect(filterAssets(pool, { query: 'CLIP' }).map((a) => a.id)).toEqual(['2'])
    expect(filterAssets(pool, { query: '日落' }).map((a) => a.id)).toEqual(['1'])
  })

  it('combines accept + query', () => {
    expect(filterAssets(pool, { accept: ['audio'], query: 'mp' }).map((a) => a.id)).toEqual(['3'])
  })
})

describe('moveArrayItem (tile 重排)', () => {
  it('把一项从 from 移到 to', () => {
    expect(moveArrayItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveArrayItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveArrayItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })
  it('同位/越界 → 内容不变', () => {
    expect(moveArrayItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveArrayItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })
  it('不改原数组', () => {
    const arr = ['a', 'b', 'c']
    moveArrayItem(arr, 0, 2)
    expect(arr).toEqual(['a', 'b', 'c'])
  })
})

describe('flattenWorkspaceFiles', () => {
  it('flattens nested directories depth-first', () => {
    const tree: WorkspaceFileNode[] = [
      wsNode({ relativePath: 'a.png', kind: 'image' }),
      wsNode({
        relativePath: 'sub',
        kind: 'directory',
        children: [wsNode({ relativePath: 'sub/b.png', kind: 'image' })],
      }),
    ]
    const flat = flattenWorkspaceFiles(tree)
    expect(flat.map((n) => n.relativePath)).toEqual(['a.png', 'sub', 'sub/b.png'])
  })
})
