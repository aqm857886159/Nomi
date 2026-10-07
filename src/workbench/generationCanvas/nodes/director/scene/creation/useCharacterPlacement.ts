/**
 * [INPUT]: 渚濊禆 react銆?./../DirectorEditorContext 鐨?useDirectorStoreApi銆?./ViewportApiContext 鐨?useViewportApi銆?./../model/vec3
 *          ../../model/sceneObjectGraph 鐨勫畬鏁撮瑙?TRS 涓栫晫鈫掑浘灞傝浆鎹紱Orbit 鐢熷懡鍛ㄦ湡鐢?DirectorViewport 缁熶竴鎷ユ湁
 * [OUTPUT]: 瀵瑰鎻愪緵 PlacementGhostState銆乽seCharacterPlacement锛堟斁缃ā寮忥細鍦伴潰骞界伒浣撹窡闅?鈫?鐐瑰嚮钀界偣 鈫?鎸変綇鎷栨嫿瀹氭湞鍚?鈫?鏉惧紑鍒涘缓锛? * [POS]: director/scene/creation 鐨勮鑹茶惤鍦版斁缃紙娓呭崟 搂2.2 V4a锛夛細DOM 鎸囬拡浜嬩欢鍦ㄨ鍙ｅ鍣ㄤ笂澶勭悊锛屽菇鐏典綋鐘舵€佹斁 ref 缁? *        PlacementGhost 姣忓抚璇诲彇锛涘彸閿?Esc 鍙栨秷銆傚垱寤鸿蛋 store.addObject锛堝悕瀛椼€岃鑹睳銆嶃€乸osePreset tpose銆佺郴缁熸ā鍨嬶紱妯℃澘鏉ヨ嚜 model/defaultCharacter锛夛紱
 *        甯?crowd 鍙傛暟鏃惰惤鐐规敼寤虹兢浼楃粍锛坰tore.batchCreateCrowd锛屽悓涓€涓粯璁よ鑹诧級銆? * [PROTOCOL]: 鍙樻洿鏃舵洿鏂版澶撮儴锛岀劧鍚庢鏌?CLAUDE.md
 */
import React from 'react'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import { defaultCharacterInput, type CharacterGender } from '../../model/defaultCharacter'
import type { Vec3 } from '../../model/directorTypes'
import type { CrowdSpec } from '../../model/storeEntityActions'
import { RAD_TO_DEG } from '../../model/vec3'
import { frameTransform, invertFrame, localFrame, multiplyFrames, sceneFrame } from '../../model/sceneObjectGraph'
import { useViewportApi } from '../ViewportApiContext'

export type PlacementGender = CharacterGender

/** 缇や紬鏀剧疆锛氳惤鐐瑰寤轰竴涓兢浼楃粍锛堝弬鏁版潵鑷€岋紜鈫掕鑹测啋缇や紬銆嶆诞灞傦級 */
export type CrowdPlacementSpec = Pick<CrowdSpec, 'rows' | 'cols' | 'spacing' | 'actionId'>

export type PlacementGhostState = {
  visible: boolean
  position: Vec3
  headingDeg: number
  dragging: boolean
  dragTarget: Vec3 | null
}

// 鐢?/ 濂崇洰鍓嶆槸鍚屼竴涓粯璁?UAL 浜哄伓锛屽彧宸鑹诧紙UAL 鍙湁涓€涓腑鎬т汉鍋讹級
export type CharacterPlacementApi = {
  active: boolean
  gender: PlacementGender | null
  headingDeg: number
  ghostRef: React.MutableRefObject<PlacementGhostState>
  /** 鏈?crowd = 鏀剧疆缇や紬锛堝菇鐏典綋鍙ず鎰忚惤鐐癸紝钀藉湴寤轰竴涓兢浼楃粍锛夛紱娌℃湁 = 鏀句竴涓鑹?*/
  crowd: CrowdPlacementSpec | null
  start: (gender: PlacementGender, crowd?: CrowdPlacementSpec) => void
  cancel: () => void
  onPointerDown: (event: React.PointerEvent) => boolean
  onPointerMove: (event: React.PointerEvent) => boolean
  onPointerUp: (event: React.PointerEvent) => boolean
  onPointerLeave: () => void
}

export function useCharacterPlacement({ characterName, crowdNames }: { characterName: (index: number) => string; crowdNames: { group: string; member: string } }): CharacterPlacementApi {
  const store = useDirectorStoreApi()
  const apiRef = useViewportApi()
  const [gender, setGender] = React.useState<PlacementGender | null>(null)
  const [crowd, setCrowd] = React.useState<CrowdPlacementSpec | null>(null)
  const [headingDeg, setHeadingDeg] = React.useState(0)
  const ghostRef = React.useRef<PlacementGhostState>({ visible: false, position: { x: 0, y: 0, z: 0 }, headingDeg: 0, dragging: false, dragTarget: null })
  const anchorRef = React.useRef<Vec3 | null>(null)

  const cancel = React.useCallback(() => {
    setGender(null)
    setCrowd(null)
    setHeadingDeg(0)
    anchorRef.current = null
    ghostRef.current = { visible: false, position: { x: 0, y: 0, z: 0 }, headingDeg: 0, dragging: false, dragTarget: null }
  }, [])

  const start = React.useCallback(
    (nextGender: PlacementGender, nextCrowd?: CrowdPlacementSpec) => {
      setGender(nextGender)
      setCrowd(nextCrowd ?? null)
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
      const transform = frameTransform(multiplyFrames(invertFrame(sceneFrame(state.activeScene().sceneConfig)), localFrame({ position, rotation: { x: 0, y: heading, z: 0 }, scale: { x: 1, y: 1, z: 1 } })))
      if (crowd) {
        if (state.batchCreateCrowd({ ...crowd, transform, groupName: crowdNames.group, memberName: crowdNames.member })) {
          state.setTransformMode('translate')
        }
        return
      }
      const index = state.activeScene().objects.filter((object) => object.type === 'character').length + 1
      const id = state.addObject(defaultCharacterInput(gender, characterName(index), transform))
      state.setTransformMode('translate')
      state.select({ objectId: id, multiObjectIds: [id] })
    },
    [characterName, crowd, crowdNames.group, crowdNames.member, gender, store],
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

  return { active: gender !== null, gender, crowd, headingDeg, ghostRef, start, cancel, onPointerDown, onPointerMove, onPointerUp, onPointerLeave }
}
