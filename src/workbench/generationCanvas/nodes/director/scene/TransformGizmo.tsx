/**
 * [INPUT]: 依赖 react、three、@react-three/drei 的 TransformControls、../DirectorEditorContext、./SceneRegistryContext、./ViewportApiContext、./sceneRefs 的 tagEditorOnly、
 *          ../model/vec3 的 RAD_TO_DEG / wrapDeg
 * [OUTPUT]: 对外提供 TransformGizmo：给选中的对象/机位/灯挂 gizmo；拖拽期间禁用 Orbit；每帧经 store 的 write*SpatialTransform
 *           写回（编辑层三态），拖拽开始记一次撤销快照；网格吸附来自图层配置
 * [POS]: director/scene 的变换写回接缝（清单 §2 V3）：gizmo 改的是 three 对象的局部变换，对象数据也是父级相对，
 *        所以直接读 position/rotation/scale 回写；机位读 YXZ 欧拉得 yaw/pitch/roll；灯只允许平移。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import { useDirectorStore, useDirectorStoreApi } from '../DirectorEditorContext'
import { DEG_TO_RAD, RAD_TO_DEG, wrapDeg } from '../model/vec3'
import { useSceneRegistry } from './SceneRegistryContext'
import { tagEditorOnly } from './sceneRefs'
import { useViewportApi } from './ViewportApiContext'

type Target = { id: string; kind: 'object' | 'camera' | 'light' }

export function TransformGizmo(): JSX.Element | null {
  const store = useDirectorStoreApi()
  const registry = useSceneRegistry()
  const apiRef = useViewportApi()
  const selection = useDirectorStore((state) => state.selection)
  const transformMode = useDirectorStore((state) => state.transformMode)
  const gridSnap = useDirectorStore((state) => state.activeScene().sceneConfig.gridSnapEnabled)
  const objectsVersion = useDirectorStore((state) => state.activeScene().objects.length + state.activeScene().cameras.length + state.activeScene().lights.length)
  const [attached, setAttached] = React.useState<THREE.Object3D | null>(null)
  const draggingRef = React.useRef(false)

  const target = React.useMemo<Target | null>(
    () =>
      selection.objectId
        ? { id: selection.objectId, kind: 'object' }
        : selection.cameraId
          ? { id: selection.cameraId, kind: 'camera' }
          : selection.lightId
            ? { id: selection.lightId, kind: 'light' }
            : null,
    [selection.cameraId, selection.lightId, selection.objectId],
  )

  // 选中变化后等实体挂载完再取 Object3D（登记发生在 layout effect，晚于本组件的渲染）
  React.useEffect(() => {
    // 选中了 IK 把手 / 骨骼时实体 gizmo 让位（把手的平移 gizmo、骨骼的旋转 gizmo 都在 SkeletonHandles）
    if (!target || !transformMode || selection.ikTarget || selection.boneKey) {
      setAttached(null)
      return undefined
    }
    let cancelled = false
    const tryAttach = () => {
      const object = registry.get(target.id)
      if (cancelled) return
      if (object) setAttached(object)
      else requestAnimationFrame(tryAttach)
    }
    tryAttach()
    return () => {
      cancelled = true
    }
  }, [registry, selection.ikTarget, target, transformMode, objectsVersion, selection.boneKey])

  const writeBack = React.useCallback(() => {
    if (!attached || !target) return
    const state = store.getState()
    if (target.kind === 'object') {
      state.writeObjectSpatialTransform(target.id, {
        position: { x: attached.position.x, y: attached.position.y, z: attached.position.z },
        rotation: { x: attached.rotation.x * RAD_TO_DEG, y: attached.rotation.y * RAD_TO_DEG, z: attached.rotation.z * RAD_TO_DEG },
        scale: { x: attached.scale.x, y: attached.scale.y, z: attached.scale.z },
      })
    } else if (target.kind === 'camera') {
      const euler = new THREE.Euler().setFromQuaternion(attached.quaternion, 'YXZ')
      state.writeCameraSpatialTransform(target.id, {
        position: { x: attached.position.x, y: attached.position.y, z: attached.position.z },
        rotation: { x: euler.x * RAD_TO_DEG, y: wrapDeg(euler.y * RAD_TO_DEG), z: euler.z * RAD_TO_DEG },
      })
    } else {
      state.writeLightSpatialTransform(target.id, { x: attached.position.x, y: attached.position.y, z: attached.position.z })
    }
  }, [attached, store, target])

  // 只读层：写回被拒时把对象拉回数据位姿，避免视觉与数据分叉
  const restoreFromData = React.useCallback(() => {
    if (!attached || !target) return
    const state = store.getState()
    if (target.kind === 'object') {
      const object = state.findObject(target.id)
      const pose = state.getEvaluatedPose(target.id)
      if (!object) return
      const position = pose?.position ?? object.position
      const rotation = pose?.rotation ?? object.rotation
      attached.position.set(position.x, position.y, position.z)
      attached.rotation.set(rotation.x * DEG_TO_RAD, rotation.y * DEG_TO_RAD, rotation.z * DEG_TO_RAD)
    }
  }, [attached, store, target])

  if (!attached || !target || !transformMode) return null
  // 灯只能平移；机位的 scale 模式降级为 translate
  const mode = target.kind === 'light' && transformMode !== 'translate' ? 'translate' : target.kind === 'camera' && transformMode === 'scale' ? 'translate' : transformMode

  return (
    <TransformControls
      // 把手是编辑辅助物：打 editor-only 旗标，截图 / 出片 / 画中画一律不画（2026-09-03 真机走查：选中机位时截图烧进了平移把手）
      ref={(instance) => {
        if (instance) tagEditorOnly(instance as unknown as THREE.Object3D)
      }}
      object={attached}
      mode={mode}
      translationSnap={gridSnap ? 0.5 : null}
      rotationSnap={gridSnap ? 15 * DEG_TO_RAD : null}
      scaleSnap={gridSnap ? 0.1 : null}
      size={0.9}
      onMouseDown={() => {
        draggingRef.current = true
        apiRef.current?.setOrbitEnabled(false)
        store.getState().saveState()
        store.getState().setTimelineDragging(true)
      }}
      onMouseUp={() => {
        draggingRef.current = false
        apiRef.current?.setOrbitEnabled(true)
        store.getState().setTimelineDragging(false)
        writeBack()
        restoreFromData()
      }}
      onObjectChange={() => {
        if (draggingRef.current) writeBack()
      }}
    />
  )
}
