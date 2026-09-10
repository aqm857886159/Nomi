/**
 * [INPUT]: 依赖 react、three、@react-three/fiber（createPortal / useFrame / useThree）、../../DirectorEditorContext、../sceneRefs（isDirectorObjectVisible / tagEditorOnly / DIRECTOR_BONE_KEY / BoneTag）、
 *          ../sceneTheme 的 SKELETON_COLORS、../../model/rigs（FK_JOINTS / SemanticBone）、../../model/directorTypes 的 DirectorRig、./characterRig 的 findSemanticBone / BoneIndex
 * [OUTPUT]: 对外提供 SkeletonVisual：角色骨骼可视化——每段骨一枚细菱形（八面体，宽 = 长 × 0.14，按脊柱 / 手臂 / 腿分色）+ 关节小黄点，
 *           17 颗 FK 关节另带一层透明拾取球（比可见点大一圈，DIRECTOR_BONE_KEY 标记给拾取），选中骨 / 关节变红
 * [POS]: director/scene/character 的骨骼层：显示规则：该角色骨骼页聚焦，或没有任何角色聚焦且图层开了「显示骨骼」；
 *        IK 模式下关节拾取球只在聚焦时出现（避免和把手抢点击）。样子按用户 2026-09-04 给的参考图（细菱形骨 + 小圆点关节），不再用 SkeletonHelper 线 + 大球：
 *        大球在真人尺寸下盖住肢体、根本点不准。手指 / 脚趾末端 / 头顶 End 骨不画。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useDirectorStore } from '../../DirectorEditorContext'
import type { DirectorRig } from '../../model/directorTypes'
import { FK_JOINTS, type SemanticBone } from '../../model/rigs'
import { DIRECTOR_BONE_KEY, isDirectorObjectVisible, tagEditorOnly, type BoneTag } from '../sceneRefs'
import { SKELETON_COLORS } from '../sceneTheme'
import { findSemanticBone, type BoneIndex } from './characterRig'

/** 关节可见点 / 拾取球半径（米，真人 1.75m 尺度） */
const JOINT_RADIUS = 0.012
const PICK_RADIUS = 0.03
/** 菱形骨宽 = 段长 × 这个比例；最宽处在离父关节 18% 处 */
const BONE_WIDTH_RATIO = 0.14
const BONE_WAIST = 0.18
/** 不画的骨：手指、脚趾末端、头顶 End 骨 */
const SKIP_BONE = /Thumb|Index|Middle|Ring|Pinky|_End$|Toe_End/i

const _parent = new THREE.Vector3()
const _child = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _quat = new THREE.Quaternion()

// 17 颗 FK 关节 = FK 关节表左右展开（头 / 颈 / 腰 + 两侧肩 / 大臂 / 前臂 / 手 / 大腿 / 膝 / 脚）
const PICK_BONES: SemanticBone[] = FK_JOINTS.flatMap((joint) => (joint.mirror ? [joint.bone, joint.mirror] : [joint.bone]))

/** 骨段配色：按名字归到脊柱 / 手臂 / 腿三条链 */
function chainColor(name: string): number {
  if (/Arm|Shoulder|Hand/i.test(name)) return SKELETON_COLORS.boneArm
  if (/UpLeg|Leg|Foot|Toe/i.test(name)) return SKELETON_COLORS.boneLeg
  return SKELETON_COLORS.boneSpine
}

/** 单位菱形骨：底在原点、尖在 (0,1,0)，腰在 y=BONE_WAIST、半径 1（实例按段长 / 宽缩放） */
function boneGeometry(): THREE.BufferGeometry {
  const waist = BONE_WAIST
  const vertices = new Float32Array([
    0, 0, 0, 1, waist, 0, 0, waist, 1,
    0, 0, 0, 0, waist, 1, -1, waist, 0,
    0, 0, 0, -1, waist, 0, 0, waist, -1,
    0, 0, 0, 0, waist, -1, 1, waist, 0,
    0, 1, 0, 0, waist, 1, 1, waist, 0,
    0, 1, 0, -1, waist, 0, 0, waist, 1,
    0, 1, 0, 0, waist, -1, -1, waist, 0,
    0, 1, 0, 1, waist, 0, 0, waist, -1,
  ])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

type BoneSegment = { parent: THREE.Bone; child: THREE.Bone; color: number; semantic: SemanticBone | null }

/** 一段骨：每帧贴到 父关节 → 子关节，长按距离、宽按比例 */
function BoneDiamond({ segment, geometry, selected }: { segment: BoneSegment; geometry: THREE.BufferGeometry; selected: boolean }): JSX.Element {
  const ref = React.useRef<THREE.Mesh>(null)
  React.useLayoutEffect(() => {
    if (ref.current) tagEditorOnly(ref.current)
  }, [])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh || !mesh.parent) return
    segment.parent.getWorldPosition(_parent)
    segment.child.getWorldPosition(_child)
    mesh.parent.worldToLocal(_parent)
    mesh.parent.worldToLocal(_child)
    _dir.subVectors(_child, _parent)
    const length = _dir.length()
    if (length < 1e-5) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    mesh.position.copy(_parent)
    mesh.quaternion.copy(_quat.setFromUnitVectors(_up, _dir.multiplyScalar(1 / length)))
    const width = length * BONE_WIDTH_RATIO
    mesh.scale.set(width, length, width)
  })
  return (
    <mesh ref={ref} geometry={geometry} renderOrder={996} raycast={() => null}>
      <meshBasicMaterial color={selected ? SKELETON_COLORS.boneSelected : segment.color} transparent opacity={selected ? 0.95 : 0.8} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** 关节：可见小黄点 + （FK 关节）透明拾取球 */
function Joint({ objectId, bone, semantic, selected }: { objectId: string; bone: THREE.Bone; semantic: SemanticBone | null; selected: boolean }): JSX.Element {
  const ref = React.useRef<THREE.Group>(null)
  React.useLayoutEffect(() => {
    const group = ref.current
    if (!group) return
    group.traverse((child) => tagEditorOnly(child))
    if (semantic) {
      const tag: BoneTag = { entityId: objectId, bone: semantic }
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) child.userData[DIRECTOR_BONE_KEY] = tag
      })
    }
  }, [objectId, semantic])
  useFrame(() => {
    const group = ref.current
    if (!group || !group.parent) return
    bone.getWorldPosition(_parent)
    group.position.copy(group.parent.worldToLocal(_parent))
  })
  return (
    <group ref={ref} name={semantic ? `bone-hitbox-${semantic}` : undefined}>
      <mesh renderOrder={998} raycast={semantic ? undefined : () => null}>
        <sphereGeometry args={[selected ? JOINT_RADIUS * 1.8 : JOINT_RADIUS, 10, 10]} />
        <meshBasicMaterial color={selected ? SKELETON_COLORS.boneSelected : SKELETON_COLORS.joint} depthTest={false} depthWrite={false} />
      </mesh>
      {semantic ? (
        // 拾取球：看不见但能点（比可见点大一圈，真人尺寸下才点得准）
        <mesh renderOrder={997}>
          <sphereGeometry args={[PICK_RADIUS, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  )
}

export function SkeletonVisual({ objectId, rig, root, boneIndex }: { objectId: string; rig: DirectorRig; root: THREE.Object3D; boneIndex: BoneIndex }): JSX.Element | null {
  const { scene } = useThree()
  const selected = useDirectorStore((state) => state.selection.objectId === objectId)
  const focused = useDirectorStore((state) => state.isSkeletonEditing && state.selection.objectId === objectId)
  const anyFocused = useDirectorStore((state) => state.isSkeletonEditing)
  const showSkeleton = useDirectorStore((state) => state.activeScene().sceneConfig.showSkeleton)
  const objectVisible = useDirectorStore((state) => isDirectorObjectVisible(state.activeScene(), objectId))
  const ikMode = useDirectorStore((state) => state.ikModeEnabled)
  const boneKey = useDirectorStore((state) => (state.selection.objectId === objectId ? (state.selection.boneKey as SemanticBone | null) : null))
  const visible = objectVisible && (focused || (!anyFocused && showSkeleton))
  const pickable = visible && (!ikMode || focused)

  const geometry = React.useMemo(() => boneGeometry(), [])
  React.useEffect(() => () => geometry.dispose(), [geometry])

  // 骨段与关节：从角色骨架收集（跳过手指 / 末端），FK 关节按语义骨表反查
  const { segments, joints } = React.useMemo(() => {
    const semanticOf = new Map<THREE.Bone, SemanticBone>()
    for (const semantic of PICK_BONES) {
      const bone = findSemanticBone(boneIndex, rig, semantic)
      if (bone) semanticOf.set(bone, semantic)
    }
    const segments: BoneSegment[] = []
    const joints: Array<{ bone: THREE.Bone; semantic: SemanticBone | null }> = []
    root.traverse((object) => {
      if (!(object as THREE.Bone).isBone || SKIP_BONE.test(object.name)) return
      const bone = object as THREE.Bone
      joints.push({ bone, semantic: semanticOf.get(bone) ?? null })
      const parent = bone.parent
      // 一段骨的 FK 语义 = 它的父关节（LeftArm 骨从肩到肘，three 里 LeftArm 节点在肩）
      if (parent && (parent as THREE.Bone).isBone) segments.push({ parent: parent as THREE.Bone, child: bone, color: chainColor(bone.name), semantic: semanticOf.get(parent as THREE.Bone) ?? null })
    })
    return { segments, joints }
  }, [boneIndex, rig, root])

  if (!visible) return null
  // 骨骼按世界坐标贴骨，整组传送到场景根（挂在实体变换组里会被二次变换）
  return createPortal(
    <group name="skeleton-visual">
      {segments.map((segment) => (
        <BoneDiamond key={segment.child.uuid} segment={segment} geometry={geometry} selected={selected && segment.semantic !== null && boneKey === segment.semantic} />
      ))}
      {joints.map(({ bone, semantic }) => (
        <Joint key={bone.uuid} objectId={objectId} bone={bone} semantic={pickable ? semantic : null} selected={selected && semantic !== null && boneKey === semantic} />
      ))}
    </group>,
    scene,
  )
}
