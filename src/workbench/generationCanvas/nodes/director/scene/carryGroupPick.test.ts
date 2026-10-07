/**
 * 遗留 ①（3c 定行为）：点人选人、携带分组只在大纲里选。人和手里的东西挂在携带分组 `carry:actor:<名>` 下，
 * 视口点选取命中网格往上**最近**的实体标记——人的拾取胶囊在人的节点里，所以命中的是人，不是分组；分组没有网格，点不到。
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { findEntityFromObject, tagEntityObject } from './sceneRefs'

describe('携带分组的点选', () => {
  it('点中人的拾取体 → 选人；点中手里的信 → 选信；分组自身没有可点的网格', () => {
    const group = new THREE.Group()
    tagEntityObject(group, 'carry:actor:girl', 'object')
    const girl = new THREE.Group()
    tagEntityObject(girl, 'actor:girl', 'object')
    const pickProxy = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 1.18), new THREE.MeshBasicMaterial())
    girl.add(pickProxy)
    const letter = new THREE.Group()
    tagEntityObject(letter, 'actor:letter', 'object')
    const letterMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.02), new THREE.MeshBasicMaterial())
    letter.add(letterMesh)
    group.add(girl, letter)
    expect(findEntityFromObject(pickProxy)).toEqual({ id: 'actor:girl', kind: 'object' })
    expect(findEntityFromObject(letterMesh)).toEqual({ id: 'actor:letter', kind: 'object' })
    const groupMeshes: THREE.Object3D[] = []
    group.traverse((node) => { if ((node as THREE.Mesh).isMesh && findEntityFromObject(node)?.id === 'carry:actor:girl') groupMeshes.push(node) })
    expect(groupMeshes).toEqual([])
  })
})
