import { describe, expect, it } from 'vitest'
import { normalizeStoreSnapshot } from './canvasSnapshotNormalizer'

// 切换门（2026-09-03）：磁盘里的老 scene3d 节点在加载时迁成 director 节点，工程落到 meta.directorProject，AI 出图标志原样保留
describe('normalizeStoreSnapshot — 老 scene3d 节点迁成 director', () => {
  it('kind 换成 director、scene3dState 变 directorProject、自动出图标志保留、其它字段不动', () => {
    const snap = normalizeStoreSnapshot({
      nodes: [{
        id: 'legacy-1',
        kind: 'scene3d',
        title: '站位参考',
        position: { x: 10, y: 20 },
        status: 'idle',
        meta: {
          scene3dState: {
            objects: [{ id: 'm', name: '主角', type: 'mannequin', visible: true, position: [0, 1.25, 0], rotation: [0, 0, 0], scale: [2.5, 2.5, 2.5] }],
            cameras: [{ id: 'c', name: '机位', visible: true, position: [0, 1.5, 5], rotation: [0, 0, 0], target: [0, 1.3, 0], fov: 40, aspectRatio: '16:9', lensDepth: 0 }],
          },
          stagingAutoCapture: { targetNodeId: 'shot-1' },
        },
      }],
    })
    expect(snap.nodes).toHaveLength(1)
    const node = snap.nodes[0]
    expect(node.kind).toBe('director')
    expect(node.title).toBe('站位参考')
    expect(node.position).toEqual({ x: 10, y: 20 })
    expect(node.meta?.scene3dState).toBeUndefined()
    const project = node.meta?.directorProject as { scenes: Array<{ objects: unknown[]; cameras: unknown[] }> }
    expect(project.scenes[0].objects).toHaveLength(1)
    expect(project.scenes[0].cameras).toHaveLength(1)
    expect(node.meta?.stagingAutoCapture).toEqual({ targetNodeId: 'shot-1' })
  })

  it('没有 scene3dState 的空老节点也能迁成空工程的 director 节点', () => {
    const snap = normalizeStoreSnapshot({ nodes: [{ id: 'legacy-2', kind: 'scene3d', title: '3D', position: { x: 0, y: 0 } }] })
    expect(snap.nodes[0].kind).toBe('director')
    const project = snap.nodes[0].meta?.directorProject as { scenes: Array<{ objects: unknown[] }> }
    expect(project.scenes[0].objects).toHaveLength(0)
  })
})
