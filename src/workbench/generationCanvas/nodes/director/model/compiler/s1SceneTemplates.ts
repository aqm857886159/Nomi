import type { DirectorObject } from '../directorTypes'
import { originYForBottom } from '../directorSpace'
import type { DirectorSceneTemplate, DirectorStageKind } from '../../../../../../../electron/shared/director/vocab'

type Template = DirectorSceneTemplate
type Size = { x: number; y: number; z: number }
const GROUND_THICKNESS = 0.05

/** 模板里的一件东西：渲染对象 + 舞台种类（种类决定它在舞台上的角色，见 directorStage）。 */
export type TemplatePart = { object: DirectorObject; kind: DirectorStageKind }
/**
 * 命名站位（借 FilmAgent 的离散站位结构，站位由我们按每个模板手标）：id = `<模板件 id>#<名>`。
 * stand = 演员站的点；set = 家具 / 布景件靠里放的点（不挡镜头那一侧）。facing 是站在这里默认朝哪（yaw 度，0 = +Z 朝观众）。
 */
export type TemplateMark = { id: string; thingId: string; at: { x: number; z: number }; facing: number; use: 'stand' | 'set' }
/** 可站区域：地面以内、墙的里侧（水平范围）。 */
export type StageArea = { minX: number; maxX: number; minZ: number; maxZ: number }
export type S1TemplateSpec = { parts: TemplatePart[]; marks: TemplateMark[]; interior: StageArea }

/**
 * 模板件按「底在哪」声明，原点 y 由 directorSpace.originYForBottom 换算——模板里不再手写「中心」坐标。
 * 地面板顶面 = y 0（向下长 GROUND_THICKNESS），所以全场只有一个地面高度：人和物按 y 0 站。
 */
const part = (id: string, name: string, kind: DirectorStageKind, type: DirectorObject['type'], at: { x: number; z: number }, scale: Size, color = '#94a3b8', bottom = 0): TemplatePart => ({
  kind,
  object: { id, name, type, position: { x: at.x, y: originYForBottom({ type, scale }, bottom), z: at.z }, rotation: { x: 0, y: 0, z: 0 }, scale, color, visible: true, locked: true, isAuxiliary: false },
})
const block = (id: string, name: string, kind: DirectorStageKind, at: { x: number; z: number }, scale: Size, color?: string, bottom?: number) => part(id, name, kind, 'cube', at, scale, color, bottom)
const ground = (id: string, size: { x: number; z: number }, color: string) => block(id, 'ground', 'ground', { x: 0, z: 0 }, { x: size.x, y: GROUND_THICKNESS, z: size.z }, color, -GROUND_THICKNESS)
const mark = (thingId: string, name: string, x: number, z: number, facing = 0, use: TemplateMark['use'] = 'stand'): TemplateMark => ({ id: `${thingId}#${name}`, thingId, at: { x, z }, facing, use })

/** S1-only template adapter. Existing street/room builders remain untouched; these objects preserve their semantic layout. */
export function buildS1Template(template: Template): S1TemplateSpec {
  if (template === 'courtyard') return {
    parts: [
      ground('s1-courtyard-ground', { x: 18, z: 18 }, '#64748b'),
      block('s1-courtyard-wall-north', 'wall_enclosure', 'wall', { x: 0, z: -8 }, { x: 16, y: 4, z: 0.3 }, '#a8a29e'),
      block('s1-courtyard-wall-east', 'wall east', 'wall', { x: 8, z: 0 }, { x: 0.3, y: 4, z: 16 }, '#a8a29e'),
      block('s1-courtyard-gate', 'gate', 'gate', { x: 0, z: -7.7 }, { x: 2.5, y: 2.4, z: 0.35 }, '#78350f'),
      part('s1-courtyard-tree', 'courtyard tree', 'tree', 'cylinder', { x: -5, z: -4 }, { x: 1.2, y: 3, z: 1.2 }, '#166534'),
    ],
    marks: [
      mark('s1-courtyard-ground', 'center', 0, 0),
      mark('s1-courtyard-ground', 'set', -3, -4.5, 0, 'set'),
      // 「站在院门」= 门洞里侧一步，面向院内
      mark('s1-courtyard-gate', 'front', 0, -6.9),
      mark('s1-courtyard-wall-north', 'front', 3.5, -7.2),
      mark('s1-courtyard-wall-east', 'front', 7.2, 1, -90),
      mark('s1-courtyard-tree', 'front', -5, -2.8),
    ],
    interior: { minX: -9, maxX: 7.85, minZ: -7.85, maxZ: 9 },
  }
  if (template === 'product_stage') return {
    parts: [
      ground('s1-product-ground', { x: 14, z: 14 }, '#e2e8f0'),
      block('s1-product-backdrop', 'wall backdrop', 'backdrop', { x: 0, z: -5 }, { x: 12, y: 6, z: 0.2 }, '#f8fafc'),
      part('s1-product-pedestal', 'round_pedestal', 'pedestal', 'cylinder', { x: 0, z: 0 }, { x: 0.8, y: 1, z: 0.8 }, '#cbd5e1'),
    ],
    marks: [
      mark('s1-product-ground', 'center', 0, 1.5),
      mark('s1-product-ground', 'set', -3, -3, 0, 'set'),
      mark('s1-product-pedestal', 'front', 0, 1),
      mark('s1-product-backdrop', 'front', 0, -4.3),
    ],
    interior: { minX: -7, maxX: 7, minZ: -4.9, maxZ: 7 },
  }
  if (template === 'room') return {
    parts: [
      ground('s1-room-floor', { x: 10, z: 8 }, '#a8a29e'),
      block('s1-room-back', 'wall back', 'wall', { x: 0, z: -4 }, { x: 10, y: 4, z: 0.2 }, '#d6d3d1'),
      block('s1-room-left', 'wall left', 'wall', { x: -5, z: 0 }, { x: 0.2, y: 4, z: 8 }, '#d6d3d1'),
    ],
    marks: [
      mark('s1-room-floor', 'center', 0, 0),
      // 家具靠里墙放：演员在它前面，镜头从 +Z 一侧拍时不被它挡
      mark('s1-room-floor', 'set', 0, -2.2, 0, 'set'),
      mark('s1-room-back', 'front', 2, -3.3),
      mark('s1-room-left', 'front', -4.3, 0, 90),
    ],
    interior: { minX: -4.9, maxX: 5, minZ: -3.9, maxZ: 4 },
  }
  return {
    parts: [
      ground('s1-street-ground', { x: 10, z: 30 }, '#475569'),
      block('s1-street-road-left', 'road', 'road', { x: -7, z: 0 }, { x: 3, y: 0.2, z: 30 }, '#a8a29e'),
      block('s1-street-road-right', 'road', 'road', { x: 7, z: 0 }, { x: 3, y: 0.2, z: 30 }, '#a8a29e'),
      block('s1-street-building-left', 'buildings_both_sides', 'building', { x: -10, z: 0 }, { x: 2, y: 6, z: 30 }, '#334155'),
      block('s1-street-building-right', 'buildings_both_sides', 'building', { x: 10, z: 0 }, { x: 2, y: 6, z: 30 }, '#334155'),
    ],
    marks: [
      mark('s1-street-ground', 'center', 0, 0),
      mark('s1-street-ground', 'set', -3.5, -6, 0, 'set'),
      mark('s1-street-building-left', 'front', -8.3, 0, 90),
      mark('s1-street-building-right', 'front', 8.3, 0, -90),
    ],
    interior: { minX: -8.5, maxX: 8.5, minZ: -15, maxZ: 15 },
  }
}

export type S1Template = Template
