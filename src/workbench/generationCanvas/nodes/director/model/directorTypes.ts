/**
 * [INPUT]: 无依赖（纯类型层，零 React / 零 THREE）
 * [OUTPUT]: 对外提供导演台 V2 工程 schema：DirectorProject / DirectorScene / DirectorObject / DirectorCamera /
 *           DirectorLight / Waypoint / TrajectoryClip / ActionClip / BoneKeyframe / LookAtClip / CloseupClip 与字面量联合
 * [POS]: director/model 的类型基座；所有纯层（timeGrid / clips / editLayer / closeupRig …）与渲染层都只认这里的形状。
 *        字段即导演台工程 JSON v2 的持久化形状，便于按清单逐项实现；与 V1 scene3dTypes 无关系（切换门时由 directorProject.migrateFromScene3D 桥接）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ── 基础 ──
export type Vec3 = { x: number; y: number; z: number }

export const DIRECTOR_PROJECT_VERSION = 2 as const

// 导出画幅与分辨率（清单 §2.3 底部栏「画幅比例设置」）
export const DIRECTOR_EXPORT_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3', '21:9', 'free'] as const
export type DirectorExportRatio = (typeof DIRECTOR_EXPORT_RATIOS)[number]
export const DIRECTOR_EXPORT_RESOLUTIONS = ['1080', '1440', '4k'] as const
export type DirectorExportResolution = (typeof DIRECTOR_EXPORT_RESOLUTIONS)[number]

// ── 实体 ──
export const DIRECTOR_PRIMITIVE_TYPES = [
  'cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'tetrahedron', 'icosahedron',
] as const
export type DirectorPrimitiveType = (typeof DIRECTOR_PRIMITIVE_TYPES)[number]
export type DirectorObjectType = 'character' | 'model' | 'group' | 'splat' | DirectorPrimitiveType

export type DirectorRig = 'mixamo' | 'ue4'
export type DirectorModelDisplayMode = 'solid' | 'translucent' | 'clay'

export type Waypoint = {
  id: string
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  roll: number
  time: number
  frameIndex: number
  clipId?: string
  progress?: number
  // 单路标看向下拉的选择记录；角度在选择时烘焙，不是播放期动态跟踪。
  lookAtObjectId?: string
  // 机位专用：竖直 FOV（度）随路标插值（变焦推拉 / 希区柯克）；缺省 = 机位静态 fov
  fov?: number
}

export type TrajectoryClip = {
  id: string
  startTime: number
  endTime: number
  startFrame: number
  endFrame: number
}

export type BoneKeyframe = {
  id: string
  time: number
  frame: number
  boneRotations: Record<string, Vec3>
  hipsOffset?: Vec3
}

export type ActionClipType = 'action' | 'custom_pose'

export type ActionClip = {
  id: string
  name: string
  clipType: ActionClipType
  actionPose?: string
  startTime: number
  endTime: number
  startFrame: number
  endFrame: number
  keyframes?: BoneKeyframe[]
}

export type LookAtTargetType = 'none' | 'camera' | 'object' | 'custom'
export type LookAtBodyPart = 'eye' | 'face' | 'chest' | 'body' | 'pelvis' | 'foot' | 'custom'

export type LookAtClip = {
  id: string
  name: string
  targetType: LookAtTargetType
  targetId: string
  enablePitch: boolean
  targetHeightOffset: number
  targetBodyPart: LookAtBodyPart
  startTime: number
  endTime: number
  startFrame: number
  endFrame: number
  blendInDuration: number
  blendOutDuration: number
  weight: number
  clampingAngle: number
}

export type CloseupAnchor = 'eye' | 'face' | 'chest' | 'body' | 'pelvis' | 'foot' | 'custom'
export type CloseupFacingMode = 'look_at_target' | 'follow_subject_yaw' | 'world_locked' | 'manual'
export type CloseupAzimuth = 'front' | 'front_left' | 'front_right' | 'left' | 'right' | 'back' | 'custom'
export const CLOSEUP_MOTION_PRESETS = [
  'static', 'orbit', 'half_arc', 'push_in', 'pull_out', 'crane', 'truck', 'spiral',
] as const
export type CloseupMotionPreset = (typeof CLOSEUP_MOTION_PRESETS)[number]

export type CloseupClip = {
  id: string
  entityId: string
  targetObjectId: string
  startTime: number
  endTime: number
  startFrame: number
  endFrame: number
  anchor: CloseupAnchor
  customAnchor?: Vec3
  facingMode: CloseupFacingMode
  azimuth: CloseupAzimuth
  customAzimuthDeg?: number
  horizontalAngle: number
  pitchAngle: number
  distance: number
  height: number
  motionPreset: CloseupMotionPreset
}

// 空间实体共有的「时间轴身份」：有轨迹片段即进时间轴
export type TimelineEntityFields = {
  motionTrajectory?: Waypoint[]
  trajectoryClips?: TrajectoryClip[]
  inTimeline?: boolean
}

export type DirectorObject = TimelineEntityFields & {
  id: string
  name: string
  type: DirectorObjectType
  position: Vec3
  rotation: Vec3
  scale: Vec3
  parentId?: string
  color?: string
  roughness?: number
  metalness?: number
  opacity?: number
  wireframe?: boolean
  flatShading?: boolean
  visible: boolean
  locked: boolean
  isAuxiliary?: boolean
  modelPath?: string
  modelScale?: number
  isSystemModel?: boolean
  rig?: DirectorRig
  posePreset?: string
  boneRotations?: Record<string, Vec3>
  hipsOffset?: Vec3
  bodyType?: string
  actionClips?: ActionClip[]
  actionTrackEnabled?: boolean
  lookAtClips?: LookAtClip[]
  lookAtTrackEnabled?: boolean
}

export type CameraLookAtType = 'none' | 'object' | 'coordinates'
export type CameraRigType = 'none' | 'follow' | 'track_aim'

export type DirectorCamera = TimelineEntityFields & {
  id: string
  name: string
  position: Vec3
  yaw: number
  pitch: number
  roll: number
  // fov 是唯一真相（对齐 2026-07-03 拍板）；focalLengthMm 是派生缓存，由 cameraLens.syncFocalLength 维护
  fov: number
  focalLengthMm: number
  lookAtType?: CameraLookAtType
  lookAtObjectId?: string
  lookAtCoords?: Vec3
  rigType?: CameraRigType
  showRayHelper?: boolean
  closeupClips?: CloseupClip[]
}

export type DirectorLightType = 'directional' | 'point' | 'spot'

export type DirectorLight = {
  id: string
  name: string
  type: DirectorLightType
  color: string
  intensity: number
  position: Vec3
  yaw: number
  pitch: number
  enabled: boolean
  visible: boolean
  locked: boolean
  castShadow: boolean
  spotAngle?: number
  spotPenumbra?: number
  distance: number
  decay: number
}

// ── 场景（图层）与工程 ──
export type DirectorSceneConfig = {
  scale: number
  position: Vec3
  rotation: Vec3
  skyColor: string
  gridSnapEnabled: boolean
  gridVisible: boolean
  gridHeight: number
  groundOpacity: number
  showSkeleton: boolean
  showCharacterLabels: boolean
  showRuleOfThirds: boolean
  modelDisplayMode: DirectorModelDisplayMode
}

export type DirectorPanoramaConfig = { url: string; radius: number; rotationY: number }

export type DirectorScene = {
  id: string
  name: string
  visible: boolean
  sceneConfig: DirectorSceneConfig
  panoramaConfig: DirectorPanoramaConfig
  objects: DirectorObject[]
  cameras: DirectorCamera[]
  lights: DirectorLight[]
  timelineTrackOrder: string[]
  timelineTrackPins: string[]
  timelineTrackFolds: string[]
}

// 资产库（清单 §3.2 S2/S3）：用户上传只存资产句柄（nomi-local:// 等，禁 base64），文件夹树扁平存 parentId
export type DirectorAssetKind = 'model' | 'splat' | 'panorama' | 'scene'
export const DIRECTOR_ASSET_KINDS: readonly DirectorAssetKind[] = ['model', 'splat', 'panorama', 'scene']
export type DirectorAssetFolder = { id: string; name: string; parentId: string | null }
export type DirectorAssetItem = { id: string; name: string; kind: DirectorAssetKind; url: string; folderId: string | null; createdAt: number; sizeBytes?: number }
export type DirectorAssetLibrary = { folders: DirectorAssetFolder[]; items: DirectorAssetItem[] }
// 画布连线带进来的引用（全景节点 / 资产节点的泼溅或模型文件）：只读，不入工程，随连线增减
export type DirectorLinkedAsset = { id: string; name: string; kind: Exclude<DirectorAssetKind, 'scene'>; url: string }

// 产物只存资产句柄（nomi-local:// 等），禁 base64（check:heavy-path）
export type DirectorOutputImage = { id: string; name: string; cameraName: string; assetUrl: string; createdAt: number }
export type DirectorOutputVideo = {
  id: string
  name: string
  assetUrl: string
  coverUrl?: string
  width: number
  height: number
  duration: number
  createdAt: number
}

export type DirectorProject = {
  version: typeof DIRECTOR_PROJECT_VERSION
  activeSceneId: string
  scenes: DirectorScene[]
  exportRatio: DirectorExportRatio
  exportResolution: DirectorExportResolution
  outputs: { screenshots: DirectorOutputImage[]; videos: DirectorOutputVideo[] }
  assets: DirectorAssetLibrary
}

// 任一带时间轴身份的实体（对象或机位）
export type TimelineEntity = DirectorObject | DirectorCamera

export function isDirectorCamera(entity: TimelineEntity): entity is DirectorCamera {
  return 'fov' in entity
}
