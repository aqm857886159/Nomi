import { describe, it, expect } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import { canvasNodeToAssetRefs, workspaceNodeToAssetRef, flattenWorkspaceFiles, filterAssets, moveArrayItem } from './assetTypes'
import type { AssetRef } from './assetTypes'

const canvasNode = (overrides: Partial<GenerationCanvasNode>): GenerationCanvasNode =>
  ({ id: 'n1', title: '', ...overrides } as GenerationCanvasNode)

const wsNode = (overrides: Partial<WorkspaceFileNode>): WorkspaceFileNode =>
  ({ id: '', name: '', relativePath: '', kind: 'file', ...overrides } as WorkspaceFileNode)

describe('canvasNodeToAssetRefs', () => {
  it('maps every unique image result, carrying node and result identity', () => {
    const refs = canvasNodeToAssetRefs(
      canvasNode({ id: 'n1', title: '日落', result: { id: 'r1', type: 'image', url: 'nomi-local://asset/p/a.png' } as never }),
    )
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      id: 'n1:r1',
      kind: 'image',
      name: '日落',
      renderUrl: 'nomi-local://asset/p/a.png',
      ownerNodeId: 'n1',
      ownerResultId: 'r1',
      source: 'canvas',
      origin: { source: 'canvas', nodeId: 'n1', resultId: 'r1' },
    })
  })

  it('skips text results and nodes without a url', () => {
    expect(canvasNodeToAssetRefs(canvasNode({ result: { id: 'r', type: 'text', text: 'hi' } as never }))).toEqual([])
    expect(canvasNodeToAssetRefs(canvasNode({ result: { id: 'r', type: 'image' } as never }))).toEqual([])
    expect(canvasNodeToAssetRefs(canvasNode({}))).toEqual([])
  })

  it('falls back to thumbnailUrl when url is absent and defaults name to kind', () => {
    const ref = canvasNodeToAssetRefs(canvasNode({ result: { id: 'r', type: 'video', thumbnailUrl: 'nomi-local://t.jpg' } as never }))[0]
    expect(ref?.renderUrl).toBe('nomi-local://t.jpg')
    expect(ref?.name).toBe('video')
  })

  it('includes non-primary history results once', () => {
    const first = { id: 'r1', type: 'image', url: 'a.png', createdAt: 1 } as never
    const second = { id: 'r2', type: 'image', url: 'b.png', createdAt: 2 } as never
    const refs = canvasNodeToAssetRefs(canvasNode({ result: first, history: [first, second] }))
    expect(refs.map((ref) => ref.ownerResultId)).toEqual(['r1', 'r2'])
  })

  it.each(['audio', 'model3d'] as const)('maps canvas %s results into the shared asset pool', (kind) => {
    const ref = canvasNodeToAssetRefs(canvasNode({
      id: `node-${kind}`,
      title: kind,
      result: { id: `result-${kind}`, type: kind, url: `nomi-local://asset/p/result.${kind === 'audio' ? 'mp3' : 'glb'}` } as never,
    }))[0]

    expect(ref).toMatchObject({ kind, source: 'canvas', ownerNodeId: `node-${kind}` })
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

  it('recognizes a GLB workspace file from its MIME contract', () => {
    const ref = workspaceNodeToAssetRef(wsNode({
      name: 'mesh.glb',
      relativePath: 'assets/generated/mesh.glb',
      kind: 'file',
      contentType: 'model/gltf-binary',
    }), 'p')

    expect(ref).toMatchObject({ kind: 'model3d', name: 'mesh.glb', source: 'project' })
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
