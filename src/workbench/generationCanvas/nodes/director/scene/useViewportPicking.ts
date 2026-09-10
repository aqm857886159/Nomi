/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useThree、../DirectorEditorContext 的 useDirectorStoreApi、./SceneRegistryContext、
 *          ./sceneRefs 的 findEntityFromObject / isEditorOnly / isWorldVisible（继承真实父链可见性）
 * [OUTPUT]: 对外提供 useViewportPicking：左键点击（位移 ≤5px）射线拾取——第一遍按类不按距离：路标 → IK 把手 → 骨骼球，
 *           再按距离拾对象/机位/灯；锁定或隐藏（含父级）不可拾取，点空白清选
 * [POS]: director/scene 的选择入口（清单 §2 V2 点选）：只在「无创建模式、Orbit 可用」时接管指针；模式类交互（放置/画框/画线）
 *        由 creation hooks 抢先处理并 stopPropagation。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useDirectorStoreApi } from '../DirectorEditorContext'
import type { DirectorObject } from '../model/directorTypes'
import { DIRECTOR_BONE_KEY, DIRECTOR_IK_HANDLE_KEY, DIRECTOR_PICK_LAYER, DIRECTOR_WAYPOINT_KEY, findEntityFromObject, isEditorOnly, isWorldVisible, type BoneTag, type IkHandleTag, type WaypointTag } from './sceneRefs'
import { useSceneRegistry } from './SceneRegistryContext'

const CLICK_SLOP_PX = 5

function objectOrParentUnavailable(objects: DirectorObject[], id: string): boolean {
  let current = objects.find((object) => object.id === id)
  if (!current) return true
  const seen = new Set<string>()
  while (current) {
    if (current.locked || !current.visible) return true
    if (!current.parentId || seen.has(current.parentId)) return false
    seen.add(current.parentId)
    current = objects.find((object) => object.id === current?.parentId)
  }
  return false
}

function isPickMesh(object: THREE.Object3D): boolean {
  if (!(object as THREE.Mesh).isMesh || (object as THREE.SkinnedMesh).isSkinnedMesh) return false
  return isWorldVisible(object)
}

export function useViewportPicking({ enabledRef, onPovRejected }: { enabledRef: React.MutableRefObject<boolean>; onPovRejected: (reasonKey: string) => void }): void {
  const onPovRejectedRef = React.useRef(onPovRejected)
  onPovRejectedRef.current = onPovRejected
  const { camera, gl, scene } = useThree()
  const store = useDirectorStoreApi()
  const registry = useSceneRegistry()
  const raycaster = React.useMemo(() => {
    const instance = new THREE.Raycaster()
    instance.layers.enable(DIRECTOR_PICK_LAYER)
    return instance
  }, [])

  React.useEffect(() => {
    const element = gl.domElement
    let downX = 0
    let downY = 0
    let downButton = -1
    // 「点选」= 自己接到的 down + up 一对：down 时若被创建模式占用（放置角色 / 画方块的确认点击），
    // 这一对整体让出——否则创建模式在 down 里结束、up 时这里又当成空点击把刚建好的选中态清掉
    let downOwned = false

    const onPointerDown = (event: PointerEvent) => {
      downX = event.clientX
      downY = event.clientY
      downButton = event.button
      downOwned = enabledRef.current
    }

    const onPointerUp = (event: PointerEvent) => {
      const owned = downOwned
      downOwned = false
      if (!owned || downButton !== 0 || event.button !== 0 || !enabledRef.current) return
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_SLOP_PX) return
      const rect = element.getBoundingClientRect()
      const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const candidates: THREE.Object3D[] = []
      // 蒙皮网格不进候选：角色由拾取图层上的胶囊代理命中（见 CharacterEntity PickProxy），省掉 5 万三角面的逐面测试
      scene.traverse((object) => {
        if (isPickMesh(object) && !isEditorOnlyChain(object)) candidates.push(object)
      })
      // 机位模型是 editor-only，但要能被点选：单独加入
      for (const [, root] of registry.entries()) {
        root.traverse((object) => {
          if (isPickMesh(object) && !candidates.includes(object)) candidates.push(object)
        })
      }
      // 路标小球 / IK 把手同理（editor-only 但可点）
      scene.traverse((object) => {
        if (isPickMesh(object) && !candidates.includes(object) && (object.userData[DIRECTOR_WAYPOINT_KEY] || object.userData[DIRECTOR_IK_HANDLE_KEY] || object.userData[DIRECTOR_BONE_KEY])) candidates.push(object)
      })
      const hits = raycaster.intersectObjects(candidates, false)
      const state = store.getState()
      const sceneData = state.activeScene()
      // 第一遍：路标 → IK 把手 → 骨骼球，按「类」不按距离——它们又小又常被实体网格贴着，
      // 按距离排会输给身后的模型；把手挨着骨骼球时（抬手后肘向贴着大臂球）也必须是把手赢，否则点把手会切成 FK。
      // 机位视角里当前机位的机身就在眼前 0 距离处，更是必须让路
      const specialHit = (key: string) => hits.find((hit) => {
        const tag = hit.object.userData[key] as { entityId: string } | undefined
        return tag && sceneData.visible && (Boolean(state.findCamera(tag.entityId)) || !objectOrParentUnavailable(sceneData.objects, tag.entityId))
      })
      const handleHit = specialHit(DIRECTOR_IK_HANDLE_KEY)
      const boneHit = specialHit(DIRECTOR_BONE_KEY)
      const waypointHit = specialHit(DIRECTOR_WAYPOINT_KEY)
      for (const hit of [waypointHit, handleHit, boneHit]) {
        if (!hit) continue
        const handleTag = hit.object.userData[DIRECTOR_IK_HANDLE_KEY] as IkHandleTag | undefined
        if (handleTag) {
          state.setIkModeEnabled(true)
          state.select({ objectId: handleTag.entityId, cameraId: null, lightId: null, multiObjectIds: [handleTag.entityId], ikTarget: handleTag.key, boneKey: null })
          return
        }
        // 3D 骨骼球：点中即选该骨、切到 FK
        const boneTag = hit.object.userData[DIRECTOR_BONE_KEY] as BoneTag | undefined
        if (boneTag) {
          state.setIkModeEnabled(false)
          state.select({ objectId: boneTag.entityId, cameraId: null, lightId: null, multiObjectIds: [boneTag.entityId], boneKey: boneTag.bone, ikTarget: null })
          return
        }
        const waypointTag = hit.object.userData[DIRECTOR_WAYPOINT_KEY] as WaypointTag | undefined
        if (waypointTag) {
          const isCamera = Boolean(state.findCamera(waypointTag.entityId))
          const selectedWaypointIds = event.shiftKey ? Array.from(new Set([...state.selection.selectedWaypointIds, waypointTag.waypointId])) : [waypointTag.waypointId]
          state.select({
            ...(isCamera ? { cameraId: waypointTag.entityId, objectId: null, multiObjectIds: [] } : { objectId: waypointTag.entityId, cameraId: null, multiObjectIds: [waypointTag.entityId] }),
            lightId: null,
            activeWaypointId: waypointTag.waypointId,
            selectedWaypointIds,
            clipId: waypointTag.clipId ?? null,
            clipType: waypointTag.clipId ? 'trajectory' : null,
            boneKey: null,
            ikTarget: null,
          })
          state.setTimelineContext({ currentTime: waypointTag.time, isPlaying: false })
          return
        }
      }
      for (const hit of hits) {
        const entity = findEntityFromObject(hit.object)
        if (!entity) continue
        if (entity.kind === 'camera' && entity.id === state.activeCameraId) continue
        if (entity.kind === 'object') {
          const object = sceneData.objects.find((item) => item.id === entity.id)
          if (!object || objectOrParentUnavailable(sceneData.objects, entity.id)) continue
          state.select({ objectId: entity.id, multiObjectIds: [entity.id], cameraId: null, lightId: null, activeWaypointId: null, selectedWaypointIds: [], boneKey: null, ikTarget: null })
          return
        }
        if (entity.kind === 'camera') {
          state.select({ cameraId: entity.id, objectId: null, lightId: null, multiObjectIds: [], activeWaypointId: null, selectedWaypointIds: [], boneKey: null, ikTarget: null })
          return
        }
        if (entity.kind === 'light') {
          const light = sceneData.lights.find((item) => item.id === entity.id)
          if (!light || light.locked || !light.visible) continue
          state.select({ lightId: entity.id, objectId: null, cameraId: null, multiObjectIds: [], activeWaypointId: null, selectedWaypointIds: [], boneKey: null, ikTarget: null })
          return
        }
      }
      state.select({ objectId: null, cameraId: null, lightId: null, multiObjectIds: [], activeWaypointId: null, selectedWaypointIds: [], boneKey: null, ikTarget: null })
    }

    // 双击机位模型 = 进入该机位视角（Nomi 化补充，清单 §6 C1）
    const onDoubleClick = (event: MouseEvent) => {
      if (!enabledRef.current) return
      const rect = element.getBoundingClientRect()
      const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const candidates: THREE.Object3D[] = []
      for (const [, root] of registry.entries()) {
        root.traverse((object) => {
          if (isPickMesh(object)) candidates.push(object)
        })
      }
      for (const hit of raycaster.intersectObjects(candidates, false)) {
        const entity = findEntityFromObject(hit.object)
        if (!entity) continue
        if (entity.kind !== 'camera') return
        const check = store.getState().enterCameraPOV(entity.id)
        if (!check.allowed && check.reasonKey) onPovRejectedRef.current(check.reasonKey)
        return
      }
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('dblclick', onDoubleClick)
    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('dblclick', onDoubleClick)
    }
  }, [camera, enabledRef, gl.domElement, raycaster, registry, scene, store])
}

function isEditorOnlyChain(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (isEditorOnly(current)) return true
    current = current.parent
  }
  return false
}
