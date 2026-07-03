export type Scene3DVector3 = [number, number, number]

export type Scene3DTransformMode = 'translate' | 'rotate' | 'scale'
export type Scene3DControlMode = 'edit' | 'fly'
export type Scene3DObjectType = 'mesh' | 'model' | 'light' | 'group' | 'mannequin' | 'mannequinCrowd' | 'prop'
// 语义道具（灰模摆场件）。spec 数据在 scene3dProps.tsx，新增 kind 只加一条 spec。
export type Scene3DPropKind = 'car' | 'building' | 'tree' | 'streetlamp' | 'wall'
export type Scene3DGeometry = 'box' | 'sphere' | 'cylinder' | 'plane'
export type Scene3DLightType = 'point' | 'directional' | 'spot'
export type Scene3DAspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '2.39:1'
export type Scene3DTrajectoryDirection = 'forward' | 'reverse'

export type Scene3DObject = {
  id: string
  name: string
  type: Scene3DObjectType
  visible: boolean
  position: Scene3DVector3
  rotation: Scene3DVector3
  scale: Scene3DVector3
  parentId?: string
  color?: string
  geometry?: Scene3DGeometry
  // type='prop' 时的道具种类（车/建筑/树/路灯/墙）；origin 在地面中心（y=0 即贴地）。
  propKind?: Scene3DPropKind
  modelUrl?: string
  lightType?: Scene3DLightType
  lightColor?: string
  lightIntensity?: number
  crowdRows?: number
  crowdColumns?: number
  crowdSpacing?: number
  pose?: Record<string, Scene3DVector3>
  // 动作随时间变化的轨道（录 take 用）。空/缺省 = 老行为（静态 pose）。
  // time 为绝对场景时间轴秒，与 trajectoryBinding.startTime/播放头同一时钟。
  poseTrack?: Scene3DPoseKeyframe[]
  // 被操控角色「确定性迈腿」locomotion clip 名（与 mannequin-animations.glb 内 clip 名逐字一致，如 'walk'）。
  // 录 take 离屏回放时据此让假人确定性地播该 clip（按帧时刻 setTime 取相位），导出 mp4 里腿就动。
  // 缺省 = 老行为（不播 locomotion，只走静态 pose/poseTrack 路径 → 零回归）。
  // 与 poseTrack 共存：某帧 poseTrack 命中非 base 关键帧（用户切了静态动作）→ 静态优先，不播 locomotion。
  locomotionClip?: string
  children?: string[]
}

// pose-over-time 单帧：在时刻 time 把该假人切到 pose（presetId 仅留痕/UI 高亮）。
// pose 缺省 = 站立/rest。自包含（采样不依赖预设常量查表）。
export type Scene3DPoseKeyframe = {
  time: number
  presetId?: string
  pose?: Record<string, Scene3DVector3>
}

export type Scene3DCamera = {
  id: string
  name: string
  visible: boolean
  position: Scene3DVector3
  rotation: Scene3DVector3
  target: Scene3DVector3
  followTargetId?: string
  // 相机运镜 take：相机注视点随时间走的「瞄准轨迹」id（录运镜时存下用户每帧看向哪），
  // 让回放/离屏忠实还原 free-look 转朝向（不靠 follow 某物体、不靠运动切线）。缺省=老行为（看 target/follow）。
  aimTrajectoryId?: string
  fov: number
  aspectRatio: Scene3DAspectRatio
  lensDepth: number
  near: number
  far: number
  // 手持抖动强度 0-100（0/缺省 = 关）。播放/离屏采帧时在 cameraWithPlaybackPosition 叠
  // 确定性多频正弦噪声（纯播放头 t 的函数，逐帧可重现），经运镜小片 video_ref 真传进成片。
  shakeAmplitude?: number
}

export type Scene3DTrajectoryPoint = {
  id: string
  position: Scene3DVector3
  timeRatio?: number
}

export type Scene3DTrajectoryCurveControl = {
  segmentStartPointId: string
  position: Scene3DVector3
}

export type Scene3DTrajectory = {
  id: string
  name: string
  points: Scene3DTrajectoryPoint[]
  curveControls?: Scene3DTrajectoryCurveControl[]
  tension: number
  closed: boolean
  color: string
}

export type Scene3DTrajectoryBoundObject = {
  objectId: string
  offsetRatio: number
}

export type Scene3DTrajectoryBinding = {
  id: string
  trajectoryId: string
  objects: Scene3DTrajectoryBoundObject[]
  startTime: number
  endTime: number
  direction: Scene3DTrajectoryDirection
  // FOV 随段进度线性渐变（变焦推/拉、希区柯克的地基）。两者都缺省 = 老行为（用相机静态 fov）。
  // 只对绑定对象里的相机生效；direction=reverse 时进度同样反转（fovFrom 始终对应段起点）。
  fovFrom?: number
  fovTo?: number
}

export type Scene3DTrajectoryGroup = {
  id: string
  name: string
  trajectoryIds: string[]
}

export type Scene3DTimeline = {
  totalDuration: number
}

export type Scene3DEnvironmentMode = 'panorama' | 'sphere'

export type Scene3DState = {
  objects: Scene3DObject[]
  cameras: Scene3DCamera[]
  trajectories: Scene3DTrajectory[]
  trajectoryBindings: Scene3DTrajectoryBinding[]
  trajectoryGroups: Scene3DTrajectoryGroup[]
  sceneTimeline: Scene3DTimeline
  environment: {
    preset: string
    showGrid: boolean
    showAxes: boolean
    showSky: boolean
    darkMode: boolean
    backgroundColor: string
    panoramaUrl?: string
    panoramaFileName?: string
    panoramaRotation: number
    environmentMode: Scene3DEnvironmentMode
    sphereRadius: number
  }
  editorCamera: {
    position: Scene3DVector3
    target: Scene3DVector3
    rotation: Scene3DVector3
    mode: Scene3DControlMode
  }
  lastThumbnail?: string
}

export type Scene3DSelection =
  | { type: 'object'; id: string }
  | { type: 'camera'; id: string }
  | null

export type Scene3DCaptureResult = {
  dataUrl: string
  width: number
  height: number
  title: string
  source: 'scene3d-viewport' | 'scene3d-camera'
}

export type CaptureApi = {
  captureViewport: () => Scene3DCaptureResult | null
  captureCamera: (camera: Scene3DCamera) => Scene3DCaptureResult | null
}

export const SCENE3D_ASPECT_RATIOS: Record<Scene3DAspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '1:1': 1,
  '2.39:1': 2.39, // 宽银幕 cinemascope；下游尺寸(截图/运镜小片)全按比值派生，无需特判
}

export const SCENE3D_ASPECT_OPTIONS = Object.keys(SCENE3D_ASPECT_RATIOS) as Scene3DAspectRatio[]
