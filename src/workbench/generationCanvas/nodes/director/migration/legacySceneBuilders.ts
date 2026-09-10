/**
 * [INPUT]: 依赖 three（lookAt 欧拉）、./legacyScene3dTypes、./legacyPropSpecs
 * [OUTPUT]: 对外提供 createLegacyState、createLegacyObjectId / createLegacyCameraId / createLegacyTrajectoryId / createLegacyPointId / createLegacyBindingId、
 *           legacyCameraLookAtRotation、makeLegacyPropObject、ScenePropPlacement / buildPlacedProps、LegacySceneTemplate / SCENE_TEMPLATES / SCENE_TEMPLATE_LABEL / buildSceneTemplateObjects
 * [POS]: director/migration 的 V1 形状「造物」工具（原 scene3dBindingIds / scene3dPropSpecs 的 builder 段 / scene3dSceneTemplates）：
 *        AI 来导的站位 / 运镜 builder 仍按 V1 语义先造 V1 状态，再经 migrateScene3DState 落成 director 工程——词表数值与 V1 时代逐字一致，不重写一遍几何。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { LEGACY_PROP_SPECS } from './legacyPropSpecs'
import type { LegacyObject, LegacyPropKind, LegacyScene3DState, LegacyVec3 } from './legacyScene3dTypes'

function legacyId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const createLegacyObjectId = (): string => legacyId('obj')
export const createLegacyCameraId = (): string => legacyId('cam')
export const createLegacyTrajectoryId = (): string => legacyId('traj')
export const createLegacyPointId = (): string => legacyId('pt')
export const createLegacyBindingId = (): string => legacyId('bind')

export function createLegacyState(): LegacyScene3DState {
  return {
    objects: [],
    cameras: [],
    trajectories: [],
    trajectoryBindings: [],
    environment: { showGrid: true, backgroundColor: '', panoramaRotation: 0, sphereRadius: 50 },
    hasEditorCamera: false,
    hasTrajectoryGroups: false,
  }
}

/** V1 相机 rotation：Object3D.lookAt 的欧拉（XYZ，弧度）——迁移器只看 target，这里只为保留 V1 字段完整 */
export function legacyCameraLookAtRotation(position: LegacyVec3, target: LegacyVec3): LegacyVec3 {
  const object = new THREE.Object3D()
  object.position.fromArray(position)
  object.lookAt(new THREE.Vector3(...target))
  return [Number(object.rotation.x.toFixed(4)), Number(object.rotation.y.toFixed(4)), Number(object.rotation.z.toFixed(4))]
}

export function makeLegacyPropObject(kind: LegacyPropKind): LegacyObject {
  const spec = LEGACY_PROP_SPECS[kind]
  return {
    id: createLegacyObjectId(),
    name: spec.label,
    type: 'prop',
    visible: true,
    position: [0, 0, 0], // origin 在地面中心：y=0 即贴地
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: spec.defaultColor,
    propKind: kind,
  }
}

// 语义道具摆位（AI 侧共享原语）：kind 必填，位置/朝向/缩放可选。站位与运镜工具共用同一份。position 省略 → 沿主体右侧(+X)铺开
export type ScenePropPlacement = {
  kind: LegacyPropKind
  position?: [number, number] // [x, z]，地面坐标
  rotationY?: number // 度
  scale?: number
}

const DEG_TO_RAD = Math.PI / 180

export function buildPlacedProps(props: ScenePropPlacement[] | undefined): LegacyObject[] {
  if (!props || props.length === 0) return []
  const known = props.filter((prop) => (prop.kind as string) in LEGACY_PROP_SPECS)
  return known.map((prop, index) => {
    const object = makeLegacyPropObject(prop.kind)
    const [x, z] = prop.position ?? [2.5 + index * 2.2, -0.5]
    object.position = [x, 0, z]
    if (typeof prop.rotationY === 'number' && Number.isFinite(prop.rotationY)) object.rotation = [0, prop.rotationY * DEG_TO_RAD, 0]
    if (typeof prop.scale === 'number' && Number.isFinite(prop.scale) && prop.scale > 0) {
      const s = Math.min(10, Math.max(0.1, prop.scale))
      object.scale = [s, s, s]
    }
    return object
  })
}

// ── 场景模板：一键搭好的灰模布景（城市街道 / 室内房间），只产对象数组、追加进场景 ──
export type LegacySceneTemplate = 'street' | 'room'
export const SCENE_TEMPLATES: LegacySceneTemplate[] = ['street', 'room']
export const SCENE_TEMPLATE_LABEL: Record<LegacySceneTemplate, string> = { street: '城市街道', room: '室内房间' }

function meshBlock(name: string, color: string, scale: LegacyVec3, position: LegacyVec3, rotation: LegacyVec3 = [0, 0, 0]): LegacyObject {
  return { id: createLegacyObjectId(), name, type: 'mesh', visible: true, position, rotation, scale, color, geometry: 'box' }
}

/** 平铺地面：plane 旋转平放，scale[0]=宽(x)、scale[1]=长(z)。微抬 y 避免与网格 z-fight */
function groundPlane(name: string, color: string, width: number, length: number, y = 0.02): LegacyObject {
  return { id: createLegacyObjectId(), name, type: 'mesh', visible: true, position: [0, y, 0], rotation: [-Math.PI / 2, 0, 0], scale: [width, length, 1], color, geometry: 'plane' }
}

function prop(kind: LegacyPropKind, name: string, position: LegacyVec3, rotationY = 0, scale?: LegacyVec3): LegacyObject {
  const object = makeLegacyPropObject(kind)
  object.name = name
  object.position = position
  object.rotation = [0, rotationY, 0]
  if (scale) object.scale = scale
  return object
}

function buildStreet(): LegacyObject[] {
  const objects: LegacyObject[] = [
    groundPlane('马路', '#5a5d63', 8, 40),
    meshBlock('人行道·左', '#8f8a80', [3, 0.15, 40], [-5.5, 0.075, 0]),
    meshBlock('人行道·右', '#8f8a80', [3, 0.15, 40], [5.5, 0.075, 0]),
  ]
  for (let index = 0; index < 8; index += 1) objects.push(meshBlock('车道线', '#e8e4da', [0.15, 0.02, 2], [0, 0.04, -17.5 + index * 5]))
  const buildingHeights = [1.0, 0.7, 1.3, 0.85, 1.15, 0.75]
  buildingHeights.forEach((heightScale, index) => {
    const side = index % 2 === 0 ? -1 : 1
    const z = -15 + Math.floor(index / 2) * 15
    objects.push(prop('building', '楼', [side * 11, 0, z], 0, [1, heightScale, 1]))
  })
  for (const z of [-12, 0, 12]) {
    objects.push(prop('tree', '行道树', [-5.5, 0.15, z + 2]))
    objects.push(prop('tree', '行道树', [5.5, 0.15, z - 2]))
  }
  objects.push(prop('streetlamp', '路灯', [-4.6, 0.15, -8], 0))
  objects.push(prop('streetlamp', '路灯', [4.6, 0.15, 8], Math.PI))
  objects.push(prop('car', '车辆', [-2, 0.02, 6], 0))
  objects.push(prop('car', '车辆', [2, 0.02, -6], Math.PI))
  return objects
}

function buildRoom(): LegacyObject[] {
  return [
    groundPlane('地板', '#a89f90', 8, 6),
    prop('wall', '墙·后', [0, 0, -3], 0, [2, 1.1, 1]),
    prop('wall', '墙·左', [-4, 0, 0], Math.PI / 2, [1.5, 1.1, 1]),
    prop('wall', '墙·右', [4, 0, 0], Math.PI / 2, [1.5, 1.1, 1]),
    meshBlock('床', '#b8aa98', [1.8, 0.5, 2.1], [-2.4, 0.25, -1.6]),
    meshBlock('桌子', '#9d8f7c', [1.6, 0.75, 0.8], [2.2, 0.375, -2.2]),
    meshBlock('沙发', '#8d9aa5', [2.0, 0.7, 0.9], [1.6, 0.35, 1.8], [0, Math.PI, 0]),
    { id: createLegacyObjectId(), name: '顶灯', type: 'light', visible: true, position: [0, 2.6, 0], rotation: [0, 0, 0], scale: [1, 1, 1], lightType: 'point', lightColor: '#fff2dd', lightIntensity: 2.2 },
  ]
}

export function buildSceneTemplateObjects(template: LegacySceneTemplate): LegacyObject[] {
  const label = SCENE_TEMPLATE_LABEL[template]
  return (template === 'street' ? buildStreet() : buildRoom()).map((object) => ({ ...object, templateGroup: label }))
}
