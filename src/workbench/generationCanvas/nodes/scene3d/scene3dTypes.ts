export type Scene3DVector3 = [number, number, number]

export type Scene3DTransformMode = 'translate' | 'rotate' | 'scale'
export type Scene3DControlMode = 'edit' | 'fly'
export type Scene3DObjectType = 'mesh' | 'model' | 'light' | 'group' | 'mannequin' | 'mannequinCrowd'
export type Scene3DGeometry = 'box' | 'sphere' | 'cylinder' | 'plane'
export type Scene3DLightType = 'point' | 'directional' | 'spot'
export type Scene3DAspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1'
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
  modelUrl?: string
  lightType?: Scene3DLightType
  lightColor?: string
  lightIntensity?: number
  crowdRows?: number
  crowdColumns?: number
  crowdSpacing?: number
  pose?: Record<string, Scene3DVector3>
  children?: string[]
}

export type Scene3DCamera = {
  id: string
  name: string
  visible: boolean
  position: Scene3DVector3
  rotation: Scene3DVector3
  target: Scene3DVector3
  followTargetId?: string
  fov: number
  aspectRatio: Scene3DAspectRatio
  lensDepth: number
  near: number
  far: number
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
}

export type Scene3DTrajectoryGroup = {
  id: string
  name: string
  trajectoryIds: string[]
}

export type Scene3DTimeline = {
  totalDuration: number
}

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
}

export const SCENE3D_ASPECT_OPTIONS = Object.keys(SCENE3D_ASPECT_RATIOS) as Scene3DAspectRatio[]
