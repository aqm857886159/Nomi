// 语义道具的 spec 数据与纯函数（与渲染组件 scene3dProps.tsx 分文件：react-refresh 要求
// 组件文件只导出组件；serializer/toolbar/模板 builder 等纯逻辑消费方也不用拖进 three/r3f）。
// 每种道具 = 图元组合的数据 spec，新增 kind 只加一条 spec。origin 在**地面中心**
// （y=0 落地即贴地；objectVisualHalfHeight 对 prop 返回 0，绑轨迹时底面贴着轨迹走，如车沿路径开）。
import type { Scene3DObject, Scene3DPropKind, Scene3DVector3 } from './scene3dTypes'
import { createScene3DObjectId } from './scene3dSerializer'

export type PropPartGeometry = 'box' | 'cylinder' | 'sphere' | 'cone'

export type PropPart = {
  geometry: PropPartGeometry
  /** box: [宽,高,深]；cylinder: [顶半径,底半径,高]；cone: [底半径,高]；sphere: [半径] */
  size: number[]
  position: Scene3DVector3
  rotation?: Scene3DVector3
  /** 缺省 = 用 object.color（该 kind 的「主体色」部件） */
  color?: string
}

export type PropSpec = {
  label: string
  /** 该 kind 的出厂主体色（3D 渲染色，主题无关——与 scene3d 现有对象色同例） */
  defaultColor: string
  /** 地面占位（未缩放），供避让摆位/选中包围用 */
  footprint: { width: number; depth: number }
  parts: PropPart[]
}

export const PROP_SPECS: Record<Scene3DPropKind, PropSpec> = {
  car: {
    label: '车辆',
    defaultColor: '#8f9aa8',
    footprint: { width: 1.9, depth: 4.6 },
    parts: [
      { geometry: 'box', size: [1.8, 0.7, 4.4], position: [0, 0.55, 0] },
      { geometry: 'box', size: [1.6, 0.6, 2.2], position: [0, 1.2, -0.3] },
      { geometry: 'cylinder', size: [0.34, 0.34, 0.26], position: [0.85, 0.34, 1.4], rotation: [0, 0, Math.PI / 2], color: '#3a3a3e' },
      { geometry: 'cylinder', size: [0.34, 0.34, 0.26], position: [-0.85, 0.34, 1.4], rotation: [0, 0, Math.PI / 2], color: '#3a3a3e' },
      { geometry: 'cylinder', size: [0.34, 0.34, 0.26], position: [0.85, 0.34, -1.4], rotation: [0, 0, Math.PI / 2], color: '#3a3a3e' },
      { geometry: 'cylinder', size: [0.34, 0.34, 0.26], position: [-0.85, 0.34, -1.4], rotation: [0, 0, Math.PI / 2], color: '#3a3a3e' },
    ],
  },
  building: {
    label: '建筑',
    defaultColor: '#b3aca0',
    footprint: { width: 6.4, depth: 6.4 },
    parts: [
      { geometry: 'box', size: [6, 12, 6], position: [0, 6, 0] },
      { geometry: 'box', size: [6.4, 0.3, 6.4], position: [0, 12.15, 0], color: '#8d867b' },
    ],
  },
  tree: {
    label: '树木',
    defaultColor: '#5c9457',
    footprint: { width: 2.3, depth: 2.3 },
    parts: [
      { geometry: 'cylinder', size: [0.14, 0.18, 1.4], position: [0, 0.7, 0], color: '#7c5a3a' },
      { geometry: 'sphere', size: [1.15], position: [0, 2.35, 0] },
      { geometry: 'sphere', size: [0.85], position: [0.35, 3.0, 0.15] },
    ],
  },
  streetlamp: {
    label: '路灯',
    defaultColor: '#6b7078',
    footprint: { width: 1.0, depth: 1.0 },
    parts: [
      { geometry: 'cylinder', size: [0.06, 0.09, 4.2], position: [0, 2.1, 0] },
      { geometry: 'box', size: [0.9, 0.07, 0.07], position: [0.42, 4.15, 0] },
      { geometry: 'box', size: [0.5, 0.12, 0.22], position: [0.8, 4.1, 0] },
      { geometry: 'sphere', size: [0.09], position: [0.8, 4.0, 0], color: '#ffd9a0' },
    ],
  },
  wall: {
    label: '墙面',
    defaultColor: '#b9b2a6',
    footprint: { width: 4.0, depth: 0.3 },
    parts: [
      { geometry: 'box', size: [4, 2.6, 0.24], position: [0, 1.3, 0] },
    ],
  },
}

export const PROP_KINDS = Object.keys(PROP_SPECS) as Scene3DPropKind[]

export function propKindLabel(kind: Scene3DPropKind): string {
  return PROP_SPECS[kind].label
}

export function propDefaultColor(kind: Scene3DPropKind): string {
  return PROP_SPECS[kind].defaultColor
}

export function propGroundFootprint(kind: Scene3DPropKind): { width: number; depth: number } {
  return PROP_SPECS[kind].footprint
}

export function makePropObject(kind: Scene3DPropKind): Scene3DObject {
  return {
    id: createScene3DObjectId(),
    name: propKindLabel(kind),
    type: 'prop',
    visible: true,
    position: [0, 0, 0], // origin 在地面中心：y=0 即贴地
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: propDefaultColor(kind),
    propKind: kind,
  }
}
