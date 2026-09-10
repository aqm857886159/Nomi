/**
 * [INPUT]: 依赖 three（父子层级世界变换 / 欧拉换算）、./legacyScene3dTypes（normalizeLegacyScene3D / Legacy*）、./legacyPropSpecs、
 *          ./legacyTrajectorySampler、../model/directorTypes、../model/directorProject 的 createDefaultProject、../model/lights 的 createLight、
 *          ../model/cameraLens 的 syncFocalLength、../model/vec3 的 lookAtAngles / RAD_TO_DEG、../model/timeGrid（DIRECTOR_FPS / quantizeToFrame）、
 *          ../model/posePresets 的 findPosePreset、../model/directorIds
 * [OUTPUT]: 对外提供 migrateScene3DState（V1 scene3dState → DirectorProject + 迁移报告）、MigrationReport、LEGACY_CROWD_LIMIT
 * [POS]: director/migration 的迁移器（切换门 C2）：老工程只在画布快照加载时经它走一次，之后就是普通 director 节点。
 *        映射：假人 → 角色（中心原点 → 脚底原点、scale/2.5、姿态弧度 → 度）、群众 → 组 + 角色、道具 → 组 + 图元、mesh → 图元（plane 转平）、
 *        模型 / 组 / 灯 原样，相机 target → yaw/pitch，轨迹绑定按 30fps 烘成路标（含 aim 轨迹 / 跟随目标 / 变焦 fov），
 *        姿态轨 → 骨骼姿态片段、locomotion → 循环动作片段，全景 / 天空色 / 网格 / 画幅进图层与工程。
 *        不迁的（报告里明说）：手持抖动、镜头景深偏移、编辑相机、轨迹分组、缩略图、超过 40 人的群众。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { syncFocalLength } from '../model/cameraLens'
import { createClipId, createKeyframeId, createObjectId, createWaypointId } from '../model/directorIds'
import { legacyPoseToAction } from '../model/actionLibrary'
import { createDefaultProject } from '../model/directorProject'
import type {
  ActionClip, BoneKeyframe, DirectorCamera, DirectorExportRatio, DirectorLight, DirectorObject, DirectorPrimitiveType, DirectorProject, DirectorScene,
  TrajectoryClip, Vec3, Waypoint,
} from '../model/directorTypes'
import { createLight } from '../model/lights'
import { findPosePreset, type PoseVec3 } from '../model/posePresets'
import { DIRECTOR_FPS, quantizeToFrame } from '../model/timeGrid'
import { lookAtAngles, RAD_TO_DEG } from '../model/vec3'
import { LEGACY_PROP_SPECS, type LegacyPropPart } from './legacyPropSpecs'
import { LEGACY_MANNEQUIN_SCALE, normalizeLegacyScene3D, type LegacyAspectRatio, type LegacyObject, type LegacyScene3DState, type LegacyVec3 } from './legacyScene3dTypes'
import { LegacyTrajectorySampler } from './legacyTrajectorySampler'

export const LEGACY_CROWD_LIMIT = 40
const MAX_BAKED_WAYPOINTS = 1800

export type MigrationReport = {
  objects: number
  cameras: number
  lights: number
  waypoints: number
  dropped: string[]
}

export type MigrateScene3DOptions = {
  sceneName: string
  /** 群众展开时的成员命名（index 从 1 起） */
  crowdMemberName?: (base: string, index: number) => string
}

const ASPECT_TO_EXPORT: Record<LegacyAspectRatio, DirectorExportRatio> = {
  '16:9': '16:9', '9:16': '9:16', '4:3': '4:3', '3:4': '3:4', '1:1': '1:1', '2.39:1': '21:9',
}

const GEOMETRY_TO_PRIMITIVE: Record<string, DirectorPrimitiveType> = { box: 'cube', sphere: 'sphere', cylinder: 'cylinder', plane: 'plane' }

function vec(value: LegacyVec3, digits = 4): Vec3 {
  return { x: Number(value[0].toFixed(digits)), y: Number(value[1].toFixed(digits)), z: Number(value[2].toFixed(digits)) }
}

function degrees(value: LegacyVec3): Vec3 {
  return { x: Number((value[0] * RAD_TO_DEG).toFixed(2)), y: Number((value[1] * RAD_TO_DEG).toFixed(2)), z: Number((value[2] * RAD_TO_DEG).toFixed(2)) }
}

function normalizeBoneKey(name: string): string {
  return name.replace(':', '')
}

function boneRotationsFromPose(pose: Record<string, PoseVec3> | undefined): Record<string, Vec3> {
  const rotations: Record<string, Vec3> = {}
  for (const [bone, rotation] of Object.entries(pose ?? {})) rotations[normalizeBoneKey(bone)] = degrees(rotation)
  return rotations
}

function poseEquals(a: Record<string, PoseVec3> | undefined, b: Record<string, PoseVec3> | undefined): boolean {
  const keysA = Object.keys(a ?? {})
  const keysB = Object.keys(b ?? {})
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => {
    const left = a?.[key]
    const right = b?.[normalizeBoneKey(key)] ?? b?.[key]
    return Boolean(left && right) && left!.every((value, index) => Math.abs(value - right![index]) < 1e-4)
  })
}

function matchingPresetId(pose: Record<string, PoseVec3> | undefined): string | undefined {
  if (!pose || Object.keys(pose).length === 0) return 'standing'
  for (const id of ['t-pose', 'walk', 'run', 'sit', 'squat', 'crouch', 'single-knee', 'double-knee', 'hands-on-hips', 'point', 'wave', 'cheer']) {
    if (poseEquals(pose, findPosePreset(id)?.pose)) return id
  }
  return undefined
}

function primitive(id: string, name: string, type: DirectorPrimitiveType, position: Vec3, rotation: Vec3, scale: Vec3, color: string | undefined, parentId: string | undefined, visible = true): DirectorObject {
  return { id, name, type, position, rotation, scale, color, visible, locked: false, ...(parentId ? { parentId } : {}) }
}

// V1 plane 是竖着的 PlaneGeometry（用户再转 -90° 放平）；V2 plane 是本来就平躺的薄板 → 先补一个 +90° 的 X 旋转，再把 y/z 尺寸对调
function planeTransform(rotation: LegacyVec3, scale: LegacyVec3): { rotation: Vec3; scale: Vec3 } {
  const euler = new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ')
  const quaternion = new THREE.Quaternion().setFromEuler(euler).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)))
  const result = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')
  return { rotation: degrees([result.x, result.y, result.z]), scale: { x: scale[0], y: Math.max(0.001, Math.abs(scale[2])), z: scale[1] } }
}

function propPartObject(part: LegacyPropPart, index: number, parentId: string, color: string): DirectorObject {
  const size = part.size
  let type: DirectorPrimitiveType = 'cube'
  let scale: Vec3 = { x: size[0] ?? 1, y: size[1] ?? 1, z: size[2] ?? 1 }
  if (part.geometry === 'cylinder') {
    const radius = Math.max(size[0] ?? 0.5, size[1] ?? 0.5)
    type = 'cylinder'
    scale = { x: radius * 2, y: size[2] ?? 1, z: radius * 2 }
  } else if (part.geometry === 'sphere') {
    type = 'sphere'
    scale = { x: (size[0] ?? 0.5) * 2, y: (size[0] ?? 0.5) * 2, z: (size[0] ?? 0.5) * 2 }
  } else if (part.geometry === 'cone') {
    type = 'cone'
    scale = { x: (size[0] ?? 0.5) * 2, y: size[1] ?? 1, z: (size[0] ?? 0.5) * 2 }
  }
  return primitive(createObjectId(), `part-${index + 1}`, type, vec(part.position), part.rotation ? degrees(part.rotation) : { x: 0, y: 0, z: 0 }, scale, part.color ?? color, parentId)
}

// 父子层级的世界位姿：灯在 V2 是顶层实体，得从 V1 组里解出来
function worldTransforms(objects: LegacyObject[]): Map<string, THREE.Object3D> {
  const nodes = new Map<string, THREE.Object3D>()
  const root = new THREE.Object3D()
  for (const object of objects) {
    const node = new THREE.Object3D()
    node.position.set(...object.position)
    node.rotation.set(...object.rotation)
    node.scale.set(...object.scale)
    nodes.set(object.id, node)
  }
  for (const object of objects) {
    const node = nodes.get(object.id)!
    const parent = object.parentId ? nodes.get(object.parentId) : undefined
    ;(parent ?? root).add(node)
  }
  root.updateMatrixWorld(true)
  return nodes
}

function headingFromTangent(tangent: THREE.Vector3 | null): { yaw: number; pitch: number } {
  if (!tangent) return { yaw: 0, pitch: 0 }
  return {
    yaw: Number((Math.atan2(tangent.x, tangent.z) * RAD_TO_DEG).toFixed(2)),
    pitch: Number((Math.atan2(-tangent.y, Math.hypot(tangent.x, tangent.z)) * RAD_TO_DEG).toFixed(2)),
  }
}

function frameTimes(start: number, end: number): number[] {
  const first = quantizeToFrame(Math.max(0, start))
  const last = quantizeToFrame(Math.max(first, end))
  const count = Math.min(MAX_BAKED_WAYPOINTS, Math.round((last - first) * DIRECTOR_FPS) + 1)
  return Array.from({ length: count }, (_, index) => quantizeToFrame(first + index / DIRECTOR_FPS))
}

function makeClip(startTime: number, endTime: number): TrajectoryClip {
  const start = quantizeToFrame(startTime)
  const end = quantizeToFrame(Math.max(startTime, endTime))
  return { id: createClipId('traj'), startTime: start, endTime: end, startFrame: Math.round(start * DIRECTOR_FPS), endFrame: Math.round(end * DIRECTOR_FPS) }
}

function makeWaypoint(clipId: string, time: number, position: Vec3, yaw: number, pitch: number, roll = 0, fov?: number): Waypoint {
  return {
    id: createWaypointId(),
    x: Number(position.x.toFixed(4)), y: Number(position.y.toFixed(4)), z: Number(position.z.toFixed(4)),
    yaw, pitch, roll,
    time, frameIndex: Math.round(time * DIRECTOR_FPS), clipId,
    ...(fov !== undefined ? { fov: Number(fov.toFixed(2)) } : {}),
  }
}

export function migrateScene3DState(raw: unknown, options: MigrateScene3DOptions): { project: DirectorProject; report: MigrationReport } {
  const state: LegacyScene3DState = normalizeLegacyScene3D(raw)
  const project = createDefaultProject(options.sceneName)
  const scene: DirectorScene = project.scenes[0]
  const report: MigrationReport = { objects: 0, cameras: 0, lights: 0, waypoints: 0, dropped: [] }
  const sampler = new LegacyTrajectorySampler(state)
  const world = worldTransforms(state.objects)
  const contentEnd = Math.max(0, ...state.trajectoryBindings.map((binding) => binding.endTime))

  // ── 环境 / 画幅 ──
  if (state.environment.backgroundColor) scene.sceneConfig.skyColor = state.environment.backgroundColor
  scene.sceneConfig.gridVisible = state.environment.showGrid
  if (state.environment.panoramaUrl) {
    const rotation = state.environment.panoramaRotation
    scene.panoramaConfig = {
      url: state.environment.panoramaUrl,
      radius: Math.max(10, state.environment.sphereRadius),
      // V1 存弧度；数值超过 2π 视为已是度数
      rotationY: Number((Math.abs(rotation) > Math.PI * 2 ? rotation : rotation * RAD_TO_DEG).toFixed(2)),
    }
  }
  const firstCamera = state.cameras[0]
  if (firstCamera) project.exportRatio = ASPECT_TO_EXPORT[firstCamera.aspectRatio]
  if (firstCamera?.aspectRatio === '2.39:1') report.dropped.push('画幅 2.39:1 → 21:9（V2 最接近的档）')
  if (state.hasEditorCamera) report.dropped.push('编辑相机位姿（V2 自由相机归位）')
  if (state.hasTrajectoryGroups) report.dropped.push('轨迹分组（V2 无分组，全部片段平铺进时间轴）')

  // ── 对象 ──
  const characterMeta = new Map<string, LegacyObject>()
  for (const object of state.objects) {
    const parentId = object.parentId && state.objects.some((item) => item.id === object.parentId) ? object.parentId : undefined
    switch (object.type) {
      case 'mannequin': {
        const scale = { x: object.scale[0] / LEGACY_MANNEQUIN_SCALE, y: object.scale[1] / LEGACY_MANNEQUIN_SCALE, z: object.scale[2] / LEGACY_MANNEQUIN_SCALE }
        const position = vec([object.position[0], object.position[1] - object.scale[1] * 0.5, object.position[2]])
        const character: DirectorObject = {
          id: object.id, name: object.name, type: 'character', position, rotation: degrees(object.rotation), scale,
          color: object.color, visible: object.visible, locked: false, ...(parentId ? { parentId } : {}),
          modelPath: 'builtin:x-bot', modelScale: 1, isSystemModel: true, rig: 'mixamo',
          posePreset: legacyPoseToAction(matchingPresetId(object.pose)),
          boneRotations: boneRotationsFromPose(object.pose),
        }
        scene.objects.push(character)
        characterMeta.set(object.id, object)
        report.objects += 1
        break
      }
      case 'mannequinCrowd': {
        const rows = object.crowdRows ?? 1
        const columns = object.crowdColumns ?? 1
        const total = rows * columns
        const count = Math.min(LEGACY_CROWD_LIMIT, total)
        if (total > count) report.dropped.push(`群众「${object.name}」${total} 人截到 ${count} 人`)
        const scaleX = Math.max(0.08, Math.abs(object.scale[0] || 1))
        const scaleZ = Math.max(0.08, Math.abs(object.scale[2] || 1))
        const footRing = Math.max(0.28, Math.max(0.78 * scaleX, 0.54 * scaleZ) * 0.36)
        const spacing = (object.crowdSpacing ?? 0.4) + footRing * 2
        const group: DirectorObject = {
          id: object.id, name: object.name, type: 'group',
          position: vec([object.position[0], object.position[1] - object.scale[1] * 0.5, object.position[2]]), rotation: degrees(object.rotation), scale: { x: 1, y: 1, z: 1 },
          visible: object.visible, locked: false, ...(parentId ? { parentId } : {}),
        }
        scene.objects.push(group)
        const memberScale = { x: object.scale[0] / LEGACY_MANNEQUIN_SCALE, y: object.scale[1] / LEGACY_MANNEQUIN_SCALE, z: object.scale[2] / LEGACY_MANNEQUIN_SCALE }
        for (let index = 0; index < count; index += 1) {
          const row = Math.floor(index / columns)
          const column = index % columns
          scene.objects.push({
            id: createObjectId(),
            name: options.crowdMemberName ? options.crowdMemberName(object.name, index + 1) : `${object.name} ${index + 1}`,
            type: 'character', parentId: object.id,
            position: { x: Number(((column - (columns - 1) / 2) * spacing).toFixed(3)), y: 0, z: Number(((row - (rows - 1) / 2) * spacing).toFixed(3)) },
            rotation: { x: 0, y: 0, z: 0 }, scale: memberScale, color: object.color, visible: true, locked: false,
            modelPath: 'builtin:x-bot', modelScale: 1, isSystemModel: true, rig: 'mixamo', posePreset: 'standing', boneRotations: {},
          })
        }
        report.objects += 1 + count
        break
      }
      case 'prop': {
        const spec = object.propKind ? LEGACY_PROP_SPECS[object.propKind] : undefined
        const group: DirectorObject = {
          id: object.id, name: object.name, type: 'group', position: vec(object.position), rotation: degrees(object.rotation), scale: vec(object.scale),
          visible: object.visible, locked: false, ...(parentId ? { parentId } : {}),
        }
        scene.objects.push(group)
        if (!spec) {
          report.dropped.push(`道具「${object.name}」未知种类 ${object.propKind ?? '?'}，只保留空组`)
        } else {
          spec.parts.forEach((part, index) => scene.objects.push(propPartObject(part, index, object.id, object.color ?? spec.defaultColor)))
        }
        report.objects += 1 + (spec?.parts.length ?? 0)
        break
      }
      case 'mesh': {
        const type = GEOMETRY_TO_PRIMITIVE[object.geometry ?? 'box'] ?? 'cube'
        const transform = object.geometry === 'plane' ? planeTransform(object.rotation, object.scale) : { rotation: degrees(object.rotation), scale: vec(object.scale) }
        scene.objects.push(primitive(object.id, object.name, type, vec(object.position), transform.rotation, transform.scale, object.color, parentId, object.visible))
        report.objects += 1
        break
      }
      case 'model': {
        scene.objects.push({
          id: object.id, name: object.name, type: 'model', position: vec(object.position), rotation: degrees(object.rotation), scale: vec(object.scale),
          visible: object.visible, locked: false, ...(parentId ? { parentId } : {}), modelPath: object.modelUrl,
        })
        report.objects += 1
        break
      }
      case 'group': {
        scene.objects.push({
          id: object.id, name: object.name, type: 'group', position: vec(object.position), rotation: degrees(object.rotation), scale: vec(object.scale),
          visible: object.visible, locked: false, ...(parentId ? { parentId } : {}),
        })
        report.objects += 1
        break
      }
      case 'light': {
        const node = world.get(object.id)
        const position = new THREE.Vector3()
        const forward = new THREE.Vector3(0, 0, -1)
        if (node) {
          node.getWorldPosition(position)
          forward.applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()))
        }
        const aim = lookAtAngles({ x: 0, y: 0, z: 0 }, { x: forward.x, y: forward.y, z: forward.z })
        const light: DirectorLight = createLight(object.lightType ?? 'point', object.id, object.name, {
          position: vec([position.x, position.y, position.z]),
          yaw: aim.yaw, pitch: aim.pitch,
          ...(object.lightColor ? { color: object.lightColor } : {}),
          ...(object.lightIntensity !== undefined ? { intensity: object.lightIntensity } : {}),
          visible: object.visible,
        })
        scene.lights.push(light)
        report.lights += 1
        break
      }
      default:
        report.dropped.push(`对象「${object.name}」未知类型 ${String(object.type)}`)
    }
  }

  // ── 相机 ──
  for (const camera of state.cameras) {
    const aim = lookAtAngles(vec(camera.position), vec(camera.target))
    const followTarget = camera.followTargetId && state.objects.some((item) => item.id === camera.followTargetId) ? camera.followTargetId : undefined
    const migrated: DirectorCamera = syncFocalLength({
      id: camera.id, name: camera.name, position: vec(camera.position), yaw: aim.yaw, pitch: aim.pitch, roll: 0, fov: camera.fov, focalLengthMm: 0,
      showRayHelper: true,
      ...(followTarget ? { lookAtType: 'object' as const, lookAtObjectId: followTarget } : {}),
    })
    scene.cameras.push(migrated)
    report.cameras += 1
    if (camera.lensDepth) report.dropped.push(`机位「${camera.name}」的镜头景深偏移 ${camera.lensDepth}`)
    if (camera.shakeAmplitude) report.dropped.push(`机位「${camera.name}」的手持抖动 ${camera.shakeAmplitude}`)
  }

  // ── 轨迹绑定 → 路标片段 ──
  const trackOrder: string[] = []
  for (const binding of state.trajectoryBindings) {
    if (binding.endTime <= binding.startTime) continue
    for (const bound of binding.objects) {
      const legacyObject = state.objects.find((item) => item.id === bound.objectId)
      const legacyCamera = state.cameras.find((item) => item.id === bound.objectId)
      if (!legacyObject && !legacyCamera) continue
      const clip = makeClip(binding.startTime, binding.endTime)
      const waypoints: Waypoint[] = []
      for (const time of frameTimes(binding.startTime, binding.endTime)) {
        if (legacyCamera) {
          const pose = sampler.cameraPose(legacyCamera, time)
          const angles = lookAtAngles(vec(pose.position), vec(pose.target))
          const hasRamp = binding.fovFrom !== undefined || binding.fovTo !== undefined
          waypoints.push(makeWaypoint(clip.id, time, vec(pose.position), angles.yaw, angles.pitch, 0, hasRamp ? pose.fov : undefined))
        } else if (legacyObject) {
          const moving = sampler.objectPosition(legacyObject, time)
          if (!moving) continue
          const heading = headingFromTangent(moving.tangent)
          // 假人 V1 原点在中心、V2 在脚底：采样点本身就是脚下
          const position = legacyObject.type === 'mannequin' || legacyObject.type === 'mannequinCrowd'
            ? vec([moving.position[0], moving.position[1] - legacyObject.scale[1] * 0.5, moving.position[2]])
            : vec(moving.position)
          waypoints.push(makeWaypoint(clip.id, time, position, heading.yaw, heading.pitch))
        }
      }
      if (waypoints.length === 0) continue
      const target = legacyCamera ? scene.cameras.find((item) => item.id === bound.objectId) : scene.objects.find((item) => item.id === bound.objectId)
      if (!target) continue
      target.trajectoryClips = [...(target.trajectoryClips ?? []), clip]
      target.motionTrajectory = [...(target.motionTrajectory ?? []), ...waypoints]
      target.inTimeline = true
      if (!trackOrder.includes(target.id)) trackOrder.push(target.id)
      report.waypoints += waypoints.length
    }
  }

  // ── 姿态轨 / locomotion → 动作片段 ──
  for (const [id, legacy] of characterMeta) {
    const character = scene.objects.find((item) => item.id === id)
    if (!character) continue
    const clips: ActionClip[] = []
    const binding = sampler.bindingOf(id)
    if (legacy.locomotionClip === 'walk' || legacy.locomotionClip === 'run') {
      const start = quantizeToFrame(binding?.startTime ?? 0)
      const end = quantizeToFrame(Math.max(start + 1, binding?.endTime ?? contentEnd))
      clips.push({ id: createClipId('action'), name: legacy.locomotionClip, clipType: 'action', actionPose: legacy.locomotionClip === 'run' ? 'running' : 'standard_walk', startTime: start, endTime: end, startFrame: Math.round(start * DIRECTOR_FPS), endFrame: Math.round(end * DIRECTOR_FPS) })
    }
    if (legacy.poseTrack && legacy.poseTrack.length > 0) {
      const sorted = [...legacy.poseTrack].sort((a, b) => a.time - b.time)
      const keyframes: BoneKeyframe[] = sorted.map((keyframe) => {
        const time = quantizeToFrame(keyframe.time)
        const rotations = boneRotationsFromPose(keyframe.pose ?? findPosePreset(keyframe.presetId)?.pose)
        return { id: createKeyframeId(), time, frame: Math.round(time * DIRECTOR_FPS), boneRotations: rotations }
      })
      const start = keyframes[0].time
      const end = quantizeToFrame(Math.max(start + 1, contentEnd, keyframes[keyframes.length - 1].time + 1))
      clips.push({ id: createClipId('action'), name: 'pose', clipType: 'custom_pose', startTime: start, endTime: end, startFrame: Math.round(start * DIRECTOR_FPS), endFrame: Math.round(end * DIRECTOR_FPS), keyframes })
    }
    if (clips.length > 0) {
      character.actionClips = clips
      character.actionTrackEnabled = true
      character.inTimeline = true
      if (!trackOrder.includes(id)) trackOrder.push(id)
    }
  }
  scene.timelineTrackOrder = trackOrder
  return { project, report }
}
