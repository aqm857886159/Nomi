import React from 'react'
import { clonePoseValue } from './scene3dMath'
import { MANNEQUIN_POSE_PRESETS } from './scene3dConstants'
import { poseMatchesPreset } from './scene3dMath'
import type { Scene3DObject, Scene3DSelection } from './scene3dTypes'

// 角色操控（possess）的临时 UI 态。照 cameraViewEditId 的范本：只活在 Scene3DFullscreen 的 UI state，
// 不持久化进 Scene3DState（退出即回到现有编排态，零持久副作用）。
export function useScene3DCharacterDrive({
  objects,
  selection,
  readOnly,
  patchObject,
  setSelection,
  setViewLocked,
  setFocusId,
  exitTrajectoryMode,
  exitCameraViewEdit,
}: {
  objects: Scene3DObject[]
  selection: Scene3DSelection
  readOnly: boolean
  patchObject: (id: string, patch: Partial<Scene3DObject>) => void
  setSelection: (selection: Scene3DSelection) => void
  setViewLocked: (locked: boolean) => void
  setFocusId: (id: string) => void
  exitTrajectoryMode: () => void
  exitCameraViewEdit: () => void
}): {
  possessId: string | null
  possessedObject: Scene3DObject | undefined
  selectedMannequin: Scene3DObject | undefined
  activePresetId: string | undefined
  canPossess: (selection: Scene3DSelection) => boolean
  enterPossess: (objectId: string) => void
  exitPossess: () => void
  applyActionPreset: (presetId: string) => void
} {
  const [possessId, setPossessId] = React.useState<string | null>(null)

  const possessedObject = possessId
    ? objects.find((object) => object.id === possessId)
    : undefined
  // 当前选中的「单个假人」（头部「操控」入口的出现条件）+ 被操控假人当前命中的动作预设（动作库高亮）。
  const selectedMannequin = selection?.type === 'object'
    ? objects.find((object) => object.id === selection.id && object.type === 'mannequin')
    : undefined
  const activePresetId = activeActionPresetId(possessedObject)

  // 只有「单个假人」可被操控（群众/几何/灯光/相机不可）。
  const canPossess = React.useCallback((selection: Scene3DSelection): boolean => {
    if (readOnly || !selection || selection.type !== 'object') return false
    const object = objects.find((candidate) => candidate.id === selection.id)
    return object?.type === 'mannequin'
  }, [objects, readOnly])

  const enterPossess = React.useCallback((objectId: string) => {
    if (readOnly) return
    const object = objects.find((candidate) => candidate.id === objectId)
    if (!object || object.type !== 'mannequin') return
    // 让出其它临时态 + 把相机 fly 锁成 edit（viewLocked=true），WASD 让给角色，杜绝键盘争用。
    exitTrajectoryMode()
    exitCameraViewEdit()
    setSelection({ type: 'object', id: objectId })
    setFocusId('')
    setViewLocked(true)
    setPossessId(objectId)
  }, [exitCameraViewEdit, exitTrajectoryMode, objects, readOnly, setFocusId, setSelection, setViewLocked])

  const exitPossess = React.useCallback(() => {
    setPossessId(null)
    setViewLocked(false)
  }, [setViewLocked])

  // 只在「被操控对象被删除/消失」时自动退出操控态。选择变化（含点空白画布清选、选中别的对象）
  // **不**退出——possess 是显式模式，靠「退出操控」按钮或删除对象才结束。否则 3D 视口里随手点一下
  // 空白（onPointerMissed→clearSelection）就会掉出操控，太脆（R13 真机走查实测到）。键盘争用由
  // viewLocked（绑 possessId）+ Scene3DControls.keyboardDisabled（绑 possessedObject）独立兜住，与选择无关。
  React.useEffect(() => {
    if (!possessId) return
    if (!possessedObject) {
      setPossessId(null)
      setViewLocked(false)
    }
  }, [possessId, possessedObject, setViewLocked])

  const applyActionPreset = React.useCallback((presetId: string) => {
    if (readOnly || !possessId) return
    const preset = MANNEQUIN_POSE_PRESETS.find((candidate) => candidate.id === presetId)
    if (!preset) return
    patchObject(possessId, { pose: clonePoseValue(preset.pose) })
  }, [patchObject, possessId, readOnly])

  return {
    possessId,
    possessedObject,
    selectedMannequin,
    activePresetId,
    canPossess,
    enterPossess,
    exitPossess,
    applyActionPreset,
  }
}

// 当前 pose 命中哪个动作预设（用于动作库高亮）。无匹配返回 undefined。
export function activeActionPresetId(object: Scene3DObject | undefined): string | undefined {
  if (!object) return undefined
  return MANNEQUIN_POSE_PRESETS.find((preset) => poseMatchesPreset(object.pose, preset))?.id
}
