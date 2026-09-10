/**
 * [INPUT]: 依赖 react、three、@react-three/fiber（useFrame / useThree / createPortal）、@react-three/drei 的 TransformControls、
 *          ../../DirectorEditorContext、../ViewportApiContext 的 useViewportApi、../sceneRefs（isDirectorObjectVisible / tagEditorOnly / DIRECTOR_IK_HANDLE_KEY / IkHandleTag）、../sceneTheme 的 SKELETON_COLORS、
 *          ../../model/ikChains（IK_TARGETS / IK_POLES / IK_HANDLES / IkHandleKey）、../../model/rigs（SemanticBone / boneName）、
 *          ./characterRig（findSemanticBone / findBoneByName / poleRestPosition / offsetFromBase / BoneIndex）、./useCharacterRig 的 CharacterRigApi
 * [OUTPUT]: 对外提供 SkeletonHandles：IK 把手层（手 / 脚 / 头 = 球，骨盆 / 胸腔 = 水平圆环，肘向 / 膝向 = 八面体，琥珀色、选中红并放大，
 *           肘 / 膝 / 胸 / 极向量各带一条引导线）+ 选中把手挂平移 gizmo、选中骨骼挂旋转 gizmo（FK）
 * [POS]: director/scene/character 的骨骼交互层：显示 = 该角色被选中 && IK 模式 && （骨骼页聚焦 ｜ 没人聚焦且图层开了「显示骨骼」）；
 *        点把手 / 骨骼球只是选中（拾取在 useViewportPicking），拖动只经 gizmo——工具条没选工具（transformMode 空）时 gizmo 不挂；
 *        把手一律平移 gizmo、骨骼一律旋转 gizmo，与当前工具无关。拖骨盆 = 改 hipsOffset 且两脚钉在原地；拖极向量 = 整条肢体绕 根→末端 轴转；
 *        解算与写回都在 useCharacterRig 的每帧管线里（拖动中逐帧写 boneRotations）。FK：旋转 gizmo 直接挂在骨上，偏移 = base⁻¹·当前。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { IK_HANDLES, IK_POLES, IK_TARGETS, type IkHandleKey, type IkPoleKey } from '../../model/ikChains'
import { boneName, type SemanticBone } from '../../model/rigs'
import type { DirectorRig } from '../../model/directorTypes'
import { DIRECTOR_IK_HANDLE_KEY, isDirectorObjectVisible, tagEditorOnly, type IkHandleTag } from '../sceneRefs'

// drei 的 TransformControls 实例（three-stdlib，Object3D 派生）：只用到事件总线
type GizmoControls = { addEventListener: (type: string, listener: (event: { value?: boolean }) => void) => void; removeEventListener: (type: string, listener: (event: { value?: boolean }) => void) => void }
import { SKELETON_COLORS } from '../sceneTheme'
import { useViewportApi } from '../ViewportApiContext'
import { findBoneByName, findSemanticBone, offsetFromBase, poleRestPosition, type BoneIndex } from './characterRig'
import type { CharacterRigApi } from './useCharacterRig'

type HandleKind = 'hand' | 'foot' | 'head' | 'pole' | 'pelvis' | 'chest'
type HandleSpec = { key: IkHandleKey; bone: SemanticBone; kind: HandleKind; guideFrom: SemanticBone | null }

const HANDLE_SPECS: HandleSpec[] = [
  ...Object.values(IK_TARGETS).map((config) => ({
    key: config.key as IkHandleKey,
    bone: config.effector,
    kind: (config.key.endsWith('Hand') ? 'hand' : config.key.endsWith('Foot') ? 'foot' : 'head') as HandleKind,
    guideFrom: config.key === 'head' ? null : config.links[0],
  })),
  { key: 'chest', bone: IK_HANDLES.chest, kind: 'chest', guideFrom: 'hips' },
  { key: 'pelvis', bone: IK_HANDLES.pelvis, kind: 'pelvis', guideFrom: null },
  ...Object.values(IK_POLES).map((config) => ({ key: config.key as IkHandleKey, bone: config.mid, kind: 'pole' as HandleKind, guideFrom: config.mid })),
]

const _world = new THREE.Vector3()
const _local = new THREE.Vector3()
const _from = new THREE.Vector3()
const _defaultDir = new THREE.Vector3()
const _charQuat = new THREE.Quaternion()

function HandleGeometry({ kind }: { kind: HandleKind }): JSX.Element {
  if (kind === 'pelvis') return <torusGeometry args={[0.13, 0.016, 8, 24]} />
  if (kind === 'chest') return <torusGeometry args={[0.11, 0.015, 8, 24]} />
  if (kind === 'pole') return <octahedronGeometry args={[0.038, 0]} />
  if (kind === 'hand') return <sphereGeometry args={[0.045, 16, 16]} />
  return <sphereGeometry args={[0.05, 16, 16]} />
}

/** 一只把手 + 它的引导线：没在拖时每帧贴骨（极向量按肢体平面算静止位），拖动中由 gizmo 驱动 */
function HandleMesh({
  objectId,
  spec,
  bones,
  characterRoot,
  selected,
  dragging,
  register,
}: {
  objectId: string
  spec: HandleSpec
  bones: Map<SemanticBone, THREE.Bone>
  characterRoot: THREE.Object3D
  selected: boolean
  dragging: boolean
  /** 把手组挂上 / 卸下时登记给父级（gizmo 要 attach 的就是这个组） */
  register: (key: IkHandleKey, group: THREE.Group | null) => void
}): JSX.Element | null {
  const ref = React.useRef<THREE.Group>(null)
  React.useLayoutEffect(() => {
    register(spec.key, ref.current)
    return () => register(spec.key, null)
  }, [register, spec.key])
  const lineRef = React.useRef<THREE.Line>(null)
  const positions = React.useMemo(() => new Float32Array(6), [])
  React.useLayoutEffect(() => {
    const group = ref.current
    if (!group) return
    // 把手是一个组（环 + 承接点击的内盘 / 单个球）：标记打在每个网格上，拾取按网格命中；editor-only 让它们不进成片
    const tag: IkHandleTag = { entityId: objectId, key: spec.key }
    group.traverse((child) => {
      tagEditorOnly(child)
      if ((child as THREE.Mesh).isMesh) child.userData[DIRECTOR_IK_HANDLE_KEY] = tag
    })
    if (lineRef.current) tagEditorOnly(lineRef.current)
  }, [objectId, spec])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh || !mesh.parent) return
    const bone = bones.get(spec.bone)
    if (!bone) return
    if (!dragging) {
      if (spec.kind === 'pole') {
        const pole = IK_POLES[spec.key as IkPoleKey]
        const root = bones.get(pole.root)
        const end = bones.get(pole.effector)
        if (root && end) {
          characterRoot.getWorldQuaternion(_charQuat)
          _defaultDir.set(pole.defaultDirection.x, pole.defaultDirection.y, pole.defaultDirection.z).applyQuaternion(_charQuat)
          poleRestPosition(root, bone, end, _defaultDir, pole.distance, _world)
        } else bone.getWorldPosition(_world)
      } else bone.getWorldPosition(_world)
      mesh.position.copy(mesh.parent.worldToLocal(_local.copy(_world)))
    }
    // 引导线：肢体第一节（肘 / 膝）→ 把手；胸腔 = 骨盆 → 胸；极向量 = 中节 → 把手
    const line = lineRef.current
    const from = spec.guideFrom ? bones.get(spec.guideFrom) : null
    if (line && from && line.parent) {
      from.getWorldPosition(_from)
      line.parent.worldToLocal(_from)
      mesh.getWorldPosition(_world)
      line.parent.worldToLocal(_world)
      positions[0] = _from.x
      positions[1] = _from.y
      positions[2] = _from.z
      positions[3] = _world.x
      positions[4] = _world.y
      positions[5] = _world.z
      const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute
      attribute.needsUpdate = true
      line.geometry.computeBoundingSphere()
    }
  })
  const color = selected ? SKELETON_COLORS.handleSelected : SKELETON_COLORS.handle
  const ring = spec.kind === 'pelvis' || spec.kind === 'chest'
  return (
    <>
      {/* 外层组只带位置（gizmo attach 的就是它，轴向保持世界对齐）；环的躺平旋转与选中放大都落在内层网格上（几何体旋转、mesh.scale） */}
      <group ref={ref} name={`ik-handle-${spec.key}`}>
        <mesh renderOrder={1000} rotation={ring ? [Math.PI / 2, 0, 0] : [0, 0, 0]} scale={selected ? 1.3 : 1}>
          <HandleGeometry kind={spec.kind} />
          <meshBasicMaterial color={color} transparent opacity={selected ? 1 : 0.75} depthTest={false} depthWrite={false} />
        </mesh>
        {ring ? (
          // 环心是空的，点中心会落空：加一片近透明内盘承接点击
          <mesh renderOrder={999} rotation={[Math.PI / 2, 0, 0]} scale={selected ? 1.3 : 1}>
            <circleGeometry args={[spec.kind === 'pelvis' ? 0.13 : 0.11, 24]} />
            <meshBasicMaterial color={color} transparent opacity={0.08} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        ) : null}
      </group>
      {spec.guideFrom ? (
        // @ts-expect-error -- R3F 的 <line> 是 three Line，不是 SVG line
        <line ref={lineRef} renderOrder={999} raycast={() => null}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={SKELETON_COLORS.handle} transparent opacity={spec.kind === 'chest' ? 0.35 : 0.45} depthTest={false} depthWrite={false} />
        </line>
      ) : null}
    </>
  )
}

/**
 * gizmo 拖动事件（dragging-changed 开 / 关，objectChange 才是真的动了）。
 * 不走 drei 的 onMouseDown / onChange：mouseDown 只在指针先悬停到轴上才发，headless 点击不悬停就漏；change 连悬停高亮都发。
 * 处理器读 ref，不吃闭包——选择切换后 gizmo 还是同一个实例，旧闭包里的把手会张冠李戴。
 */
function useGizmoDrag(handlers: { onStart: () => void; onMove: () => void; onEnd: () => void }): (instance: unknown) => void {
  const [controls, setControls] = React.useState<GizmoControls | null>(null)
  const handlersRef = React.useRef(handlers)
  handlersRef.current = handlers
  React.useEffect(() => {
    if (!controls) return
    const onDragging = (event: { value?: boolean }) => (event.value ? handlersRef.current.onStart() : handlersRef.current.onEnd())
    const onObjectChange = () => handlersRef.current.onMove()
    controls.addEventListener('dragging-changed', onDragging)
    controls.addEventListener('objectChange', onObjectChange)
    return () => {
      controls.removeEventListener('dragging-changed', onDragging)
      controls.removeEventListener('objectChange', onObjectChange)
    }
  }, [controls])
  return React.useCallback((instance: unknown) => {
    if (!instance) return
    // 把手 gizmo 不进截图 / 出片 / 画中画（TransformGizmo 同）
    tagEditorOnly(instance as THREE.Object3D)
    setControls(instance as GizmoControls)
  }, [])
}

/** 选中骨骼时挂在骨上的旋转 gizmo（FK：TransformControls rotate 直接 attach 骨；拖动中每帧写 base⁻¹·当前 的欧拉度） */
function BoneRotateGizmo({ objectId, bone, boneKeyName, api }: { objectId: string; bone: THREE.Bone; boneKeyName: string; api: CharacterRigApi }): JSX.Element {
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const { scene } = useThree()
  const draggingRef = React.useRef(false)
  const ref = useGizmoDrag({
    onStart: () => {
      draggingRef.current = true
      apiRef.current?.setOrbitEnabled(false)
      const state = store.getState()
      state.saveState()
      state.syncBoneKeyframeAtPlayhead(objectId)
    },
    onMove: () => {
      const base = draggingRef.current ? api.baseQuaternionOf(bone) : undefined
      if (!base) return
      store.getState().setBoneRotation(objectId, boneKeyName, offsetFromBase(bone, base))
    },
    onEnd: () => {
      draggingRef.current = false
      apiRef.current?.setOrbitEnabled(true)
    },
  })
  return createPortal(<TransformControls ref={ref} object={bone} mode="rotate" />, scene)
}

export function SkeletonHandles({ objectId, rig, api, selected }: { objectId: string; rig: DirectorRig; api: CharacterRigApi; selected: boolean }): JSX.Element | null {
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const { scene } = useThree()
  const focused = useDirectorStore((state) => state.isSkeletonEditing && state.selection.objectId === objectId)
  const anyFocused = useDirectorStore((state) => state.isSkeletonEditing)
  const showSkeleton = useDirectorStore((state) => state.activeScene().sceneConfig.showSkeleton)
  const objectVisible = useDirectorStore((state) => isDirectorObjectVisible(state.activeScene(), objectId))
  const ikMode = useDirectorStore((state) => state.ikModeEnabled)
  const ikTarget = useDirectorStore((state) => (state.selection.objectId === objectId ? state.selection.ikTarget : null))
  const boneKey = useDirectorStore((state) => (state.selection.objectId === objectId ? (state.selection.boneKey as SemanticBone | null) : null))
  // 工具条没选工具就不挂任何 gizmo（把手 / 骨骼都一样）
  const toolActive = useDirectorStore((state) => state.transformMode !== null)
  const [draggingKey, setDraggingKey] = React.useState<IkHandleKey | null>(null)
  // 把手组登记表 + 选中把手的组（state：gizmo 要在把手组挂上之后的下一次提交才能 attach，直接在渲染里读 ref 会拿到 null 且不再重渲染）
  const handleGroupsRef = React.useRef(new Map<IkHandleKey, THREE.Group>())
  const [activeMesh, setActiveMesh] = React.useState<THREE.Group | null>(null)
  const registerHandle = React.useCallback((key: IkHandleKey, group: THREE.Group | null) => {
    if (group) handleGroupsRef.current.set(key, group)
    else handleGroupsRef.current.delete(key)
  }, [])
  const pelvisStartRef = React.useRef<{ handle: THREE.Vector3; offset: { x: number; y: number; z: number } } | null>(null)
  // 拖动态走 ref：gizmo 事件在 React 重渲染之前就到，state 会慢一拍
  const activeDragRef = React.useRef<{ spec: HandleSpec; mesh: THREE.Object3D } | null>(null)

  const bones = React.useMemo(() => {
    const map = new Map<SemanticBone, THREE.Bone>()
    const wanted = new Set<SemanticBone>()
    for (const spec of HANDLE_SPECS) {
      wanted.add(spec.bone)
      if (spec.guideFrom) wanted.add(spec.guideFrom)
    }
    for (const pole of Object.values(IK_POLES)) {
      wanted.add(pole.root)
      wanted.add(pole.effector)
    }
    for (const semantic of wanted) {
      const bone = findSemanticBone(api.boneIndex as BoneIndex, rig, semantic)
      if (bone) map.set(semantic, bone)
    }
    return map
  }, [api.boneIndex, rig])
  const characterRoot = React.useMemo(() => {
    const hips = bones.get('hips')
    let node: THREE.Object3D | null = hips ?? null
    while (node && (node as THREE.Bone).isBone) node = node.parent
    return node ?? scene
  }, [bones, scene])

  // 三段拖动协议（gizmo 驱动）：开始 = 快照 + 对齐关键帧 + 起点（骨盆另记两脚钉位）；中途 = 骨盆改偏移 / 其余更新靶点；结束 = 清拖动态
  const beginDrag = React.useCallback(
    (spec: HandleSpec, mesh: THREE.Object3D) => {
      apiRef.current?.setOrbitEnabled(false)
      setDraggingKey(spec.key)
      const start = mesh.getWorldPosition(new THREE.Vector3())
      api.beginIkDrag(spec.key, start)
      if (spec.kind === 'pelvis') {
        const object = store.getState().findObject(objectId)
        pelvisStartRef.current = { handle: start, offset: object?.hipsOffset ?? { x: 0, y: 0, z: 0 } }
      }
    },
    [api, apiRef, objectId, store],
  )
  const moveDrag = React.useCallback(
    (spec: HandleSpec, mesh: THREE.Object3D) => {
      const now = mesh.getWorldPosition(new THREE.Vector3())
      if (spec.kind === 'pelvis') {
        const start = pelvisStartRef.current
        if (!start) return
        store.getState().setHipsOffset(objectId, {
          x: Number((start.offset.x + now.x - start.handle.x).toFixed(3)),
          y: Number((start.offset.y + now.y - start.handle.y).toFixed(3)),
          z: Number((start.offset.z + now.z - start.handle.z).toFixed(3)),
        })
        return
      }
      api.updateIkDrag(spec.key, now)
    },
    [api, objectId, store],
  )
  const endDrag = React.useCallback(() => {
    apiRef.current?.setOrbitEnabled(true)
    setDraggingKey(null)
    pelvisStartRef.current = null
    activeDragRef.current = null
    api.endIkDrag()
  }, [api, apiRef])
  // 当前选中把手（渲染时刷新，gizmo 事件按它取）
  const activeRef = React.useRef<{ spec: HandleSpec; mesh: THREE.Object3D } | null>(null)
  const gizmoRef = useGizmoDrag({
    onStart: () => {
      const active = activeRef.current
      if (!active) return
      activeDragRef.current = active
      beginDrag(active.spec, active.mesh)
    },
    onMove: () => {
      const drag = activeDragRef.current
      if (drag) moveDrag(drag.spec, drag.mesh)
    },
    onEnd: endDrag,
  })
  const layerOn = objectVisible && (focused || (!anyFocused && showSkeleton))
  const handlesMounted = selected && ikMode && layerOn
  React.useLayoutEffect(() => {
    setActiveMesh(handlesMounted && ikTarget ? handleGroupsRef.current.get(ikTarget as IkHandleKey) ?? null : null)
  }, [handlesMounted, ikTarget])

  if (!selected) return null
  // FK：选中骨骼 → 旋转 gizmo 挂在骨上（骨骼球本身在 SkeletonVisual）
  if (!ikMode) {
    const bone = boneKey ? findBoneByName(api.boneIndex as BoneIndex, boneName(rig, boneKey)) : undefined
    return layerOn && toolActive && bone && boneKey ? <BoneRotateGizmo objectId={objectId} bone={bone} boneKeyName={boneName(rig, boneKey)} api={api} /> : null
  }
  if (!layerOn) return null

  const activeSpec = ikTarget ? HANDLE_SPECS.find((spec) => spec.key === ikTarget) : undefined
  activeRef.current = activeSpec && activeMesh ? { spec: activeSpec, mesh: activeMesh } : null

  return (
    <group name="skeleton-handles">
      {HANDLE_SPECS.map((spec) =>
        bones.has(spec.bone) ? (
          <HandleMesh
            key={spec.key}
            objectId={objectId}
            spec={spec}
            bones={bones}
            characterRoot={characterRoot}
            selected={ikTarget === spec.key}
            dragging={draggingKey === spec.key}
            register={registerHandle}
          />
        ) : null,
      )}
      {toolActive && activeSpec && activeMesh ? createPortal(<TransformControls ref={gizmoRef} object={activeMesh} mode="translate" />, scene) : null}
    </group>
  )
}
