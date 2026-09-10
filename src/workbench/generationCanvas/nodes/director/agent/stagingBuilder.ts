/**
 * [INPUT]: 依赖 ../model/posePresets 的 MANNEQUIN_POSE_PRESETS、./stagingVocab（词表）、../migration/legacyScene3dTypes（LegacyScene3DState / LegacyObject / LegacyCamera / LegacyVec3）、
 *          ../migration/legacySceneBuilders（createLegacyState / id 工厂 / legacyCameraLookAtRotation / buildPlacedProps / buildSceneTemplateObjects）
 * [OUTPUT]: 对外提供 StagingSpec / StagingCharacterSpec、buildStagingScene、resolveStagingPose、auditStagingSpec、buildStagingSceneAudited
 * [POS]: director/agent 的站位 builder（原 V1 stagingBuilder，切换门入籍）：语义 spec（人话词汇）→ V1 形状场景（假人 / 群众 / 道具 / 模板 / 机位 / 环境），
 *        由 createStagingReferenceNode 经迁移器落成 director 工程。运行时自检：修正非法 / 近似姿势 id、角色过近自动拉开间距（零额度几何守卫）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { MANNEQUIN_POSE_PRESETS } from '../model/posePresets'
import type { LegacyCamera, LegacyObject, LegacyScene3DState, LegacyVec3 } from '../migration/legacyScene3dTypes'
import { LEGACY_MANNEQUIN_SCALE } from '../migration/legacyScene3dTypes'
import {
  buildPlacedProps, buildSceneTemplateObjects, createLegacyCameraId, createLegacyObjectId, createLegacyState, legacyCameraLookAtRotation,
  type LegacySceneTemplate, type ScenePropPlacement,
} from '../migration/legacySceneBuilders'
import {
  CAMERA_ANGLE_AZIMUTH_DEG, CAMERA_HEIGHT_POSE, ENV_PRESET, LAYOUT_CAMERA_DEFAULT, SHOT_FRAMING, SHOT_SPACING_SCALE, STAGING_CHARACTER_SPACING,
  type StagingCameraAngle, type StagingCameraHeight, type StagingEnvironment, type StagingFacing, type StagingLayout, type StagingShot,
} from './stagingVocab'

export type StagingCharacterSpec = { name?: string; pose?: string; facing?: StagingFacing }

export type StagingSpec = {
  characters: StagingCharacterSpec[]
  layout?: StagingLayout
  camera?: { angle?: StagingCameraAngle; height?: StagingCameraHeight; shot?: StagingShot }
  environment?: StagingEnvironment
  crowd?: { rows: number; columns: number } | null
  sceneTemplate?: LegacySceneTemplate
  props?: ScenePropPlacement[]
}

const DEG = Math.PI / 180
const MANNEQUIN_SCALE: LegacyVec3 = [LEGACY_MANNEQUIN_SCALE, LEGACY_MANNEQUIN_SCALE, LEGACY_MANNEQUIN_SCALE]
const FEET_Y = LEGACY_MANNEQUIN_SCALE * 0.5
const ROLE_COLORS = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#f97316', '#a855f7', '#06b6d4', '#ec4899'] as const
const FACING_DEG: Record<StagingFacing, number | null> = { camera: 0, away: 180, left: 90, right: -90, toward: null }

type Placed = { x: number; z: number; faceDeg: number }

function placeCircle(count: number, s: number): Placed[] {
  const radius = Math.max(1.2, (s * count) / (2 * Math.PI))
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2
    const x = Math.sin(a) * radius
    const z = Math.cos(a) * radius
    return { x, z, faceDeg: (Math.atan2(-x, -z) * 180) / Math.PI }
  })
}

// 每个 layout 的站位坐标 + 默认朝向（toward = 朝同伴/圆心）。spacing 由景别缩放传入
function placeCharacters(count: number, layout: StagingLayout, s: number): Placed[] {
  if (count <= 1) return [{ x: 0, z: 0, faceDeg: 0 }]
  switch (layout) {
    case 'facing': {
      if (count === 2) {
        const d = s * 0.9
        return [{ x: -d, z: 0, faceDeg: 90 }, { x: d, z: 0, faceDeg: -90 }]
      }
      return placeCircle(count, s)
    }
    case 'line':
      return Array.from({ length: count }, (_, i) => ({ x: 0, z: (i - (count - 1) / 2) * s, faceDeg: 0 }))
    case 'behind':
      return Array.from({ length: count }, (_, i) => ({ x: 0, z: ((count - 1) / 2 - i) * (s * 1.2), faceDeg: 0 }))
    case 'circle':
      return placeCircle(count, s)
    case 'side-by-side':
    case 'solo':
    default:
      return Array.from({ length: count }, (_, i) => ({ x: (i - (count - 1) / 2) * s, z: 0, faceDeg: 0 }))
  }
}

// point 手臂在身体坐标系指向 -X 侧（azimuth -90°，相对面向 +Z）；要「A 指向 B」，让 A 的 -X 侧朝 B
const POINT_ARM_BODY_AZIMUTH_DEG = -90

function buildCharacterObjects(spec: StagingSpec, layout: StagingLayout, spacingScale = 1): LegacyObject[] {
  const shot: StagingShot = spec.camera?.shot ?? 'medium'
  const spacing = STAGING_CHARACTER_SPACING * SHOT_SPACING_SCALE[shot] * spacingScale
  const placed = placeCharacters(spec.characters.length, layout, spacing)
  return spec.characters.map((character, index) => {
    const place = placed[index] ?? { x: 0, z: 0, faceDeg: 0 }
    const facingOverride = character.facing ? FACING_DEG[character.facing] : null
    let aimDeg: number | null = null
    if (character.pose === 'point' && facingOverride === null && placed.length > 1) {
      let nearestX = 0
      let nearestZ = 0
      let best = Infinity
      for (let i = 0; i < placed.length; i += 1) {
        if (i === index) continue
        const d = Math.hypot(placed[i].x - place.x, placed[i].z - place.z)
        if (d < best) { best = d; nearestX = placed[i].x; nearestZ = placed[i].z }
      }
      if (best < Infinity) aimDeg = (Math.atan2(nearestX - place.x, nearestZ - place.z) * 180) / Math.PI - POINT_ARM_BODY_AZIMUTH_DEG
    }
    const faceDeg = facingOverride ?? aimDeg ?? place.faceDeg
    const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === character.pose)
    return {
      id: createLegacyObjectId(),
      name: character.name?.trim() || `角色${String.fromCharCode(65 + index)}`,
      type: 'mannequin',
      visible: true,
      position: [place.x, FEET_Y, place.z] as LegacyVec3,
      rotation: [0, faceDeg * DEG, 0] as LegacyVec3,
      scale: [...MANNEQUIN_SCALE] as LegacyVec3,
      color: ROLE_COLORS[index % ROLE_COLORS.length],
      pose: preset?.pose,
    }
  })
}

function buildCrowdObject(spec: StagingSpec, centerX: number, backZ: number): LegacyObject | null {
  if (!spec.crowd) return null
  const rows = Math.max(1, Math.min(10, Math.round(spec.crowd.rows)))
  const columns = Math.max(1, Math.min(10, Math.round(spec.crowd.columns)))
  return {
    id: createLegacyObjectId(), name: '群众', type: 'mannequinCrowd', visible: true,
    position: [centerX, FEET_Y, backZ - 3], rotation: [0, 0, 0], scale: [...MANNEQUIN_SCALE] as LegacyVec3,
    color: ROLE_COLORS[3], crowdRows: rows, crowdColumns: columns, crowdSpacing: 0.4,
  }
}

function buildStagingCamera(objects: LegacyObject[], camera: StagingSpec['camera'], layout: StagingLayout): LegacyCamera {
  const layoutDefault = LAYOUT_CAMERA_DEFAULT[layout]
  const angle: StagingCameraAngle = camera?.angle ?? layoutDefault.angle ?? 'three-quarter'
  const height: StagingCameraHeight = camera?.height ?? layoutDefault.height ?? 'eye'
  const shot: StagingShot = camera?.shot ?? 'medium'
  const xs = objects.map((o) => o.position[0])
  const zs = objects.map((o) => o.position[2])
  const centerX = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0
  const centerZ = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0
  const radius = xs.length ? Math.max(...objects.map((o) => Math.hypot(o.position[0] - centerX, o.position[2] - centerZ))) + 1 : 1
  const az = CAMERA_ANGLE_AZIMUTH_DEG[angle] * DEG
  const framing = SHOT_FRAMING[shot]
  const heightPose = CAMERA_HEIGHT_POSE[height]
  const dh = (framing.distance + radius) * heightPose.distanceScale
  const position: LegacyVec3 = [centerX + Math.sin(az) * dh, heightPose.camY, centerZ + Math.cos(az) * dh]
  const target: LegacyVec3 = [centerX, heightPose.targetY, centerZ]
  return { id: createLegacyCameraId(), name: '机位', visible: true, position, rotation: legacyCameraLookAtRotation(position, target), target, fov: framing.fov, aspectRatio: '16:9', lensDepth: 0 }
}

export function buildStagingScene(spec: StagingSpec, spacingScale = 1): LegacyScene3DState {
  const base = createLegacyState()
  const layout: StagingLayout = spec.layout ?? (spec.characters.length > 1 ? 'side-by-side' : 'solo')
  const objects = buildCharacterObjects(spec, layout, spacingScale)
  const centerX = objects.reduce((sum, o) => sum + o.position[0], 0) / Math.max(1, objects.length)
  const backZ = Math.min(...objects.map((o) => o.position[2]), 0)
  const crowd = buildCrowdObject(spec, centerX, backZ)
  // 灰模布景铺在最前，角色 / 群众叠其上；相机取景只看角色位置
  const templateObjects = spec.sceneTemplate ? buildSceneTemplateObjects(spec.sceneTemplate) : []
  const propObjects = buildPlacedProps(spec.props)
  const camera = buildStagingCamera(objects, spec.camera, layout)
  const env = ENV_PRESET[spec.environment ?? 'studio']
  return {
    ...base,
    objects: [...templateObjects, ...propObjects, ...objects, ...(crowd ? [crowd] : [])],
    cameras: [camera],
    environment: { ...base.environment, backgroundColor: env.backgroundColor, showGrid: false },
  }
}

// ── 运行时自检：零额度几何守卫（非法 / 近似姿势 id、角色过近互相穿插）──
const KNOWN_POSE_IDS = new Set(MANNEQUIN_POSE_PRESETS.map((p) => p.id))
const POSE_ALIASES: Record<string, string> = {
  kneel: 'single-knee', kneeling: 'single-knee', 'one-knee': 'single-knee', propose: 'single-knee', proposal: 'single-knee',
  'both-knees': 'double-knee', 'two-knees': 'double-knee',
  sitting: 'sit', seated: 'sit',
  crouching: 'crouch', squatting: 'squat',
  stand: 'standing', idle: 'standing',
  walking: 'walk', running: 'run', sprint: 'run',
  pointing: 'point', waving: 'wave', 'raise-hand': 'wave', cheering: 'cheer', celebrate: 'cheer',
  akimbo: 'hands-on-hips', 'hand-on-hip': 'hands-on-hips', 'hands-on-hip': 'hands-on-hips',
  tpose: 't-pose', t: 't-pose',
}

function normalizePoseToken(raw: string): string {
  return raw.toLowerCase().trim().replace(/[_\s]+/g, '-')
}

/** 把任意 pose 串解析成有效词表 id。返回 {id?} + 可选 note（被纠正 / 无法识别时）。无 pose = 站立 = 合法 */
export function resolveStagingPose(raw?: string): { id?: string; note?: string } {
  if (!raw || !raw.trim()) return {}
  const norm = normalizePoseToken(raw)
  if (KNOWN_POSE_IDS.has(norm)) return { id: norm }
  const alias = POSE_ALIASES[norm]
  if (alias) return { id: alias, note: `「${raw}」非词表姿势，已按最接近的「${alias}」处理` }
  const fuzzy = norm.length >= 3 ? [...KNOWN_POSE_IDS].find((id) => id.includes(norm)) : undefined
  if (fuzzy) return { id: fuzzy, note: `「${raw}」非词表姿势，已按最接近的「${fuzzy}」处理` }
  return { note: `「${raw}」不是有效姿势，已渲染为站立（有效：${[...KNOWN_POSE_IDS].join('/')}）` }
}

export function auditStagingSpec(spec: StagingSpec): { spec: StagingSpec; issues: string[] } {
  const issues: string[] = []
  const characters = spec.characters.map((c) => {
    const r = resolveStagingPose(c.pose)
    if (r.note) issues.push(r.note)
    return { ...c, pose: r.id }
  })
  return { spec: { ...spec, characters }, issues }
}

const MIN_CHARACTER_CENTER_SEP = 1.0

function stagingHasOverlap(state: LegacyScene3DState): boolean {
  const men = state.objects.filter((o) => o.type === 'mannequin')
  for (let a = 0; a < men.length; a += 1) {
    for (let b = a + 1; b < men.length; b += 1) {
      if (Math.hypot(men[a].position[0] - men[b].position[0], men[a].position[2] - men[b].position[2]) < MIN_CHARACTER_CENTER_SEP) return true
    }
  }
  return false
}

/** 生产站位入口（带运行时自检）：修正姿势 id + 角色过近自动拉开间距。返回最终场景 + 问题清单 */
export function buildStagingSceneAudited(spec: StagingSpec): { state: LegacyScene3DState; issues: string[] } {
  const audit = auditStagingSpec(spec)
  let state = buildStagingScene(audit.spec, 1)
  const scales = [1.4, 1.9, 2.5]
  let widened = false
  for (let i = 0; i < scales.length && stagingHasOverlap(state); i += 1) {
    state = buildStagingScene(audit.spec, scales[i])
    widened = true
  }
  const issues = [...audit.issues]
  if (stagingHasOverlap(state)) issues.push('角色仍偏近（已尽力拉开间距，建议改用更宽的景别/布局）')
  else if (widened) issues.push('角色过近，已自动拉开站位间距')
  return { state, issues }
}
