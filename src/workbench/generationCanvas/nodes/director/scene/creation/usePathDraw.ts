/**
 * [INPUT]: 依赖 react、../../DirectorEditorContext（useDirectorStore / useDirectorStoreApi）、../ViewportApiContext 的 useViewportApi、
 *          ../../model/directorStore 的 DrawMode、../../model/directorTypes（TimelineEntity / Vec3 / isDirectorCamera）、../../model/editLayer 的 findTrajectoryClipAt、
 *          ../../model/pathTools（resamplePathByArcLength / distributeTimesByArcLength / pathLength）、../../model/timeGrid 的 quantizeToFrame、
 *          ../../model/trajectoryEval 的 headingFromTangent
 *          ../../model/sceneObjectGraph 的世界↔父组变换；Orbit 生命周期由 DirectorViewport 统一拥有
 * [OUTPUT]: 对外提供 PathDrawGhostState / PathDrawApi、usePathDraw（画笔：按住拖画 → 松开按弧长重采样 → 按行走速度定时长 → 一次批量写路标；
 *           逐点：每点击落一个路标并把播放头推进 1s）
 * [POS]: director/scene/creation 的画路径工具（清单 §1 T3/T4）：模式来自 store.drawMode（顶栏 / 4 / 5 键），
 *        必须先选中角色或机位；幽灵体（已画折线 / 锚点→光标预览 / 光标环）放 ref 给 TrajectoryVisuals 每帧读。
 *        幽灵线/地面拾取保持世界坐标，路标写入前经 sceneObjectGraph 逆变换到图层/父组局部坐标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorStoreState, DrawMode } from '../../model/directorStore'
import { isDirectorCamera, type TimelineEntity, type Vec3, type TrajectoryClip } from '../../model/directorTypes'
import { findTrajectoryClipAt } from '../../model/editLayer'
import { distributeTimesByArcLength, pathLength, resamplePathByArcLength } from '../../model/pathTools'
import { quantizeToFrame } from '../../model/timeGrid'
import { headingFromTangent } from '../../model/trajectoryEval'
import { invertFrame, multiplyFrames, objectWorldFrame, sceneFrame, transformPoint } from '../../model/sceneObjectGraph'
import { useViewportApi } from '../ViewportApiContext'

export type PathDrawGhostState = { visible: boolean; drawing: boolean; points: Vec3[]; cursor: Vec3 | null; anchor: Vec3 | null }

export type PathDrawApi = {
  active: boolean
  mode: DrawMode
  pointCount: number
  ghostRef: React.MutableRefObject<PathDrawGhostState>
  cancel: () => void
  onPointerDown: (event: React.PointerEvent) => boolean
  onPointerMove: (event: React.PointerEvent) => boolean
  onPointerUp: (event: React.PointerEvent) => boolean
  onPointerLeave: () => void
}

const WALK_SPEED_MPS = 1.4
const MIN_POINT_SPACING = 0.05
const MAX_PATH_SECONDS = 20
const WAYPOINT_STEP_SECONDS = 1
const COUNT_THROTTLE_MS = 100

function hiddenGhost(): PathDrawGhostState {
  return { visible: false, drawing: false, points: [], cursor: null, anchor: null }
}

// 只有角色和机位能画路径（清单 T3 前置）
function subjectOf(state: DirectorStoreState): TimelineEntity | null {
  const entity = state.findObject(state.selection.objectId) ?? state.findCamera(state.selection.cameraId) ?? null
  if (!entity) return null
  return isDirectorCamera(entity) || entity.type === 'character' ? entity : null
}

function subjectFrame(state: DirectorStoreState, entity: TimelineEntity) {
  const scene = state.activeScene()
  return multiplyFrames(sceneFrame(scene.sceneConfig), objectWorldFrame(scene.objects, isDirectorCamera(entity) ? undefined : entity.parentId))
}

// 角色贴世界地面画；机位保持当前世界高度。
function subjectHeight(state: DirectorStoreState, entity: TimelineEntity): number {
  const position = state.evaluatedPoses[entity.id]?.position ?? entity.position
  return isDirectorCamera(entity) ? transformPoint(subjectFrame(state, entity), position).y : state.activeScene().sceneConfig.gridHeight
}

function subjectAnchor(state: DirectorStoreState, entity: TimelineEntity): Vec3 {
  const position = transformPoint(subjectFrame(state, entity), state.evaluatedPoses[entity.id]?.position ?? entity.position)
  return { x: position.x, y: subjectHeight(state, entity), z: position.z }
}

export function usePathDraw({ notify }: { notify: (key: string, params?: Record<string, unknown>) => void }): PathDrawApi {
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const mode = useDirectorStore((state) => state.drawMode)
  const [pointCount, setPointCount] = React.useState(0)
  const ghostRef = React.useRef<PathDrawGhostState>(hiddenGhost())
  const notifyRef = React.useRef(notify)
  notifyRef.current = notify
  const lastCountAtRef = React.useRef(0)

  React.useEffect(() => {
    if (!mode) {
      ghostRef.current = hiddenGhost()
      setPointCount(0)
      return
    }
    const state = store.getState()
    const entity = subjectOf(state)
    if (!entity) {
      notifyRef.current('director.trajectory.needSubject')
      state.setDrawMode(null)
      return
    }
    state.setTransformMode(null)
    ghostRef.current = { visible: true, drawing: false, points: [], cursor: null, anchor: subjectAnchor(state, entity) }
    setPointCount(0)
  }, [mode, store])

  const cancel = React.useCallback(() => {
    store.getState().setDrawMode(null)
  }, [store])

  const finishPencil = React.useCallback(
    (points: Vec3[]) => {
      const state = store.getState()
      const entity = subjectOf(state)
      if (!entity) {
        notifyRef.current('director.trajectory.needSubject')
        return
      }
      const resampled = resamplePathByArcLength(points)
      if (resampled.length < 2) {
        notifyRef.current('director.trajectory.tooShort')
        return
      }
      const duration = quantizeToFrame(Math.min(MAX_PATH_SECONDS, Math.max(1, pathLength(resampled) / WALK_SPEED_MPS)))
      // 播放头落在一段还没有路标的路径片段里（加轨道自动带的那段）→ 画进它，并尽量把时长改成按步速算出的值；否则新建片段
      const now = state.timeline.currentTime
      const empty = (entity.trajectoryClips ?? []).find(
        (item) => now >= item.startTime - 1e-6 && now <= item.endTime + 1e-6 && !(entity.motionTrajectory ?? []).some((waypoint) => waypoint.clipId === item.id),
      )
      let clip: TrajectoryClip | null
      if (empty) {
        state.updateClipTime(entity.id, empty.id, 'trajectory', empty.startTime, empty.startTime + duration)
        const fresh = store.getState()
        const owner = fresh.findObject(entity.id) ?? fresh.findCamera(entity.id)
        clip = owner?.trajectoryClips?.find((item) => item.id === empty.id) ?? empty
        fresh.setActiveTrajectoryClip(entity.id, clip.id)
        fresh.select({ clipId: clip.id, clipType: 'trajectory' })
      } else {
        clip = state.addTrajectoryClip(entity.id, now, duration)
      }
      if (!clip) {
        notifyRef.current('director.reason.clipNoSpace')
        return
      }
      const times = distributeTimesByArcLength(resampled, clip.startTime, clip.endTime)
      const camera = isDirectorCamera(entity)
      const inverse = invertFrame(subjectFrame(state, entity))
      const localPoints = resampled.map((point) => transformPoint(inverse, point))
      const seeds = localPoints.map((point, index) => {
        const previous = localPoints[Math.max(0, index - 1)]
        const next = localPoints[Math.min(localPoints.length - 1, index + 1)]
        const heading = headingFromTangent({ x: next.x - previous.x, y: next.y - previous.y, z: next.z - previous.z })
        return { time: times[index], x: point.x, y: point.y, z: point.z, yaw: heading.yaw, pitch: camera ? heading.pitch : 0, roll: 0 }
      })
      const count = store.getState().insertWaypointsBatch(entity.id, clip.id, seeds)
      store.getState().setTimelineContext({ currentTime: clip.startTime, isPlaying: false })
      notifyRef.current('director.trajectory.created', { count })
    },
    [store],
  )

  const placeWaypoint = React.useCallback(
    (point: Vec3) => {
      const state = store.getState()
      const entity = subjectOf(state)
      if (!entity) {
        notifyRef.current('director.trajectory.needSubject')
        return
      }
      const time = quantizeToFrame(state.timeline.currentTime)
      const localPoint = transformPoint(invertFrame(subjectFrame(state, entity)), point)
      if (!state.prepareClipForKeyframeInsert(entity.id, time)) {
        notifyRef.current('director.reason.clipNoSpace')
        return
      }
      const fresh = store.getState().findObject(entity.id) ?? store.getState().findCamera(entity.id)
      const clip = fresh ? findTrajectoryClipAt(fresh.trajectoryClips, time) : undefined
      if (!fresh || !clip) {
        notifyRef.current('director.reason.clipNoSpace')
        return
      }
      const previous = (fresh.motionTrajectory ?? []).filter((waypoint) => waypoint.clipId === clip.id && waypoint.time < time).pop()
      const restYaw = isDirectorCamera(fresh) ? fresh.yaw : fresh.rotation.y
      const yaw = previous ? headingFromTangent({ x: localPoint.x - previous.x, y: 0, z: localPoint.z - previous.z }).yaw : restYaw
      if (!store.getState().insertWaypoint(entity.id, time, { ...localPoint, yaw, pitch: 0, roll: 0 }, clip.id)) {
        notifyRef.current('director.reason.clipNoSpace')
        return
      }
      ghostRef.current = { ...ghostRef.current, anchor: point }
      setPointCount((count) => count + 1)
      const next = quantizeToFrame(time + WAYPOINT_STEP_SECONDS)
      store.getState().ensureDuration(next)
      store.getState().setTimelineContext({ currentTime: next, isPlaying: false })
    },
    [store],
  )

  const pointFromEvent = React.useCallback(
    (event: React.PointerEvent): { entity: TimelineEntity; point: Vec3 } | null => {
      const state = store.getState()
      const entity = subjectOf(state)
      const ground = apiRef.current?.groundPointFromClient(event.clientX, event.clientY)
      if (!entity || !ground) return null
      return { entity, point: { x: ground.x, y: subjectHeight(state, entity), z: ground.z } }
    },
    [apiRef, store],
  )

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!mode) return false
      if (event.button === 2) {
        event.preventDefault()
        cancel()
        return true
      }
      if (event.button !== 0) return false
      const hit = pointFromEvent(event)
      if (!hit) return true
      if (mode === 'pencil') {
        ghostRef.current = { ...ghostRef.current, visible: true, drawing: true, points: [hit.point], cursor: hit.point }
        setPointCount(1)
        return true
      }
      placeWaypoint(hit.point)
      return true
    },
    [cancel, mode, placeWaypoint, pointFromEvent],
  )

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!mode) return false
      const hit = pointFromEvent(event)
      if (!hit) return true
      const ghost = ghostRef.current
      ghost.cursor = hit.point
      if (mode === 'pencil' && ghost.drawing) {
        const last = ghost.points[ghost.points.length - 1]
        if (!last || Math.hypot(hit.point.x - last.x, hit.point.z - last.z) >= MIN_POINT_SPACING) {
          ghost.points.push(hit.point)
          const now = performance.now()
          if (now - lastCountAtRef.current > COUNT_THROTTLE_MS) {
            lastCountAtRef.current = now
            setPointCount(ghost.points.length)
          }
        }
      }
      return true
    },
    [mode, pointFromEvent],
  )

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!mode || event.button !== 0) return false
      const ghost = ghostRef.current
      if (mode === 'pencil' && ghost.drawing) {
        const points = ghost.points
        ghostRef.current = { ...ghost, drawing: false, points: [] }
        setPointCount(0)
        finishPencil(points)
      }
      return true
    },
    [finishPencil, mode],
  )

  const onPointerLeave = React.useCallback(() => {
    ghostRef.current.cursor = null
  }, [])

  return { active: mode !== null, mode, pointCount, ghostRef, cancel, onPointerDown, onPointerMove, onPointerUp, onPointerLeave }
}
