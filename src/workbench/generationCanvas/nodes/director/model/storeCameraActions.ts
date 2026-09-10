/**
 * [INPUT]: 依赖 ./directorStore 的 CommitProject / StoreGet / StoreSet / DirectorSelection、./directorTypes、./cameraPresets（CAMERA_PRESETS / buildCameraFromPreset / CurrentViewPose）、
 *          ./closeupRig（findCloseupClipAt / solveCloseupPose）、./trajectoryEval 的 evaluateEntityTransform、./recordingSimplify（CameraMotionSample / isRecordingTooShort / simplifySamplesToWaypoints）、
 *          ./directorIds（createCameraId / createWaypointId）、./timeGrid（entityClips / quantizeToFrame / FRAME_SECONDS）、./vec3 的 lookAtAngles、./storeClipActions 的 PovCheck、./storeTimelineActions 的 WaypointSeed、
 *          ./evaluatedSceneObject 的完整目标场景位姿：特写烘焙与实时求值共享父链和动画时间
 * [OUTPUT]: 对外提供 RecordingSession / FinishRecordingResult / DirectorCameraActions、createCameraActions：进出机位视角、固化当前视角为新机位、
 *           角色轨 / 机位轨创建特写、录制运镜起 / 停 / 放弃、特写烘焙成路径片段
 * [POS]: director/model 的机位级动作（跨机位 / 片段 / 时间轴上下文），与 storeEntityActions（机位 CRUD）、storeClipActions（特写片段 CRUD）分文件；
 *        进机位受 canEnterCameraPOV 门（特写片段内禁止）；录制中的机位由视口相机驱动，停止时一次简化成关键帧。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { buildCameraFromPreset, CAMERA_PRESETS, type CurrentViewPose } from './cameraPresets'
import { findFreeStart } from './clips'
import { findCloseupClipAt, solveCloseupPose } from './closeupRig'
import { createCameraId, createWaypointId } from './directorIds'
import type { CommitProject, DirectorSelection, StoreGet, StoreSet } from './directorStore'
import type { Vec3 } from './directorTypes'
import { isRecordingTooShort, simplifySamplesToWaypoints, type CameraMotionSample } from './recordingSimplify'
import type { PovCheck } from './storeClipActions'
import type { WaypointSeed } from './storeTimelineActions'
import { entityClips, FRAME_SECONDS, laneClips, quantizeToFrame } from './timeGrid'
import { lookAtAngles } from './vec3'
import { evaluateSceneObjectPose } from './evaluatedSceneObject'

export type RecordingSession = { cameraId: string; startTime: number }
export type FinishRecordingResult = { clipId: string; waypoints: number } | 'too_short' | 'no_space' | null

export type DirectorCameraActions = {
  enterCameraPOV: (cameraId: string) => PovCheck
  exitCameraPOV: () => void
  captureCurrentView: (view: CurrentViewPose, name: string) => string
  createCloseupForCharacter: (objectId: string, cameraName: string) => { cameraId: string; clipId: string } | null
  appendCloseupForCamera: (cameraId: string) => string | null
  startRecording: (cameraId: string) => boolean
  finishRecording: (samples: CameraMotionSample[], cumulativeDistance: number) => FinishRecordingResult
  cancelRecording: () => void
  convertCloseupToTrajectory: (cameraId: string, clipId: string) => string | null
}

const CLOSEUP_PRESET = CAMERA_PRESETS.find((preset) => preset.id === 'front_closeup') ?? CAMERA_PRESETS[1]
const CURRENT_VIEW_PRESET = CAMERA_PRESETS.find((preset) => preset.isCurrent) ?? CAMERA_PRESETS[0]
const CLOSEUP_DURATION = 4
// 固定 12 个样本均匀铺满片段
const BAKE_SAMPLES = 12

function anglesToward(from: Vec3, to: Vec3): Vec3 {
  const angles = lookAtAngles(from, to)
  return { x: angles.pitch, y: angles.yaw, z: angles.roll }
}

export function createCameraActions(set: StoreSet, get: StoreGet, _commitProject: CommitProject): DirectorCameraActions {
  const selectCamera = (cameraId: string, extra: Partial<DirectorSelection> = {}) =>
    get().select({ cameraId, objectId: null, lightId: null, multiObjectIds: [], activeWaypointId: null, selectedWaypointIds: [], boneKey: null, ikTarget: null, clipId: null, clipType: null, ...extra })

  return {
    enterCameraPOV: (cameraId) => {
      const check = get().canEnterCameraPOV(cameraId)
      if (!check.allowed) return check
      set({ activeCameraId: cameraId, previewCameraId: cameraId })
      selectCamera(cameraId)
      return check
    },

    exitCameraPOV: () => set({ activeCameraId: 'free' }),

    // Shift+A：把自由视角固化成新机位并选中它
    captureCurrentView: (view, name) => {
      const camera = buildCameraFromPreset({ preset: CURRENT_VIEW_PRESET, id: createCameraId(), name, currentView: view })
      const id = get().addCamera(camera)
      set({ previewCameraId: id })
      selectCamera(id)
      return id
    },

    // 角色轨「创建特写片段」：正面特写预设相对该角色生成新机位 + 4s 特写，播放头跳到片段开头、小窗切到它
    createCloseupForCharacter: (objectId, cameraName) => get().withHistory(() => {
      const state = get()
      const object = state.findObject(objectId)
      if (!object || object.type !== 'character') return null
      const camera = buildCameraFromPreset({
        preset: CLOSEUP_PRESET,
        id: createCameraId(),
        name: cameraName,
        subject: { position: object.position, rotation: object.rotation, scale: object.scale },
      })
      const cameraId = state.addCamera(camera)
      const clip = get().addCloseupClip(cameraId, objectId, state.timeline.currentTime, CLOSEUP_DURATION)
      if (!clip) {
        get().deleteCamera(cameraId)
        return null
      }
      set({ previewCameraId: cameraId })
      get().setTimelineContext({ currentTime: clip.startTime, isPlaying: false })
      // 选中新机位 + 这段特写，检查器直接落到「特写片段属性」
      selectCamera(cameraId, { clipId: clip.id, clipType: 'closeup' })
      return { cameraId, clipId: clip.id }
    }),

    // 机位轨「创建特写片段」：目标 = 机位的看向对象，否则场景里第一个角色；追加在该机位最后一段之后
    appendCloseupForCamera: (cameraId) => {
      const state = get()
      const camera = state.findCamera(cameraId)
      if (!camera) return null
      const scene = state.activeScene()
      const target =
        (camera.lookAtObjectId ? scene.objects.find((object) => object.id === camera.lookAtObjectId && object.type === 'character') : undefined) ??
        scene.objects.find((object) => object.type === 'character')
      if (!target) return null
      const tail = entityClips(camera).reduce((max, clip) => Math.max(max, clip.endTime), 0)
      const clip = get().addCloseupClip(cameraId, target.id, tail, CLOSEUP_DURATION)
      if (!clip) return null
      set({ previewCameraId: cameraId })
      get().setTimelineContext({ currentTime: clip.startTime, isPlaying: false })
      selectCamera(cameraId, { clipId: clip.id, clipType: 'closeup' })
      return clip.id
    },

    startRecording: (cameraId) => {
      const state = get()
      const camera = state.findCamera(cameraId)
      if (state.recording || !camera) return false
      if (findCloseupClipAt(camera.closeupClips, state.timeline.currentTime)) return false
      set({ recording: { cameraId, startTime: quantizeToFrame(state.timeline.currentTime) } })
      state.setTimelineContext({ isPlaying: false })
      return true
    },

    // 停止：太短丢弃；否则按样本时间开一段路径片段（放不下就找空位并整体平移样本），简化成关键帧
    finishRecording: (samples, cumulativeDistance) => get().withHistory(() => {
      const state = get()
      const session = state.recording
      if (!session) return null
      set({ recording: null })
      if (isRecordingTooShort(samples, cumulativeDistance)) {
        state.setTimelineContext({ currentTime: session.startTime, isPlaying: false })
        return 'too_short'
      }
      const first = samples[0]
      const last = samples[samples.length - 1]
      const duration = Math.max(FRAME_SECONDS, quantizeToFrame(last.time) - quantizeToFrame(first.time))
      const camera = state.findCamera(session.cameraId)
      const start = camera ? findFreeStart(laneClips(camera, 'trajectory'), first.time, duration, state.timeline.totalDuration) : null
      const clip = start === null ? null : get().addTrajectoryClip(session.cameraId, start, duration)
      if (!clip) {
        state.setTimelineContext({ currentTime: session.startTime, isPlaying: false })
        return 'no_space'
      }
      const shift = clip.startTime - quantizeToFrame(first.time)
      const shifted = shift === 0 ? samples : samples.map((sample) => ({ ...sample, time: sample.time + shift }))
      const waypoints = simplifySamplesToWaypoints(shifted, clip.id, createWaypointId)
      const seeds: WaypointSeed[] = waypoints.map((waypoint) => ({ time: waypoint.time, x: waypoint.x, y: waypoint.y, z: waypoint.z, yaw: waypoint.yaw, pitch: waypoint.pitch, roll: waypoint.roll }))
      const count = get().insertWaypointsBatch(session.cameraId, clip.id, seeds)
      get().setTimelineContext({ currentTime: clip.startTime, isPlaying: false })
      selectCamera(session.cameraId, { clipId: clip.id, clipType: 'trajectory' })
      return { clipId: clip.id, waypoints: count }
    }),

    cancelRecording: () => {
      const session = get().recording
      if (!session) return
      set({ recording: null })
      get().setTimelineContext({ currentTime: session.startTime, isPlaying: false })
    },

    // 把特写按 12 个等距样本求值位姿，烘焙成同时间段的路径片段
    convertCloseupToTrajectory: (cameraId, clipId) => get().withHistory(() => {
      const state = get()
      const camera = state.findCamera(cameraId)
      const closeup = camera?.closeupClips?.find((item) => item.id === clipId)
      const target = closeup ? state.activeScene().objects.find((object) => object.id === closeup.targetObjectId) : undefined
      if (!camera || !closeup || !target) return null
      const restRotation = { x: camera.pitch, y: camera.yaw, z: camera.roll }
      const targetAtStart = evaluateSceneObjectPose(state.activeScene().objects, target.id, closeup.startTime)!
      const seeds: WaypointSeed[] = []
      for (let step = 0; step < BAKE_SAMPLES; step += 1) {
        const time = step === BAKE_SAMPLES - 1 ? closeup.endTime : closeup.startTime + ((closeup.endTime - closeup.startTime) * step) / (BAKE_SAMPLES - 1)
        const targetNow = evaluateSceneObjectPose(state.activeScene().objects, target.id, time)!
        const solved = solveCloseupPose({
          clip: closeup,
          currentTime: time,
          targetPosition: targetNow.position,
          targetRotationY: targetNow.yaw,
          referenceRotationY: targetAtStart.yaw,
          cameraRotation: restRotation,
        })
        const rotation = solved.rotation ?? (solved.lookAt ? anglesToward(solved.position, solved.lookAt) : restRotation)
        seeds.push({ time: quantizeToFrame(time), x: solved.position.x, y: solved.position.y, z: solved.position.z, yaw: rotation.y, pitch: rotation.x, roll: rotation.z })
      }
      get().deleteCloseupClip(cameraId, clipId)
      const clip = get().addTrajectoryClip(cameraId, closeup.startTime, closeup.endTime - closeup.startTime)
      if (!clip) return null
      get().insertWaypointsBatch(cameraId, clip.id, seeds)
      selectCamera(cameraId, { clipId: clip.id, clipType: 'trajectory' })
      return clip.id
    }),
  }
}
