/**
 * [INPUT]: 依赖 react、../../DirectorEditorContext 的 useDirectorStoreApi、../ViewportApiContext 的 useViewportApi、../../model/vec3
 *          ../../model/sceneObjectGraph 的完整预览 TRS 世界→图层转换；Orbit 生命周期由 DirectorViewport 统一拥有
 * [OUTPUT]: 对外提供 PlacementGhostState、useCharacterPlacement（放置模式：地面幽灵体跟随 → 点击落点 → 按住拖拽定朝向 → 松开创建）
 * [POS]: director/scene/creation 的角色落地放置（清单 §2.2 V4a）：DOM 指针事件在视口容器上处理，幽灵体状态放 ref 给
 *        PlacementGhost 每帧读取；右键/Esc 取消。创建走 store.addObject（名字「角色N」、posePreset tpose、系统模型）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorRig, Vec3 } from '../../model/directorTypes'
import { RAD_TO_DEG } from '../../model/vec3'
import { frameTransform, invertFrame, localFrame, multiplyFrames, sceneFrame } from '../../model/sceneObjectGraph'
import { useViewportApi } from '../ViewportApiContext'

export type PlacementGender = 'female' | 'male'

export type PlacementGhostState = {
  visible: boolean
  position: Vec3
  headingDeg: number
  dragging: boolean
  dragTarget: Vec3 | null
}

export const CHARACTER_MODEL_BY_GENDER: Record<PlacementGender, { modelPath: string; rig: DirectorRig }> = {
  female: { modelPath: 'builtin:x-bot', rig: 'mixamo' },
  male: { modelPath: 'builtin:x-bot', rig: 'mixamo' },
}

export type CharacterPlacementApi = {
  active: boolean
  gender: PlacementGender | null
  headingDeg: number
  ghostRef: React.MutableRefObject<PlacementGhostState>
  start: (gender: PlacementGender) => void
  cancel: () => void
  onPointerDown: (event: React.PointerEvent) => boolean
  onPointerMove: (event: React.PointerEvent) => boolean
  onPointerUp: (event: React.PointerEvent) => boolean
  onPointerLeave: () => void
}

export function useCharacterPlacement({ characterName }: { characterName: (index: number) => string }): CharacterPlacementApi {
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const [gender, setGender] = React.useState<PlacementGender | null>(null)
  const [headingDeg, setHeadingDeg] = React.useState(0)
  const ghostRef = React.useRef<PlacementGhostState>({ visible: false, position: { x: 0, y: 0, z: 0 }, headingDeg: 0, dragging: false, dragTarget: null })
  const anchorRef = React.useRef<Vec3 | null>(null)

  const cancel = React.useCallback(() => {
    setGender(null)
    setHeadingDeg(0)
    anchorRef.current = null
    ghostRef.current = { visible: false, position: { x: 0, y: 0, z: 0 }, headingDeg: 0, dragging: false, dragTarget: null }
  }, [])

  const start = React.useCallback(
    (nextGender: PlacementGender) => {
      setGender(nextGender)
      setHeadingDeg(0)
      anchorRef.current = null
      ghostRef.current = { visible: false, position: { x: 0, y: 0, z: 0 }, headingDeg: 0, dragging: false, dragTarget: null }
      store.getState().setDrawMode(null)
      store.getState().setTransformMode(null)
      store.getState().clearSelection()
    },
    [store],
  )

  const createAt = React.useCallback(
    (position: Vec3, heading: number) => {
      if (!gender) return
      const state = store.getState()
      const index = state.activeScene().objects.filter((object) => object.type === 'character').length + 1
      const spec = CHARACTER_MODEL_BY_GENDER[gender]
      const transform = frameTransform(multiplyFrames(invertFrame(sceneFrame(state.activeScene().sceneConfig)), localFrame({ position, rotation: { x: 0, y: heading, z: 0 }, scale: { x: 1, y: 1, z: 1 } })))
      const id = state.addObject({
        name: characterName(index),
        type: 'character',
        ...transform,
        color: gender === 'female' ? '#fb7185' : '#38bdf8',
        visible: true,
        locked: false,
        posePreset: 'tpose',
        modelPath: spec.modelPath,
        modelScale: 1,
        isSystemModel: true,
        rig: spec.rig,
      })
      state.setTransformMode('translate')
      state.select({ objectId: id, multiObjectIds: [id] })
    },
    [characterName, gender, store],
  )

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!gender) return false
      if (event.button === 2) {
        event.preventDefault()
        cancel()
        return true
      }
      if (event.button !== 0) return false
      const point = apiRef.current?.groundPointFromClient(event.clientX, event.clientY)
      if (!point) return true
      anchorRef.current = point
      ghostRef.current = { ...ghostRef.current, visible: true, position: point, headingDeg: 0, dragging: true, dragTarget: point }
      setHeadingDeg(0)
      return true
    },
    [apiRef, cancel, gender],
  )

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!gender) return false
      const point = apiRef.current?.groundPointFromClient(event.clientX, event.clientY)
      const ghost = ghostRef.current
      if (!point) {
        if (!ghost.dragging) ghostRef.current = { ...ghost, visible: false }
        return true
      }
      const anchor = anchorRef.current
      if (!ghost.dragging || !anchor) {
        ghostRef.current = { ...ghost, visible: true, position: point }
        return true
      }
      const dx = point.x - anchor.x
      const dz = point.z - anchor.z
      const heading = Math.hypot(dx, dz) > 0.1 ? Number((Math.atan2(dx, dz) * RAD_TO_DEG).toFixed(2)) : 0
      ghostRef.current = { ...ghost, visible: true, position: anchor, headingDeg: heading, dragTarget: point }
      setHeadingDeg(heading)
      return true
    },
    [apiRef, gender],
  )

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!gender) return false
      const ghost = ghostRef.current
      if (!ghost.dragging || !anchorRef.current) return true
      event.preventDefault()
      const point = apiRef.current?.groundPointFromClient(event.clientX, event.clientY) ?? ghost.dragTarget ?? anchorRef.current
      const distance = Math.hypot(point.x - anchorRef.current.x, point.z - anchorRef.current.z)
      createAt(anchorRef.current, distance > 0.1 ? ghost.headingDeg : 0)
      cancel()
      return true
    },
    [apiRef, cancel, createAt, gender],
  )

  const onPointerLeave = React.useCallback(() => {
    if (gender && !ghostRef.current.dragging) ghostRef.current = { ...ghostRef.current, visible: false }
  }, [gender])

  return { active: gender !== null, gender, headingDeg, ghostRef, start, cancel, onPointerDown, onPointerMove, onPointerUp, onPointerLeave }
}
