/**
 * [INPUT]: 依赖 zod、./directorTypes（DirectorPrimitiveType / DIRECTOR_PRIMITIVE_TYPES / Vec3）、./vec3 的 RAD_TO_DEG
 * [OUTPUT]: 对外提供 AiSceneSpec / AiSceneElement / AiSceneGroup、aiSceneSchema、parseAiSceneText、normalizeAiScene、buildAiScenePrompt、
 *           primitiveTypeFromName、rotationLooksLikeRadians、AI_SCENE_FIXTURE
 * [POS]: director/model 的「AI 搭场景」纯层：LLM 直出 block-out 几何的 JSON 契约、容错解析（剥 Markdown 围栏 / 抓第一段 JSON）、
 *        类型名映射到 V2 八种几何体（多出的映射到最近似）、旋转弧度 / 角度启发式（全部 |r| ≤ 2π 视为弧度）、提示词模板；物化进 store 在 storeAiSceneActions。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { z } from 'zod'
import { DIRECTOR_PRIMITIVE_TYPES, type DirectorPrimitiveType, type Vec3 } from './directorTypes'
import { RAD_TO_DEG } from './vec3'

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])

export const aiSceneElementSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  position: vec3Schema.optional(),
  rotation: vec3Schema.optional(),
  scale: vec3Schema.optional(),
  color: z.string().optional(),
  roughness: z.number().optional(),
  metalness: z.number().optional(),
  opacity: z.number().optional(),
  wireframe: z.boolean().optional(),
  flatShading: z.boolean().optional(),
})

export const aiSceneSchema = z.object({
  sceneName: z.string().optional(),
  sceneConfig: z.object({ skyColor: z.string().optional(), groundOpacity: z.number().optional() }).optional(),
  groups: z.array(z.object({ name: z.string().optional(), elements: z.array(aiSceneElementSchema).default([]) })).min(1),
})

export type AiSceneSpec = z.infer<typeof aiSceneSchema>
export type AiSceneElement = z.infer<typeof aiSceneElementSchema>
export type AiSceneGroup = AiSceneSpec['groups'][number]

export const AI_SCENE_MAX_ELEMENTS = 60

// LLM 给的类型名 → 几何体；V2 只有八种，多出的映射到最近似的
const TYPE_ALIASES: Record<string, DirectorPrimitiveType> = {
  box: 'cube',
  cube: 'cube',
  block: 'cube',
  wall: 'cube',
  cylinder: 'cylinder',
  capsule: 'cylinder',
  cone: 'cone',
  sphere: 'sphere',
  ball: 'sphere',
  torus: 'torus',
  torus_knot: 'torus',
  torusknot: 'torus',
  plane: 'plane',
  ring: 'plane',
  circle: 'plane',
  ground: 'plane',
  tetrahedron: 'tetrahedron',
  icosahedron: 'icosahedron',
  dodecahedron: 'icosahedron',
  octahedron: 'icosahedron',
}

export function primitiveTypeFromName(raw: string | undefined): DirectorPrimitiveType {
  const key = (raw ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_')
  if ((DIRECTOR_PRIMITIVE_TYPES as readonly string[]).includes(key)) return key as DirectorPrimitiveType
  return TYPE_ALIASES[key] ?? 'cube'
}

// 有非零旋转且全部 |r| ≤ 2π → 整份当弧度
export function rotationLooksLikeRadians(groups: AiSceneGroup[]): boolean {
  let max = 0
  let any = false
  for (const group of groups) {
    for (const element of group.elements) {
      for (const value of element.rotation ?? []) {
        const magnitude = Math.abs(Number(value) || 0)
        if (magnitude > 1e-4) {
          any = true
          if (magnitude > max) max = magnitude
        }
      }
    }
  }
  return any && max <= Math.PI * 2 + 0.01
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function toVec3(value: [number, number, number] | undefined, fallback: number): Vec3 {
  return { x: round2(value?.[0] ?? fallback), y: round2(value?.[1] ?? fallback), z: round2(value?.[2] ?? fallback) }
}

export type NormalizedAiElement = {
  name: string
  type: DirectorPrimitiveType
  position: Vec3
  rotation: Vec3
  scale: Vec3
  color: string
  roughness?: number
  metalness?: number
  opacity?: number
  wireframe?: boolean
  flatShading?: boolean
}

export type NormalizedAiScene = {
  sceneName: string
  skyColor?: string
  groundOpacity?: number
  groups: Array<{ name: string; elements: NormalizedAiElement[] }>
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

// 校验后的 spec → 物化前的规整数据：旋转统一成度、颜色兜底、元素总数封顶
export function normalizeAiScene(spec: AiSceneSpec, fallbackSceneName: string): NormalizedAiScene {
  const radians = rotationLooksLikeRadians(spec.groups)
  let budget = AI_SCENE_MAX_ELEMENTS
  const groups = spec.groups.map((group, groupIndex) => ({
    name: (group.name ?? '').trim() || `${fallbackSceneName} ${groupIndex + 1}`,
    elements: group.elements.slice(0, Math.max(0, budget)).map((element, index) => {
      budget -= 1
      const rotation = toVec3(element.rotation, 0)
      if (radians) {
        rotation.x = round2(rotation.x * RAD_TO_DEG)
        rotation.y = round2(rotation.y * RAD_TO_DEG)
        rotation.z = round2(rotation.z * RAD_TO_DEG)
      }
      return {
        name: (element.name ?? '').trim() || `${primitiveTypeFromName(element.type)} ${index + 1}`,
        type: primitiveTypeFromName(element.type),
        position: toVec3(element.position, 0),
        rotation,
        scale: toVec3(element.scale, 1),
        color: element.color && HEX_COLOR.test(element.color) ? element.color.toLowerCase() : '#e2e8f0',
        roughness: element.roughness,
        metalness: element.metalness,
        opacity: element.opacity,
        wireframe: element.wireframe,
        flatShading: element.flatShading,
      }
    }),
  }))
  return {
    sceneName: (spec.sceneName ?? '').trim() || fallbackSceneName,
    skyColor: spec.sceneConfig?.skyColor && HEX_COLOR.test(spec.sceneConfig.skyColor) ? spec.sceneConfig.skyColor.toLowerCase() : undefined,
    groundOpacity: typeof spec.sceneConfig?.groundOpacity === 'number' ? Math.min(1, Math.max(0, spec.sceneConfig.groundOpacity)) : undefined,
    groups,
  }
}

// 模型回复容错：剥 ```json 围栏、抓第一个 { 到最后一个 }；解析失败或不合 schema 返回 null
export function parseAiSceneText(text: string): AiSceneSpec | null {
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
  const parsed = aiSceneSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// 提示词：只回 JSON；米制 y 向上、地面 y=0、position 是中心、scale 是尺寸、rotation 用度；组 2–6、元素 ≤ 40
export function buildAiScenePrompt(description: string, referenceImageCount: number): string {
  const types = DIRECTOR_PRIMITIVE_TYPES.join('|')
  return [
    'You are a 3D block-out planner for a film director console. Build the described scene from primitive shapes only.',
    'Reply with a single JSON object and nothing else: no prose, no Markdown fences.',
    'Coordinate system: metric meters, y up, z toward the audience, ground plane at y = 0. `position` is the element center, `scale` is the size on each axis in meters, `rotation` is in degrees.',
    `Schema: {"sceneName": string, "sceneConfig": {"skyColor": "#rrggbb", "groundOpacity": 0..1}, "groups": [{"name": string, "elements": [{"type": "${types}", "name": string, "position": [x,y,z], "rotation": [x,y,z], "scale": [x,y,z], "color": "#rrggbb", "roughness": 0..1, "metalness": 0..1, "opacity": 0..1}]}]}`,
    'Rules: 2 to 6 groups, at most 40 elements in total; objects rest on the ground (y = height / 2); realistic proportions; keep the main subject within 6 meters of the origin; use a coordinated low-saturation palette; name groups and elements in the same language as the description.',
    referenceImageCount > 0 ? `${referenceImageCount} reference image(s) are attached: follow their layout and palette.` : '',
    `Scene description: ${description.trim()}`,
  ]
    .filter(Boolean)
    .join('\n')
}

// 固定夹具：单测与开发入口（无文本模型时）复现同一布局——「街角咖啡馆」三组 12 件
export const AI_SCENE_FIXTURE: AiSceneSpec = {
  sceneName: '街角咖啡馆',
  sceneConfig: { skyColor: '#1f2937', groundOpacity: 0.35 },
  groups: [
    {
      name: '建筑组',
      elements: [
        { type: 'cube', name: '主楼', position: [0, 3, -6], scale: [10, 6, 6], color: '#9a8c7a', roughness: 0.9 },
        { type: 'cube', name: '雨棚', position: [0, 3.1, -2.6], rotation: [0, 0, 0], scale: [6, 0.2, 1.6], color: '#7c2d12' },
        { type: 'cube', name: '门', position: [0, 1.1, -3.05], scale: [1.2, 2.2, 0.1], color: '#3f3f46' },
        { type: 'cube', name: '橱窗', position: [3, 1.6, -3.05], scale: [3, 1.8, 0.1], color: '#93c5fd', opacity: 0.6 },
      ],
    },
    {
      name: '街道设施',
      elements: [
        { type: 'cylinder', name: '路灯杆', position: [-5, 2, 1], scale: [0.15, 4, 0.15], color: '#374151', metalness: 0.6 },
        { type: 'sphere', name: '路灯', position: [-5, 4.2, 1], scale: [0.5, 0.5, 0.5], color: '#fde68a' },
        { type: 'cube', name: '长椅', position: [4, 0.25, 1.5], scale: [1.8, 0.5, 0.6], color: '#78350f' },
        { type: 'cylinder', name: '垃圾桶', position: [6, 0.45, 1.5], scale: [0.5, 0.9, 0.5], color: '#4b5563' },
      ],
    },
    {
      name: '露天座位',
      elements: [
        { type: 'cylinder', name: '圆桌', position: [-1.5, 0.7, 0.5], scale: [0.9, 0.05, 0.9], color: '#d6d3d1' },
        { type: 'cylinder', name: '桌腿', position: [-1.5, 0.35, 0.5], scale: [0.08, 0.7, 0.08], color: '#6b7280' },
        { type: 'cube', name: '椅子 A', position: [-2.4, 0.45, 0.5], scale: [0.5, 0.9, 0.5], color: '#a16207' },
        { type: 'cube', name: '椅子 B', position: [-0.6, 0.45, 0.5], rotation: [0, 180, 0], scale: [0.5, 0.9, 0.5], color: '#a16207' },
      ],
    },
  ],
}
