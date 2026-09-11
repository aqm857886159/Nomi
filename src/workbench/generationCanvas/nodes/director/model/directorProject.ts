/**
 * [INPUT]: 依赖 ./directorTypes（全部 schema）、./directorIds 的 createSceneId、./cameraLens 的 syncFocalLength
 * [OUTPUT]: 对外提供 DEFAULT_SCENE_CONFIG / DEFAULT_PANORAMA_CONFIG、createDefaultScene、createDefaultProject、
 *           normalizeDirectorProject（容错归一，任何 unknown → 合法工程）、cloneDirectorProject、projectStats
 * [POS]: director/model 的工程生命周期：节点 meta 里读出来的东西先过 normalize 再进 store（对齐 V1 serializer 的
 *        「逐字段容错、不做版本迁移链」做法）；V1→V2 迁移在切换门时加在这里。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { syncFocalLength } from './cameraLens'
import { createSceneId } from './directorIds'
import {
  DIRECTOR_EXPORT_RATIOS,
  DIRECTOR_EXPORT_RESOLUTIONS,
  DIRECTOR_PROJECT_VERSION,
  type DirectorCamera,
  type DirectorExportRatio,
  type DirectorExportResolution,
  type DirectorLight,
  type DirectorObject,
  type DirectorPanoramaConfig,
  type DirectorProject,
  type DirectorScene,
  type DirectorSceneConfig,
  type Vec3,
  DIRECTOR_ASSET_KINDS,
  type DirectorAssetKind,
} from './directorTypes'

export const DEFAULT_SKY_COLOR = '#1a1a1a'

export const DEFAULT_SCENE_CONFIG: DirectorSceneConfig = {
  scale: 1,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  skyColor: DEFAULT_SKY_COLOR,
  gridSnapEnabled: false,
  gridVisible: true,
  gridHeight: 0,
  groundOpacity: 0.2,
  showSkeleton: false,
  showCharacterLabels: true,
  showRuleOfThirds: true,
  modelDisplayMode: 'solid',
}

export const DEFAULT_PANORAMA_CONFIG: DirectorPanoramaConfig = { url: '', radius: 500, rotationY: 0 }

export function createDefaultScene(name: string, id: string = createSceneId()): DirectorScene {
  return {
    id,
    name,
    visible: true,
    sceneConfig: { ...DEFAULT_SCENE_CONFIG, position: { ...DEFAULT_SCENE_CONFIG.position }, rotation: { ...DEFAULT_SCENE_CONFIG.rotation } },
    panoramaConfig: { ...DEFAULT_PANORAMA_CONFIG },
    objects: [],
    cameras: [],
    lights: [],
    timelineTrackOrder: [],
    timelineTrackPins: [],
    timelineTrackFolds: [],
  }
}

export function createDefaultProject(sceneName: string): DirectorProject {
  const scene = createDefaultScene(sceneName)
  return {
    version: DIRECTOR_PROJECT_VERSION,
    activeSceneId: scene.id,
    scenes: [scene],
    exportRatio: '16:9',
    exportResolution: '1080',
    outputs: { screenshots: [], videos: [] },
    assets: { folders: [], items: [] },
  }
}

// ── 容错归一（unknown → 合法工程；坏字段丢弃、缺字段补默认；不抛错）──
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function vec3(value: unknown, fallback: Vec3): Vec3 {
  if (!isRecord(value)) return { ...fallback }
  return { x: num(value.x, fallback.x), y: num(value.y, fallback.y), z: num(value.z, fallback.z) }
}

function optionalVec3(value: unknown): Vec3 | undefined {
  return isRecord(value) ? vec3(value, { x: 0, y: 0, z: 0 }) : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function arrayOf<T>(value: unknown, map: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  const out: T[] = []
  for (const item of value) {
    const mapped = map(item)
    if (mapped) out.push(mapped)
  }
  return out
}

function normalizeClipTimes(raw: Record<string, unknown>): { startTime: number; endTime: number; startFrame: number; endFrame: number } | null {
  const startTime = num(raw.startTime, Number.NaN)
  const endTime = num(raw.endTime, Number.NaN)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return null
  return { startTime, endTime, startFrame: num(raw.startFrame, Math.round(startTime * 30)), endFrame: num(raw.endFrame, Math.round(endTime * 30)) }
}

function normalizeTimelineFields(raw: Record<string, unknown>) {
  const motionTrajectory = arrayOf(raw.motionTrajectory, (item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return null
    const time = num(item.time, Number.NaN)
    if (!Number.isFinite(time)) return null
    return {
      id: item.id,
      x: num(item.x, 0), y: num(item.y, 0), z: num(item.z, 0),
      yaw: num(item.yaw, 0), pitch: num(item.pitch, 0), roll: num(item.roll, 0),
      time, frameIndex: num(item.frameIndex, Math.round(time * 30)),
      clipId: typeof item.clipId === 'string' ? item.clipId : undefined,
      progress: typeof item.progress === 'number' ? item.progress : undefined,
      lookAtObjectId: typeof item.lookAtObjectId === 'string' ? item.lookAtObjectId : undefined,
      fov: typeof item.fov === 'number' && Number.isFinite(item.fov) ? item.fov : undefined,
    }
  })
  const trajectoryClips = arrayOf(raw.trajectoryClips, (item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return null
    const times = normalizeClipTimes(item)
    return times ? { id: item.id, ...times } : null
  })
  return {
    motionTrajectory: motionTrajectory.length ? motionTrajectory : undefined,
    trajectoryClips: trajectoryClips.length ? trajectoryClips : undefined,
    inTimeline: bool(raw.inTimeline, false) || undefined,
  }
}

const OBJECT_TYPES = new Set(['character', 'model', 'group', 'splat', 'cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'tetrahedron', 'icosahedron'])

function normalizeObject(raw: unknown): DirectorObject | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  const type = OBJECT_TYPES.has(String(raw.type)) ? (raw.type as DirectorObject['type']) : 'cube'
  const object: DirectorObject = {
    id: raw.id,
    name: str(raw.name, type),
    type,
    position: vec3(raw.position, { x: 0, y: 0, z: 0 }),
    rotation: vec3(raw.rotation, { x: 0, y: 0, z: 0 }),
    scale: vec3(raw.scale, { x: 1, y: 1, z: 1 }),
    visible: bool(raw.visible, true),
    locked: bool(raw.locked, false),
    ...normalizeTimelineFields(raw),
  }
  if (typeof raw.parentId === 'string') object.parentId = raw.parentId
  if (typeof raw.color === 'string') object.color = raw.color
  for (const key of ['roughness', 'metalness', 'opacity', 'modelScale'] as const) {
    if (typeof raw[key] === 'number') object[key] = raw[key] as number
  }
  for (const key of ['wireframe', 'flatShading', 'isAuxiliary', 'isSystemModel', 'actionTrackEnabled', 'lookAtTrackEnabled'] as const) {
    if (typeof raw[key] === 'boolean') object[key] = raw[key] as boolean
  }
  for (const key of ['modelPath', 'posePreset', 'bodyType'] as const) {
    if (typeof raw[key] === 'string') object[key] = raw[key] as string
  }
  if (raw.rig === 'mixamo' || raw.rig === 'ue4') object.rig = raw.rig
  if (isRecord(raw.boneRotations)) {
    const rotations: Record<string, Vec3> = {}
    for (const [bone, value] of Object.entries(raw.boneRotations)) rotations[bone] = vec3(value, { x: 0, y: 0, z: 0 })
    object.boneRotations = rotations
  }
  const hips = optionalVec3(raw.hipsOffset)
  if (hips) object.hipsOffset = hips
  const actionClips = arrayOf(raw.actionClips, (item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return null
    const times = normalizeClipTimes(item)
    if (!times) return null
    const keyframes = arrayOf(item.keyframes, (kf) => {
      if (!isRecord(kf) || typeof kf.id !== 'string') return null
      const time = num(kf.time, Number.NaN)
      if (!Number.isFinite(time)) return null
      const boneRotations: Record<string, Vec3> = {}
      if (isRecord(kf.boneRotations)) {
        for (const [bone, value] of Object.entries(kf.boneRotations)) boneRotations[bone] = vec3(value, { x: 0, y: 0, z: 0 })
      }
      return { id: kf.id, time, frame: num(kf.frame, Math.round(time * 30)), boneRotations, hipsOffset: optionalVec3(kf.hipsOffset) }
    })
    return {
      id: item.id,
      name: str(item.name, ''),
      clipType: item.clipType === 'custom_pose' ? 'custom_pose' as const : 'action' as const,
      actionPose: typeof item.actionPose === 'string' ? item.actionPose : undefined,
      ...times,
      keyframes: keyframes.length ? keyframes : undefined,
    }
  })
  if (actionClips.length) object.actionClips = actionClips
  const lookAtClips = arrayOf(raw.lookAtClips, (item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return null
    const times = normalizeClipTimes(item)
    if (!times) return null
    const targetType = ['none', 'camera', 'object', 'custom'].includes(String(item.targetType)) ? (item.targetType as DirectorObject['lookAtClips'] extends (infer C)[] | undefined ? C extends { targetType: infer T } ? T : never : never) : 'none'
    const bodyPart = ['eye', 'face', 'chest', 'body', 'pelvis', 'foot', 'custom'].includes(String(item.targetBodyPart)) ? (item.targetBodyPart as 'eye' | 'face' | 'chest' | 'body' | 'pelvis' | 'foot' | 'custom') : 'face'
    return {
      id: item.id,
      name: str(item.name, ''),
      targetType,
      targetId: str(item.targetId, ''),
      enablePitch: bool(item.enablePitch, false),
      targetHeightOffset: num(item.targetHeightOffset, 0),
      targetBodyPart: bodyPart,
      ...times,
      blendInDuration: num(item.blendInDuration, 0.4),
      blendOutDuration: num(item.blendOutDuration, 0.4),
      weight: num(item.weight, 1),
      clampingAngle: num(item.clampingAngle, 80),
    }
  })
  if (lookAtClips.length) object.lookAtClips = lookAtClips
  return object
}

const ANCHORS = ['eye', 'face', 'chest', 'body', 'pelvis', 'foot', 'custom']
const FACINGS = ['look_at_target', 'follow_subject_yaw', 'world_locked', 'manual']
const AZIMUTHS = ['front', 'front_left', 'front_right', 'left', 'right', 'back', 'custom']
const PRESETS = ['static', 'orbit', 'half_arc', 'push_in', 'pull_out', 'crane', 'truck', 'spiral']

function normalizeCamera(raw: unknown): DirectorCamera | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  const camera: DirectorCamera = syncFocalLength({
    id: raw.id,
    name: str(raw.name, 'Camera'),
    position: vec3(raw.position, { x: 0, y: 1.6, z: 4.5 }),
    yaw: num(raw.yaw, 0),
    pitch: num(raw.pitch, 0),
    roll: num(raw.roll, 0),
    fov: num(raw.fov, 50),
    focalLengthMm: 0,
    showRayHelper: bool(raw.showRayHelper, true),
    ...normalizeTimelineFields(raw),
  })
  if (raw.lookAtType === 'none' || raw.lookAtType === 'object' || raw.lookAtType === 'coordinates') camera.lookAtType = raw.lookAtType
  if (typeof raw.lookAtObjectId === 'string') camera.lookAtObjectId = raw.lookAtObjectId
  const lookAt = optionalVec3(raw.lookAtCoords)
  if (lookAt) camera.lookAtCoords = lookAt
  if (raw.rigType === 'none' || raw.rigType === 'follow' || raw.rigType === 'track_aim') camera.rigType = raw.rigType
  const closeupClips = arrayOf(raw.closeupClips, (item) => {
    if (!isRecord(item) || typeof item.id !== 'string') return null
    const times = normalizeClipTimes(item)
    if (!times) return null
    return {
      id: item.id,
      entityId: str(item.entityId, camera.id),
      targetObjectId: str(item.targetObjectId, ''),
      ...times,
      anchor: (ANCHORS.includes(String(item.anchor)) ? item.anchor : 'face') as DirectorCamera['closeupClips'] extends (infer C)[] | undefined ? C extends { anchor: infer A } ? A : never : never,
      customAnchor: optionalVec3(item.customAnchor),
      facingMode: (FACINGS.includes(String(item.facingMode)) ? item.facingMode : 'look_at_target') as 'look_at_target' | 'follow_subject_yaw' | 'world_locked' | 'manual',
      azimuth: (AZIMUTHS.includes(String(item.azimuth)) ? item.azimuth : 'front') as 'front' | 'front_left' | 'front_right' | 'left' | 'right' | 'back' | 'custom',
      customAzimuthDeg: typeof item.customAzimuthDeg === 'number' ? item.customAzimuthDeg : undefined,
      horizontalAngle: num(item.horizontalAngle, 0),
      pitchAngle: num(item.pitchAngle, 0),
      distance: num(item.distance, 1.2),
      height: num(item.height, 0),
      motionPreset: (PRESETS.includes(String(item.motionPreset)) ? item.motionPreset : 'static') as 'static' | 'orbit' | 'half_arc' | 'push_in' | 'pull_out' | 'crane' | 'truck' | 'spiral',
    }
  })
  if (closeupClips.length) camera.closeupClips = closeupClips
  return camera
}

function normalizeLight(raw: unknown): DirectorLight | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null
  const type = raw.type === 'directional' || raw.type === 'point' || raw.type === 'spot' ? raw.type : 'point'
  return {
    id: raw.id,
    name: str(raw.name, type),
    type,
    color: str(raw.color, '#ffffff'),
    intensity: num(raw.intensity, 1),
    position: vec3(raw.position, { x: 0, y: 3, z: 0 }),
    yaw: num(raw.yaw, 0),
    pitch: num(raw.pitch, 0),
    enabled: bool(raw.enabled, true),
    visible: bool(raw.visible, true),
    locked: bool(raw.locked, false),
    castShadow: bool(raw.castShadow, true),
    spotAngle: typeof raw.spotAngle === 'number' ? raw.spotAngle : type === 'spot' ? 45 : undefined,
    spotPenumbra: typeof raw.spotPenumbra === 'number' ? raw.spotPenumbra : type === 'spot' ? 0.3 : undefined,
    distance: num(raw.distance, 0),
    decay: num(raw.decay, 2),
  }
}

export function normalizeScene(raw: unknown, fallbackName: string): DirectorScene | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id : createSceneId()
  const scene = createDefaultScene(str(raw.name, fallbackName), id)
  scene.visible = bool(raw.visible, true)
  if (isRecord(raw.sceneConfig)) {
    const c = raw.sceneConfig
    scene.sceneConfig = {
      scale: num(c.scale, 1),
      position: vec3(c.position, DEFAULT_SCENE_CONFIG.position),
      rotation: vec3(c.rotation, DEFAULT_SCENE_CONFIG.rotation),
      skyColor: str(c.skyColor, DEFAULT_SKY_COLOR),
      gridSnapEnabled: bool(c.gridSnapEnabled, false),
      gridVisible: bool(c.gridVisible, true),
      gridHeight: num(c.gridHeight, 0),
      groundOpacity: num(c.groundOpacity, 0.2),
      showSkeleton: bool(c.showSkeleton, false),
      showCharacterLabels: bool(c.showCharacterLabels, true),
      showRuleOfThirds: bool(c.showRuleOfThirds, true),
      modelDisplayMode: c.modelDisplayMode === 'translucent' || c.modelDisplayMode === 'clay' ? c.modelDisplayMode : 'solid',
    }
  }
  if (isRecord(raw.panoramaConfig)) {
    scene.panoramaConfig = {
      url: str(raw.panoramaConfig.url, ''),
      radius: num(raw.panoramaConfig.radius, DEFAULT_PANORAMA_CONFIG.radius),
      rotationY: num(raw.panoramaConfig.rotationY, 0),
    }
  }
  scene.objects = arrayOf(raw.objects, normalizeObject)
  scene.cameras = arrayOf(raw.cameras, normalizeCamera)
  scene.lights = arrayOf(raw.lights, normalizeLight)
  const knownIds = new Set([...scene.objects, ...scene.cameras].map((entity) => entity.id))
  scene.timelineTrackOrder = stringArray(raw.timelineTrackOrder).filter((id) => knownIds.has(id))
  scene.timelineTrackPins = stringArray(raw.timelineTrackPins).filter((id) => knownIds.has(id))
  scene.timelineTrackFolds = stringArray(raw.timelineTrackFolds).filter((id) => knownIds.has(id))
  // 持久化入口保证父图是有根森林；悬空、非组父级和环都不能进入递归树/渲染链。
  const objectsById = new Map(scene.objects.map(object => [object.id, object]))
  for (const object of scene.objects) {
    const seen = new Set([object.id])
    let current = object
    while (current.parentId) {
      const parent = objectsById.get(current.parentId)
      if (!parent || parent.type !== 'group' || seen.has(parent.id)) { delete current.parentId; break }
      seen.add(parent.id)
      current = parent
    }
  }
  return scene
}

export function normalizeDirectorProject(raw: unknown, defaultSceneName: string = 'Scene 1'): DirectorProject {
  if (!isRecord(raw)) return createDefaultProject(defaultSceneName)
  const scenes = arrayOf(raw.scenes, (item, ) => normalizeScene(item, defaultSceneName))
  if (scenes.length === 0) scenes.push(createDefaultScene(defaultSceneName))
  const activeSceneId = typeof raw.activeSceneId === 'string' && scenes.some((scene) => scene.id === raw.activeSceneId)
    ? raw.activeSceneId
    : scenes[0].id
  const outputs = isRecord(raw.outputs) ? raw.outputs : {}
  const assets = isRecord(raw.assets) ? raw.assets : {}
  return {
    version: DIRECTOR_PROJECT_VERSION,
    activeSceneId,
    scenes,
    exportRatio: (DIRECTOR_EXPORT_RATIOS as readonly string[]).includes(String(raw.exportRatio)) ? (raw.exportRatio as DirectorExportRatio) : '16:9',
    exportResolution: (DIRECTOR_EXPORT_RESOLUTIONS as readonly string[]).includes(String(raw.exportResolution)) ? (raw.exportResolution as DirectorExportResolution) : '1080',
    outputs: {
      screenshots: arrayOf(outputs.screenshots, (item) =>
        isRecord(item) && typeof item.id === 'string' && typeof item.assetUrl === 'string'
          ? { id: item.id, name: str(item.name, ''), cameraName: str(item.cameraName, ''), assetUrl: item.assetUrl, createdAt: num(item.createdAt, 0) }
          : null,
      ),
      videos: arrayOf(outputs.videos, (item) =>
        isRecord(item) && typeof item.id === 'string' && typeof item.assetUrl === 'string'
          ? {
              id: item.id, name: str(item.name, ''), assetUrl: item.assetUrl,
              coverUrl: typeof item.coverUrl === 'string' ? item.coverUrl : undefined,
              width: num(item.width, 0), height: num(item.height, 0), duration: num(item.duration, 0), createdAt: num(item.createdAt, 0),
            }
          : null,
      ),
    },
    assets: {
      folders: arrayOf(assets.folders, (item) =>
        isRecord(item) && typeof item.id === 'string' ? { id: item.id, name: str(item.name, ''), parentId: typeof item.parentId === 'string' ? item.parentId : null } : null,
      ),
      items: arrayOf(assets.items, (item) =>
        isRecord(item) && typeof item.id === 'string' && typeof item.url === 'string' && (DIRECTOR_ASSET_KINDS as readonly string[]).includes(String(item.kind))
          ? {
              id: item.id, name: str(item.name, ''), kind: item.kind as DirectorAssetKind, url: item.url,
              folderId: typeof item.folderId === 'string' ? item.folderId : null, createdAt: num(item.createdAt, 0),
              sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : undefined,
            }
          : null,
      ),
    },
  }
}

// 换掉一个图层里所有实体 id（对象 / 机位 / 灯 + 父子、看向、特写目标、视线目标引用），图层复制与导入场景共用；
// 不动路标 / 片段 / 关键帧 id（它们只在实体内部被引用）
export function remapSceneIds(source: DirectorScene, tag: string): DirectorScene {
  const scene = cloneDirectorProject({ version: DIRECTOR_PROJECT_VERSION, activeSceneId: source.id, scenes: [source], exportRatio: '16:9', exportResolution: '1080', outputs: { screenshots: [], videos: [] }, assets: { folders: [], items: [] } }).scenes[0]
  const suffix = () => `-${tag}-${Math.random().toString(36).slice(2, 7)}`
  scene.id = `${source.id}${suffix()}`
  const idMap = new Map<string, string>()
  const remap = (id: string | undefined): string | undefined => (id && idMap.has(id) ? idMap.get(id) : id)
  for (const object of scene.objects) {
    const next = `${object.id}${suffix()}`
    idMap.set(object.id, next)
    object.id = next
  }
  for (const camera of scene.cameras) {
    const next = `${camera.id}${suffix()}`
    idMap.set(camera.id, next)
    camera.id = next
  }
  for (const light of scene.lights) light.id = `${light.id}${suffix()}`
  for (const object of scene.objects) {
    object.parentId = remap(object.parentId)
    for (const point of object.motionTrajectory ?? []) point.lookAtObjectId = remap(point.lookAtObjectId)
    for (const clip of object.lookAtClips ?? []) clip.targetId = remap(clip.targetId) ?? clip.targetId
  }
  for (const camera of scene.cameras) {
    camera.lookAtObjectId = remap(camera.lookAtObjectId)
    for (const point of camera.motionTrajectory ?? []) point.lookAtObjectId = remap(point.lookAtObjectId)
    for (const clip of camera.closeupClips ?? []) {
      clip.entityId = camera.id
      clip.targetObjectId = remap(clip.targetObjectId) ?? clip.targetObjectId
    }
  }
  scene.timelineTrackOrder = scene.timelineTrackOrder.map((id) => remap(id) ?? id)
  scene.timelineTrackPins = scene.timelineTrackPins.map((id) => remap(id) ?? id)
  scene.timelineTrackFolds = scene.timelineTrackFolds.map((id) => remap(id) ?? id)
  return scene
}

export function cloneDirectorProject(project: DirectorProject): DirectorProject {
  return JSON.parse(JSON.stringify(project)) as DirectorProject
}

// 节点卡片摘要：物体数 / 机位数 / 有无全景
export function projectStats(project: DirectorProject): { objectCount: number; cameraCount: number; hasPanorama: boolean } {
  return {
    objectCount: project.scenes.reduce((sum, scene) => sum + scene.objects.length, 0),
    cameraCount: project.scenes.reduce((sum, scene) => sum + scene.cameras.length, 0),
    hasPanorama: project.scenes.some((scene) => Boolean(scene.panoramaConfig.url)),
  }
}
