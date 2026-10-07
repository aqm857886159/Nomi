import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { boundsSource, measureObjectBounds, scaledBounds } from './directorSpace'
import { normalizeDirectorProject } from './directorProject'
import { sightBlockers } from './compiler/stageSightline'
import type { DirectorObject } from './directorTypes'

const v = (x: number, y: number, z: number) => ({ x, y, z })

describe('GLB 包围盒：加载后实量是唯一真值，没量过按 1 米方盒兜底并标出来', () => {
  it('实量按模型自己的坐标系：网格偏移、根节点变换都算进去，挂在哪个父级下都一样', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1))
    mesh.position.set(0, 2, 0) // 底在 0、高 4
    root.add(mesh)
    root.scale.set(0.5, 0.5, 0.5) // 文件里根节点缩了一半
    const loose = measureObjectBounds(root)!
    const parent = new THREE.Group()
    parent.position.set(10, 3, -7)
    parent.rotation.y = 1.2
    parent.add(root)
    const mounted = measureObjectBounds(root)!
    for (const bounds of [loose, mounted]) {
      expect(bounds.min.y).toBeCloseTo(0)
      expect(bounds.max.y).toBeCloseTo(2)
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(1)
    }
  })

  it('有实量就用实量（再乘对象 scale），没有就是 1 米方盒、来源 nominal', () => {
    const measured = { type: 'model' as const, scale: v(2, 2, 2), measuredBounds: { min: v(-0.5, 0, -0.25), max: v(0.5, 1.8, 0.25) } }
    expect(boundsSource(measured)).toBe('measured')
    expect(scaledBounds(measured).size).toEqual(v(2, 3.6, 1))
    const unmeasured = { type: 'model' as const, scale: v(1, 1, 1) }
    expect(boundsSource(unmeasured)).toBe('nominal')
    expect(scaledBounds(unmeasured).size).toEqual(v(1, 1, 1))
    expect(boundsSource({ type: 'cube', scale: v(1, 1, 1) })).toBe('render')
  })

  it('工程规整保留实量，坏数据当没量过', () => {
    const project = normalizeDirectorProject({ scenes: [{ id: 's', objects: [
      { id: 'good', type: 'model', measuredBounds: { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } } },
      { id: 'bad', type: 'model', measuredBounds: { min: { x: 'a' }, max: { x: 1, y: 2, z: 1 } } },
    ] }] })
    const objects = project.scenes[0].objects
    expect(objects.find((o) => o.id === 'good')?.measuredBounds).toEqual({ min: v(-1, 0, -1), max: v(1, 2, 1) })
    expect(objects.find((o) => o.id === 'bad')?.measuredBounds).toBeUndefined()
  })

  it('视线按实量判断：量出来 3 米高的模型挡住后面的人，没量过（1 米兜底）就挡不住', () => {
    const person: DirectorObject = { id: 'hero', name: 'hero', type: 'character', position: v(0, 0, 0), rotation: v(0, 0, 0), scale: v(1, 1, 1), visible: true, locked: false }
    const statue = (measuredBounds?: DirectorObject['measuredBounds']): DirectorObject => ({ id: 'statue', name: 'statue', type: 'model', position: v(0, 0, 2), rotation: v(0, 0, 0), scale: v(1, 1, 1), visible: true, locked: true, measuredBounds })
    const camera = { position: v(0, 1.6, 5), yaw: 180, pitch: 0, roll: 0, fov: 45 }
    const context = (objects: DirectorObject[]) => ({ objects, subjectId: 'hero', aim: () => v(0, 1.5, 0), window: [0, 1] as const, ignore: new Set<string>() })
    expect(sightBlockers(context([person, statue({ min: v(-0.6, 0, -0.6), max: v(0.6, 3, 0.6) })]), camera)).toEqual(['statue'])
    expect(sightBlockers(context([person, statue()]), camera)).toEqual([])
  })
})
