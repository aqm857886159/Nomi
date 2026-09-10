/**
 * [INPUT]: 依赖 react、./DirectorEditorContext（useDirectorStore / useDirectorStoreApi）、./scene/ViewportApiContext 的 ViewportApiRef、
 *          ./model/recordingSimplify（CameraMotionSample / shouldRecordSample）、./model/timeGrid（FRAME_SECONDS / DIRECTOR_MAX_DURATION_SECONDS）、./model/vec3 的 distance、./model/directorTypes 的 Vec3
 *          ./model/cameraCoordinateSpace / sceneObjectGraph：样本转图层局部坐标，幽灵线保持世界坐标
 * [OUTPUT]: 对外提供 CameraRecorderApi / RecordingGhostState、useCameraMotionRecorder：录制运镜的起 / 停 / 放弃、采样循环、临时线 ref
 * [POS]: director 根的录制器（清单 §6 C2）：DOM 侧 rAF 循环读视口相机位姿（含机位逻辑 fov）按阈值采样，同时推进播放头并自动延长时间轴；
 *        停止时交给 store.finishRecording 简化成关键帧；采样与临时线不进 store。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useDirectorStore, useDirectorStoreApi } from './DirectorEditorContext'
import type { Vec3 } from './model/directorTypes'
import { shouldRecordSample, type CameraMotionSample } from './model/recordingSimplify'
import { DIRECTOR_MAX_DURATION_SECONDS, FRAME_SECONDS } from './model/timeGrid'
import { distance } from './model/vec3'
import type { ViewportApiRef } from './scene/ViewportApiContext'
import { transformCameraPose } from './model/cameraCoordinateSpace'
import { invertFrame, sceneFrame } from './model/sceneObjectGraph'

export type RecordingGhostState = { points: Vec3[] }

export type CameraRecorderApi = {
  active: boolean
  start: () => void
  stop: () => void
  cancel: () => void
  ghostRef: React.MutableRefObject<RecordingGhostState>
}

const MAX_FRAME_DELTA = 0.1
const DURATION_MARGIN = 2

export function useCameraMotionRecorder({ apiRef, notify }: { apiRef: ViewportApiRef; notify: (key: string, params?: Record<string, unknown>) => void }): CameraRecorderApi {
  const store = useDirectorStoreApi()
  const recordingCameraId = useDirectorStore((state) => state.recording?.cameraId ?? null)
  const samplesRef = React.useRef<CameraMotionSample[]>([])
  const distanceRef = React.useRef(0)
  const ghostRef = React.useRef<RecordingGhostState>({ points: [] })
  const notifyRef = React.useRef(notify)
  notifyRef.current = notify

  const stop = React.useCallback(() => {
    const state = store.getState()
    if (!state.recording) return
    const result = state.finishRecording(samplesRef.current, distanceRef.current)
    samplesRef.current = []
    distanceRef.current = 0
    ghostRef.current = { points: [] }
    if (result === 'too_short') notifyRef.current('director.camera.recordTooShort')
    else if (result === 'no_space') notifyRef.current('director.reason.clipNoSpace')
    else if (result) notifyRef.current('director.camera.recordDone', { count: result.waypoints })
  }, [store])

  const start = React.useCallback(() => {
    const state = store.getState()
    if (state.recording) return
    if (state.activeCameraId === 'free') {
      notifyRef.current('director.camera.recordNeedsPov')
      return
    }
    if (state.isCameraInCloseupAt(state.activeCameraId)) {
      notifyRef.current('director.reason.closeupLocked')
      return
    }
    samplesRef.current = []
    distanceRef.current = 0
    ghostRef.current = { points: [] }
    if (!state.startRecording(state.activeCameraId)) notifyRef.current('director.camera.recordNeedsPov')
  }, [store])

  const cancel = React.useCallback(() => {
    const state = store.getState()
    if (!state.recording) return
    state.cancelRecording()
    samplesRef.current = []
    distanceRef.current = 0
    ghostRef.current = { points: [] }
    notifyRef.current('director.camera.recordCancelled')
  }, [store])

  // 采样循环：只在录制期间挂 rAF；到 60s 上限自动收
  React.useEffect(() => {
    if (!recordingCameraId) return undefined
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const state = store.getState()
      const api = apiRef.current
      if (!state.recording || !api) return
      const delta = Math.min(MAX_FRAME_DELTA, (now - last) / 1000)
      last = now
      const time = Math.min(DIRECTOR_MAX_DURATION_SECONDS, state.timeline.currentTime + delta)
      if (time + DURATION_MARGIN > state.timeline.totalDuration) state.ensureDuration(time + DURATION_MARGIN)
      state.setTimelineContext({ currentTime: time })
      const worldPose = api.getViewPose()
      const pose = transformCameraPose(worldPose, invertFrame(sceneFrame(state.activeScene().sceneConfig)))
      const sample: CameraMotionSample = { time, position: pose.position, yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll, fov: pose.fov }
      const previous = samplesRef.current[samplesRef.current.length - 1]
      if (shouldRecordSample(previous, sample, FRAME_SECONDS)) {
        if (previous) distanceRef.current += distance(previous.position, sample.position)
        samplesRef.current.push(sample)
        ghostRef.current.points.push(worldPose.position)
      }
      if (time >= DIRECTOR_MAX_DURATION_SECONDS - FRAME_SECONDS) {
        stop()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      ghostRef.current = { points: [] }
    }
  }, [apiRef, recordingCameraId, stop, store])

  return { active: recordingCameraId !== null, start, stop, cancel, ghostRef }
}
