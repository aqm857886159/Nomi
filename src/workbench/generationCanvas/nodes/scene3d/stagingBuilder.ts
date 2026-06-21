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

function buildCharacterObjects(spec: StagingSpec, layout: StagingLayout): Scene3DObject[] {
  const shot: StagingShot = spec.camera?.shot ?? 'medium'
  const spacing = STAGING_CHARACTER_SPACING * SHOT_SPACING_SCALE[shot]
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

export function buildStagingScene(spec: StagingSpec): Scene3DState {
  const base = createDefaultScene3DState()
  const layout: StagingLayout = spec.layout ?? (spec.characters.length > 1 ? 'side-by-side' : 'solo')
  const objects = buildCharacterObjects(spec, layout)
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
