/**
 * [INPUT]: 依赖 ./directorTypes 的 Vec3/DirectorCamera、./vec3 的 lookAtAngles/applyTransform、./cameraLens 的 syncFocalLength
 * [OUTPUT]: 对外提供 CAMERA_PRESETS（14 个机位预设，坐标在「主体局部空间」）、buildCameraFromPreset、CameraPresetId
 * [POS]: director/model 的机位预设单一真相（清单 §2.2 V4b）；创建栏与「Shift+A 从当前视角生成机位」都经 buildCameraFromPreset，
 *        有主体时把预设位置/注视点按主体变换（含缩放与 XYZ 旋转）变到世界，无主体按世界原点。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorCamera, Vec3 } from './directorTypes'
import { syncFocalLength } from './cameraLens'
import { applyTransform, lookAtAngles, type Transform } from './vec3'

export type CameraPresetId =
  | 'current'
  | 'front_medium'
  | 'front_closeup'
  | 'front_wide'
  | 'side_follow'
  | 'side_closeup'
  | 'back_medium'
  | 'high_wide'
  | 'high_40'
  | 'low_angle'
  | 'low_wide'
  | 'ots_left'
  | 'ots_right'
  | 'birds_eye'

export type CameraPreset = {
  id: CameraPresetId
  isCurrent?: boolean
  position?: Vec3
  lookAtCoords?: Vec3
  fov?: number
}

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { id: 'current', isCurrent: true },
  { id: 'front_medium', position: { x: 0, y: 1.1, z: 3.5 }, lookAtCoords: { x: 0, y: 1, z: 0 }, fov: 45 },
  { id: 'front_closeup', position: { x: 0, y: 1.6, z: 1.2 }, lookAtCoords: { x: 0, y: 1.6, z: 0 }, fov: 35 },
  { id: 'front_wide', position: { x: 0, y: 0.9, z: 6 }, lookAtCoords: { x: 0, y: 0.9, z: 0 }, fov: 50 },
  { id: 'side_follow', position: { x: 3.5, y: 1.1, z: 0 }, lookAtCoords: { x: 0, y: 1, z: 0 }, fov: 45 },
  { id: 'side_closeup', position: { x: 1.2, y: 1.6, z: 0 }, lookAtCoords: { x: 0, y: 1.6, z: 0 }, fov: 40 },
  { id: 'back_medium', position: { x: 0, y: 1.1, z: -3.5 }, lookAtCoords: { x: 0, y: 1, z: 0 }, fov: 45 },
  { id: 'high_wide', position: { x: 0, y: 5, z: 4 }, lookAtCoords: { x: 0, y: 0.5, z: 0 }, fov: 50 },
  { id: 'high_40', position: { x: 0, y: 3.5, z: 4.2 }, lookAtCoords: { x: 0, y: 0.5, z: 0 }, fov: 45 },
  { id: 'low_angle', position: { x: 0, y: 0.2, z: 3 }, lookAtCoords: { x: 0, y: 1.2, z: 0 }, fov: 45 },
  { id: 'low_wide', position: { x: 0, y: 0.2, z: 2.5 }, lookAtCoords: { x: 0, y: 1.2, z: 0 }, fov: 24 },
  { id: 'ots_left', position: { x: -0.6, y: 1.6, z: -1.2 }, lookAtCoords: { x: 0.2, y: 1.5, z: 2 }, fov: 45 },
  { id: 'ots_right', position: { x: 0.6, y: 1.6, z: -1.2 }, lookAtCoords: { x: -0.2, y: 1.5, z: 2 }, fov: 45 },
  { id: 'birds_eye', position: { x: 0, y: 8, z: 0.1 }, lookAtCoords: { x: 0, y: 0, z: 0 }, fov: 60 },
]

export type CurrentViewPose = { position: Vec3; yaw: number; pitch: number; roll: number; fov: number }

export type BuildCameraFromPresetOptions = {
  preset: CameraPreset
  id: string
  name: string
  // 主体（选中角色/物体）的世界变换；缺省 = 世界原点
  subject?: Transform | null
  // 「当前视角」预设用：自由相机的当前位姿；缺省退化为 (0,1.6,4.5) 看 (0,1,0)
  currentView?: CurrentViewPose | null
}

const FALLBACK_POSITION: Vec3 = { x: 0, y: 1.5, z: 3 }
const FALLBACK_LOOK_AT: Vec3 = { x: 0, y: 1, z: 0 }

export function buildCameraFromPreset(options: BuildCameraFromPresetOptions): DirectorCamera {
  const { preset, id, name, subject, currentView } = options
  if (preset.isCurrent) {
    const view = currentView ?? {
      position: { x: 0, y: 1.6, z: 4.5 },
      ...lookAtAngles({ x: 0, y: 1.6, z: 4.5 }, { x: 0, y: 1, z: 0 }),
      fov: 50,
    }
    return syncFocalLength({
      id,
      name,
      position: { ...view.position },
      yaw: view.yaw,
      pitch: view.pitch,
      roll: view.roll,
      fov: Math.round(view.fov),
      focalLengthMm: 0,
      showRayHelper: true,
    })
  }
  const localPosition = preset.position ?? FALLBACK_POSITION
  const localLookAt = preset.lookAtCoords ?? FALLBACK_LOOK_AT
  const position = subject ? applyTransform(localPosition, subject) : { ...localPosition }
  const lookAt = subject ? applyTransform(localLookAt, subject) : { ...localLookAt }
  const angles = lookAtAngles(position, lookAt)
  return syncFocalLength({
    id,
    name,
    position,
    yaw: angles.yaw,
    pitch: angles.pitch,
    roll: angles.roll,
    fov: preset.fov ?? 50,
    focalLengthMm: 0,
    // 预设只给位姿，不挂看向（否则 cameraRigSystem 每帧把朝向拽回坐标，用户转不动机位）
    showRayHelper: true,
  })
}
