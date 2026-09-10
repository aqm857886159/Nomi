/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useThree、./sceneRefs 的 DIRECTOR_ENTITY_ID_KEY
 * [OUTPUT]: 对外提供 E2EBridge（仅当 localStorage['__nomiE2E']==='1' 时把 window.__nomiDirectorE2E 挂上：按对象名 / 世界坐标投影成画布客户区像素、按名字前缀列对象、读对象世界朝向）
 * [POS]: director/scene 的 E2E 取证桥（同 design/confirmDialog 的 __nomiConfirmDialogE2E 写法）：R13/R16 走查要在真实渲染管线里精确点到 IK 把手、路标、
 *        gizmo 这类 three 内物体，DOM 里没有它们的坐标，只能从 three 相机投影出来。生产从不置该标志 → 永不暴露，非并行实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { poseClipInfo, poseClipStatus } from './character/poseClipLibrary'
import { DIRECTOR_ENTITY_ID_KEY, isEditorOnly } from './sceneRefs'

export type DirectorE2EProjection = {
  // 画布客户区像素（相对 viewport，非页面）
  x: number
  y: number
  world: [number, number, number]
  // 从场景根到该对象的名字链，排查「同名对象找错」用
  path: string
}

// entityId：限定在某个实体的子树里找（骨名在多个角色间同名，不限定会取到第一个角色）
export type DirectorE2EBridge = {
  projectByName: (name: string, entityId?: string) => DirectorE2EProjection | null
  projectPoint: (x: number, y: number, z: number) => { x: number; y: number }
  // 名字前缀匹配的全部对象（名字链 + 本地位置），排查重名 / 没被驱动
  findAll: (prefix: string, entityId?: string) => Array<{ path: string; position: [number, number, number]; scale: [number, number, number] }>
  // 带 editor-only 旗标（出片 / 画中画不画）的对象路径，验证 gizmo / 把手 / 网格这类编辑辅助物确实被标了
  editorOnlyPaths: () => string[]
  // 姿态库某条目的加载状态（ready / loading / missing），走查用来等 FBX 落地再量骨骼
  poseClipStatus: (actionId: string) => ReturnType<typeof poseClipStatus>
  poseClipInfo: (actionId: string) => { duration: number; isStatic: boolean; restHips: number[] | null; frame0Hips: number[] | null } | null
  // 对象的世界位置 + 本地 +Z 在世界里的朝向（Mixamo 头骨的脸朝向），验证视线 / 看向
  orientationByName: (name: string, entityId?: string) => { position: [number, number, number]; forward: [number, number, number] } | null
  // 实体子树的世界包围盒（蒙皮后），验证身高 / 贴地
  boundsByEntity: (entityId: string) => { min: [number, number, number]; max: [number, number, number] } | null
  splatInfo: (entityId: string) => { identity: string; initialized: boolean; count: number; revealing: boolean } | null
  // 实体子树里所有 Bone 的世界 y 范围 + 最低 / 最高骨名，验证身高与贴地
  boneExtentByEntity: (entityId: string) => { minY: number; maxY: number; lowest: string; highest: string } | null
  // 按名字找到的第一个 Mesh 的材质 / 可见性摘要，验证全景球淡入、白模换材质这类「有没有画出来」
  inspectMeshByName: (name: string) => { visible: boolean; frustumCulled: boolean; material: string; opacity: number; transparent: boolean; hasMap: boolean; mapSize: [number, number] | null; side: number; renderOrder: number; scale: [number, number, number] } | null
  // 走查排障用：改一个 Mesh 的渲染开关（面向 / 剔除 / 缩放 / 渲染序），只在 E2E 标志下可用
  setMeshPropsByName: (name: string, patch: { side?: number; frustumCulled?: boolean; scale?: [number, number, number]; renderOrder?: number; visible?: boolean }) => boolean
}

const E2E_FLAG = '__nomiE2E'

function e2eEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem(E2E_FLAG) === '1'
  } catch {
    return false
  }
}

function namePath(object: THREE.Object3D): string {
  const names: string[] = []
  for (let node: THREE.Object3D | null = object; node; node = node.parent) names.unshift(node.name || node.type)
  return names.join('/')
}

export function E2EBridge(): null {
  const { scene, camera, gl } = useThree()
  React.useEffect(() => {
    if (!e2eEnabled()) return
    const ndc = new THREE.Vector3()
    const world = new THREE.Vector3()
    const projectPoint = (x: number, y: number, z: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      camera.updateMatrixWorld()
      ndc.set(x, y, z).project(camera)
      return { x: rect.left + ((ndc.x + 1) / 2) * rect.width, y: rect.top + ((1 - ndc.y) / 2) * rect.height }
    }
    const rootOf = (entityId?: string): THREE.Object3D | null => {
      if (!entityId) return scene
      let found: THREE.Object3D | null = null
      scene.traverse((object) => {
        if (!found && object.userData[DIRECTOR_ENTITY_ID_KEY] === entityId) found = object
      })
      return found
    }
    const bridge: DirectorE2EBridge = {
      projectPoint,
      projectByName: (name, entityId) => {
        const object = rootOf(entityId)?.getObjectByName(name)
        if (!object) return null
        object.updateWorldMatrix(true, false)
        object.getWorldPosition(world)
        return { ...projectPoint(world.x, world.y, world.z), world: [world.x, world.y, world.z], path: namePath(object) }
      },
      orientationByName: (name, entityId) => {
        const object = rootOf(entityId)?.getObjectByName(name)
        if (!object) return null
        object.updateWorldMatrix(true, false)
        object.getWorldPosition(world)
        const tip = object.localToWorld(new THREE.Vector3(0, 0, 1)).sub(world).normalize()
        return { position: [world.x, world.y, world.z], forward: [tip.x, tip.y, tip.z] }
      },
      boundsByEntity: (entityId) => {
        const root = rootOf(entityId)
        if (!root) return null
        root.updateWorldMatrix(true, true)
        const box = new THREE.Box3().setFromObject(root, true)
        return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }
      },
      splatInfo: (entityId) => {
        const object = rootOf(entityId)?.getObjectByName('directorSplat') as (THREE.Object3D & { isInitialized?: boolean; numSplats?: number; objectModifiers?: unknown[] }) | undefined
        return object ? { identity: object.uuid, initialized: object.isInitialized === true, count: object.numSplats ?? 0, revealing: Boolean(object.objectModifiers?.length) } : null
      },
      inspectMeshByName: (name) => {
        const object = scene.getObjectByName(name) as THREE.Mesh | undefined
        if (!object || !(object as THREE.Mesh).isMesh) return null
        const material = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.MeshBasicMaterial
        const image = material.map?.image as { width?: number; height?: number } | undefined
        return {
          visible: object.visible,
          frustumCulled: object.frustumCulled,
          material: material.type,
          opacity: material.opacity,
          transparent: material.transparent,
          hasMap: Boolean(material.map),
          mapSize: image && typeof image.width === 'number' && typeof image.height === 'number' ? [image.width, image.height] : null,
          side: material.side,
          renderOrder: object.renderOrder,
          scale: [object.scale.x, object.scale.y, object.scale.z],
        }
      },
      setMeshPropsByName: (name, patch) => {
        const object = scene.getObjectByName(name) as THREE.Mesh | undefined
        if (!object || !(object as THREE.Mesh).isMesh) return false
        const material = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.Material
        if (patch.side !== undefined) {
          material.side = patch.side as THREE.Side
          material.needsUpdate = true
        }
        if (patch.frustumCulled !== undefined) object.frustumCulled = patch.frustumCulled
        if (patch.scale) object.scale.set(...patch.scale)
        if (patch.renderOrder !== undefined) object.renderOrder = patch.renderOrder
        if (patch.visible !== undefined) object.visible = patch.visible
        return true
      },
      boneExtentByEntity: (entityId) => {
        const root = rootOf(entityId)
        if (!root) return null
        root.updateWorldMatrix(true, true)
        let result: { minY: number; maxY: number; lowest: string; highest: string } | null = null
        root.traverse((object) => {
          if (!(object as THREE.Bone).isBone) return
          object.getWorldPosition(world)
          if (!result) result = { minY: world.y, maxY: world.y, lowest: object.name, highest: object.name }
          else {
            if (world.y < result.minY) { result.minY = world.y; result.lowest = object.name }
            if (world.y > result.maxY) { result.maxY = world.y; result.highest = object.name }
          }
        })
        return result
      },
      poseClipStatus: (actionId) => poseClipStatus(actionId),
      poseClipInfo: (actionId) => poseClipInfo(actionId),
      editorOnlyPaths: () => {
        const out: string[] = []
        scene.traverse((object) => {
          if (isEditorOnly(object)) out.push(namePath(object))
        })
        return out
      },
      findAll: (prefix, entityId) => {
        const out: Array<{ path: string; position: [number, number, number]; scale: [number, number, number] }> = []
        rootOf(entityId)?.traverse((object) => {
          if (object.name.startsWith(prefix)) out.push({ path: namePath(object), position: [object.position.x, object.position.y, object.position.z], scale: [object.scale.x, object.scale.y, object.scale.z] })
        })
        return out
      },
    }
    const host = window as unknown as { __nomiDirectorE2E?: DirectorE2EBridge }
    host.__nomiDirectorE2E = bridge
    return () => {
      if (host.__nomiDirectorE2E === bridge) delete host.__nomiDirectorE2E
    }
  }, [camera, gl, scene])
  return null
}
