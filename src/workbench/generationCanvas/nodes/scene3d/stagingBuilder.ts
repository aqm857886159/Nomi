// 站位 builder：语义 spec（人话词汇）→ Scene3DState。纯函数，配单测 stagingBuilder.test.ts。
// 复用预设 pose（已校准）+ 默认 scale/颜色 + cameraLookAtRotation。见 docs/plan/2026-06-21-staging-reference-tool.md。
import { createDefaultScene3DState, createScene3DObjectId, createScene3DCameraId } from './scene3dSerializer'
import { cameraLookAtRotation } from './scene3dMath'
import {
  MANNEQUIN_DEFAULT_SCALE,
  MANNEQUIN_POSE_PRESETS,
  ROLE_COLOR_SEQUENCE,
} from './scene3dConstants'
import type { Scene3DState, Scene3DObject, Scene3DCamera, Scene3DVector3 } from './scene3dTypes'
import {
  CAMERA_ANGLE_AZIMUTH_DEG,
  CAMERA_HEIGHT_POSE,
  SHOT_FRAMING,
  SHOT_SPACING_SCALE,
  LAYOUT_CAMERA_DEFAULT,
  ENV_PRESET,
  STAGING_CHARACTER_SPACING,
  type StagingLayout,
  type StagingFacing,
  type StagingCameraAngle,
  type StagingCameraHeight,
  type StagingShot,
  type StagingEnvironment,
} from './stagingVocab'

export type StagingCharacterSpec = {
  name?: string
  pose?: string
  facing?: StagingFacing
}

export type StagingSpec = {
  characters: StagingCharacterSpec[]
  layout?: StagingLayout
  camera?: { angle?: StagingCameraAngle; height?: StagingCameraHeight; shot?: StagingShot }
  environment?: StagingEnvironment
  crowd?: { rows: number; columns: number } | null
}

const DEG = Math.PI / 180
const FEET_Y = MANNEQUIN_DEFAULT_SCALE[1] * 0.5
const FACING_DEG: Record<StagingFacing, number | null> = { camera: 0, away: 180, left: 90, right: -90, toward: null }

type Placed = { x: number; z: number; faceDeg: number }

// 每个 layout 的站位坐标 + 默认朝向（toward = 朝同伴/圆心）。spacing 由景别缩放传入。
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
    case 'line': // 纵队：沿 Z 一前一后，朝镜头
      return Array.from({ length: count }, (_, i) => ({ x: 0, z: (i - (count - 1) / 2) * s, faceDeg: 0 }))
    case 'behind': // 一前一后（默认 2 人，多于 2 退化为纵队）
      return Array.from({ length: count }, (_, i) => ({ x: 0, z: ((count - 1) / 2 - i) * (s * 1.2), faceDeg: 0 }))
    case 'circle':
      return placeCircle(count, s)
    case 'side-by-side':
    case 'solo':
    default:
      return Array.from({ length: count }, (_, i) => ({ x: (i - (count - 1) / 2) * s, z: 0, faceDeg: 0 }))
  }
}

function placeCircle(count: number, s: number): Placed[] {
  const radius = Math.max(1.2, (s * count) / (2 * Math.PI))
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2
    const x = Math.sin(a) * radius
    const z = Math.cos(a) * radius
    // 朝圆心：默认 +Z 朝向旋到指向圆心 (-x,-z)
    const faceDeg = (Math.atan2(-x, -z) * 180) / Math.PI
    return { x, z, faceDeg }
  })
}

// point 手臂在身体坐标系指向 -X 侧（azimuth -90°，相对面向 +Z）——实测自顶视。
// 要「A 指向 B」，让 A 的 -X 侧朝 B：faceDeg = 目标方位角 + 90°。
const POINT_ARM_BODY_AZIMUTH_DEG = -90

function buildCharacterObjects(spec: StagingSpec, layout: StagingLayout, spacingScale = 1): Scene3DObject[] {
  const shot: StagingShot = spec.camera?.shot ?? 'medium'
  const spacing = STAGING_CHARACTER_SPACING * SHOT_SPACING_SCALE[shot] * spacingScale
  const placed = placeCharacters(spec.characters.length, layout, spacing)
  return spec.characters.map((character, index) => {
    const place = placed[index] ?? { x: 0, z: 0, faceDeg: 0 }
    const facingOverride = character.facing ? FACING_DEG[character.facing] : null
    // 指向类姿势且没指定朝向、且有其他角色 → 自动转身让手臂瞄准最近的人（指着某人）。
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
      id: createScene3DObjectId(),
      name: character.name?.trim() || `角色${String.fromCharCode(65 + index)}`,
      type: 'mannequin',
      visible: true,
      position: [place.x, FEET_Y, place.z] as Scene3DVector3,
      rotation: [0, faceDeg * DEG, 0] as Scene3DVector3,
      scale: [...MANNEQUIN_DEFAULT_SCALE] as Scene3DVector3,
      color: ROLE_COLOR_SEQUENCE[index % ROLE_COLOR_SEQUENCE.length],
      pose: preset?.pose,
    }
  })
}

function buildCrowdObject(spec: StagingSpec, centerX: number, backZ: number): Scene3DObject | null {
  if (!spec.crowd) return null
  const rows = Math.max(1, Math.min(10, Math.round(spec.crowd.rows)))
  const columns = Math.max(1, Math.min(10, Math.round(spec.crowd.columns)))
  return {
    id: createScene3DObjectId(),
    name: '群众',
    type: 'mannequinCrowd',
    visible: true,
    position: [centerX, FEET_Y, backZ - 3] as Scene3DVector3,
    rotation: [0, 0, 0],
    scale: [...MANNEQUIN_DEFAULT_SCALE] as Scene3DVector3,
    color: ROLE_COLOR_SEQUENCE[3],
    crowdRows: rows,
    crowdColumns: columns,
    crowdSpacing: 0.4,
  }
}

function buildStagingCamera(objects: Scene3DObject[], camera: StagingSpec['camera'], layout: StagingLayout): Scene3DCamera {
  // agent 没指定 angle/height 时按 layout 取「能读出空间关系」的默认机位（环绕→俯、纵队→侧…）。
  const layoutDefault = LAYOUT_CAMERA_DEFAULT[layout]
  const angle: StagingCameraAngle = camera?.angle ?? layoutDefault.angle ?? 'three-quarter'
  const height: StagingCameraHeight = camera?.height ?? layoutDefault.height ?? 'eye'
  const shot: StagingShot = camera?.shot ?? 'medium'
  const xs = objects.map((o) => o.position[0])
  const zs = objects.map((o) => o.position[2])
  const centerX = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0
  const centerZ = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0
  const radius = xs.length
    ? Math.max(
        ...objects.map((o) => Math.hypot(o.position[0] - centerX, o.position[2] - centerZ)),
      ) + 1
    : 1
  const az = CAMERA_ANGLE_AZIMUTH_DEG[angle] * DEG
  const framing = SHOT_FRAMING[shot]
  const heightPose = CAMERA_HEIGHT_POSE[height]
  const dh = (framing.distance + radius) * heightPose.distanceScale
  const position: Scene3DVector3 = [centerX + Math.sin(az) * dh, heightPose.camY, centerZ + Math.cos(az) * dh]
  const target: Scene3DVector3 = [centerX, heightPose.targetY, centerZ]
  return {
    id: createScene3DCameraId(),
    name: '机位',
    visible: true,
    position,
    rotation: cameraLookAtRotation(position, target),
    target,
    fov: framing.fov,
    aspectRatio: '16:9',
    lensDepth: 0,
    near: 0.1,
    far: 200,
  }
}

export function buildStagingScene(spec: StagingSpec, spacingScale = 1): Scene3DState {
  const base = createDefaultScene3DState()
  const layout: StagingLayout = spec.layout ?? (spec.characters.length > 1 ? 'side-by-side' : 'solo')
  const objects = buildCharacterObjects(spec, layout, spacingScale)
  const centerX = objects.reduce((sum, o) => sum + o.position[0], 0) / Math.max(1, objects.length)
  const backZ = Math.min(...objects.map((o) => o.position[2]), 0)
  const crowd = buildCrowdObject(spec, centerX, backZ)
  const allObjects = crowd ? [...objects, crowd] : objects
  const camera = buildStagingCamera(objects, spec.camera, layout)
  const env = ENV_PRESET[spec.environment ?? 'studio']
  return {
    ...base,
    objects: allObjects,
    cameras: [camera],
    environment: {
      ...base.environment,
      backgroundColor: env.backgroundColor,
      showSky: env.showSky,
      darkMode: env.darkMode,
      showGrid: false,
      showAxes: false,
    },
    editorCamera: {
      position: camera.position,
      target: camera.target ?? [0, 1.2, 0],
      rotation: camera.rotation,
      mode: 'edit',
    },
  }
}

// ── 运行时自检（F3）：零额度几何守卫，治 agent 生成站位图时的两类「人物问题」————
// ① 非法/近似姿势 id（如 agent 传 'kneel' 而词表是 'single-knee'）此前静默落成站立、无报错；
// ② 角色过近互相穿插。两者都能从纯数据免费查出并修，不花任何 API（区别于 VLM 形状判）。

const KNOWN_POSE_IDS = new Set(MANNEQUIN_POSE_PRESETS.map((p) => p.id))
// agent 常见说法 → 词表 id（治静默落标准化）。
const POSE_ALIASES: Record<string, string> = {
  kneel: 'single-knee', kneeling: 'single-knee', 'one-knee': 'single-knee', propose: 'single-knee', proposal: 'single-knee',
  'both-knees': 'double-knee', 'two-knees': 'double-knee',
  sitting: 'sit', seated: 'sit',
  crouch: 'squat', crouching: 'squat', squatting: 'squat',
  stand: 'standing', idle: 'standing',
  walking: 'walk', running: 'run', sprint: 'run',
  pointing: 'point', waving: 'wave', 'raise-hand': 'wave', cheering: 'cheer', celebrate: 'cheer',
  akimbo: 'hands-on-hips', 'hand-on-hip': 'hands-on-hips', 'hands-on-hip': 'hands-on-hips',
  tpose: 't-pose', t: 't-pose',
}

function normalizePoseToken(raw: string): string {
  return raw.toLowerCase().trim().replace(/[_\s]+/g, '-')
}

/** 把任意 pose 串解析成有效词表 id。返回 {id?} + 可选 note（被纠正/无法识别时）。无 pose=站立=合法。 */
export function resolveStagingPose(raw?: string): { id?: string; note?: string } {
  if (!raw || !raw.trim()) return {}
  const norm = normalizePoseToken(raw)
  if (KNOWN_POSE_IDS.has(norm)) return { id: norm }
  const alias = POSE_ALIASES[norm]
  if (alias) return { id: alias, note: `「${raw}」非词表姿势，已按最接近的「${alias}」处理` }
  // 模糊只接受「输入是某词表 id 的片段」(如 knee→single-knee、hip→hands-on-hips),且片段够长;
  // 不做反向(norm 含 id)以免短 id 命中无关长词(moonwalk 含 walk)误纠。别名表兜「长说法→id」。
  const fuzzy = norm.length >= 3 ? [...KNOWN_POSE_IDS].find((id) => id.includes(norm)) : undefined
  if (fuzzy) return { id: fuzzy, note: `「${raw}」非词表姿势，已按最接近的「${fuzzy}」处理` }
  return { note: `「${raw}」不是有效姿势，已渲染为站立（有效：${[...KNOWN_POSE_IDS].join('/')}）` }
}

/** 解析 spec 内所有角色姿势 id → 修正后的 spec + 问题清单（纯函数,可单测）。 */
export function auditStagingSpec(spec: StagingSpec): { spec: StagingSpec; issues: string[] } {
  const issues: string[] = []
  const characters = spec.characters.map((c) => {
    const r = resolveStagingPose(c.pose)
    if (r.note) issues.push(r.note)
    return { ...c, pose: r.id }
  })
  return { spec: { ...spec, characters }, issues }
}

const MIN_CHARACTER_CENTER_SEP = 1.0 // 角色脚下中心间距下限（假人占地约 0.75 宽,留余量）。

function stagingHasOverlap(state: Scene3DState): boolean {
  const men = state.objects.filter((o) => o.type === 'mannequin')
  for (let a = 0; a < men.length; a += 1) {
    for (let b = a + 1; b < men.length; b += 1) {
      const d = Math.hypot(men[a].position[0] - men[b].position[0], men[a].position[2] - men[b].position[2])
      if (d < MIN_CHARACTER_CENTER_SEP) return true
    }
  }
  return false
}

/** 生产站位入口（带运行时自检）：修正姿势 id + 角色过近自动拉开间距。返回最终场景 + 问题清单（追加给用户提示）。 */
export function buildStagingSceneAudited(spec: StagingSpec): { state: Scene3DState; issues: string[] } {
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
