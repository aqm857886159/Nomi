/**
 * [INPUT]: 依赖 react、../../DirectorEditorContext 的 useDirectorStoreApi、../ViewportApiContext 的 useViewportApi、../../model/directorTypes 的 Vec3
 *          ../../model/sceneObjectGraph 的完整预览 TRS 世界→图层转换；active 状态使首点前 HUD/Esc 生效，Orbit 由 DirectorViewport 统一拥有
 * [OUTPUT]: 对外提供 BoxDrawGhostState、useBoxDraw（画框模式：拖底面 → 松开拉高 → 左键确认；Shift 锁正方形/正方体；右键/Esc 取消）
 * [POS]: director/scene/creation 的「创建方块」（清单 §2.2 V4d）：两阶段状态机 dragging_base → extruding_height，幽灵体状态放 ref
 *        给 BoxDrawGhost 每帧读；确认时按底面尺寸与高度创建 cube（底面中心、scale = 尺寸）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import type { Vec3 } from '../../model/directorTypes'
import { frameTransform, invertFrame, localFrame, multiplyFrames, sceneFrame } from '../../model/sceneObjectGraph'
import { useViewportApi } from '../ViewportApiContext'

export type BoxDrawStep = 'idle' | 'dragging_base' | 'extruding_height'

export type BoxDrawGhostState = {
  visible: boolean
  center: Vec3
  width: number
  depth: number
  height: number
}

export type BoxDrawApi = {
  active: boolean
  step: BoxDrawStep
  dimensions: { width: number; depth: number; height: number }
  ghostRef: React.MutableRefObject<BoxDrawGhostState>
  start: () => void
  cancel: () => void
  onPointerDown: (event: React.PointerEvent) => boolean
  onPointerMove: (event: React.PointerEvent) => boolean
  onPointerUp: (event: React.PointerEvent) => boolean
}

const MIN_SIZE = 0.05
const HEIGHT_PER_PIXEL = 0.01

export function useBoxDraw({ boxName }: { boxName: (index: number) => string }): BoxDrawApi {
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const [step, setStep] = React.useState<BoxDrawStep>('idle')
  const [dimensions, setDimensions] = React.useState({ width: 0, depth: 0, height: 0 })
  const ghostRef = React.useRef<BoxDrawGhostState>({ visible: false, center: { x: 0, y: 0, z: 0 }, width: 0, depth: 0, height: 0 })
  const startRef = React.useRef<Vec3 | null>(null)
  const heightStartYRef = React.useRef(0)
  const [active, setActive] = React.useState(false)

  const cancel = React.useCallback(() => {
    setActive(false)
    setStep('idle')
    setDimensions({ width: 0, depth: 0, height: 0 })
    startRef.current = null
    ghostRef.current = { visible: false, center: { x: 0, y: 0, z: 0 }, width: 0, depth: 0, height: 0 }
  }, [])

  const start = React.useCallback(() => {
    setActive(true)
    setStep('idle')
    store.getState().setDrawMode(null)
    store.getState().setTransformMode(null)
    store.getState().clearSelection()
  }, [store])

  const commit = React.useCallback(() => {
    const ghost = ghostRef.current
    const state = store.getState()
    const index = state.activeScene().objects.filter((object) => object.type === 'cube').length + 1
    const width = Math.max(MIN_SIZE, ghost.width)
    const depth = Math.max(MIN_SIZE, ghost.depth)
    const height = Math.max(MIN_SIZE, ghost.height)
    const transform = frameTransform(multiplyFrames(invertFrame(sceneFrame(state.activeScene().sceneConfig)), localFrame({ position: ghost.center, rotation: { x: 0, y: 0, z: 0 }, scale: { x: width, y: height, z: depth } })))
    const id = state.addObject({
      name: boxName(index),
      type: 'cube',
      ...transform,
      visible: true,
      locked: false,
    })
    state.setTransformMode('translate')
    state.select({ objectId: id, multiObjectIds: [id] })
  }, [boxName, store])

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!active) return false
      if (event.button === 2) {
        event.preventDefault()
        cancel()
        return true
      }
      if (event.button !== 0) return false
      if (step === 'extruding_height') {
        commit()
        cancel()
        return true
      }
      const point = apiRef.current?.groundPointFromClient(event.clientX, event.clientY)
      if (!point) return true
      startRef.current = point
      ghostRef.current = { visible: true, center: point, width: 0, depth: 0, height: 0.02 }
      setStep('dragging_base')
      return true
    },
    [active, apiRef, cancel, commit, step],
  )

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!active) return false
      const start = startRef.current
      if (step === 'dragging_base' && start) {
        const point = apiRef.current?.groundPointFromClient(event.clientX, event.clientY)
        if (!point) return true
        let width = Math.abs(point.x - start.x)
        let depth = Math.abs(point.z - start.z)
        if (event.shiftKey) {
          const side = Math.max(width, depth)
          width = side
          depth = side
        }
        const signX = point.x >= start.x ? 1 : -1
        const signZ = point.z >= start.z ? 1 : -1
        const center = { x: start.x + (signX * width) / 2, y: start.y, z: start.z + (signZ * depth) / 2 }
        ghostRef.current = { visible: true, center, width, depth, height: 0.02 }
        setDimensions({ width, depth, height: 0 })
        return true
      }
      if (step === 'extruding_height') {
        const ghost = ghostRef.current
        let height = Math.max(MIN_SIZE, (heightStartYRef.current - event.clientY) * HEIGHT_PER_PIXEL)
        if (event.shiftKey) height = Math.max(ghost.width, ghost.depth)
        ghostRef.current = { ...ghost, height }
        setDimensions({ width: ghost.width, depth: ghost.depth, height })
        return true
      }
      return true
    },
    [active, apiRef, step],
  )

  const onPointerUp = React.useCallback(
    (event: React.PointerEvent): boolean => {
      if (!active) return false
      if (step === 'dragging_base') {
        const ghost = ghostRef.current
        if (ghost.width < MIN_SIZE || ghost.depth < MIN_SIZE) {
          ghostRef.current = { ...ghost, visible: false }
          setStep('idle')
          return true
        }
        heightStartYRef.current = event.clientY
        setStep('extruding_height')
        return true
      }
      return true
    },
    [active, step],
  )

  return { active, step, dimensions, ghostRef, start, cancel, onPointerDown, onPointerMove, onPointerUp }
}
