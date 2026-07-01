import React from 'react'
import { clonePoseValue } from './scene3dMath'
import { LOCOMOTION_CLIP_IDLE, MANNEQUIN_POSE_PRESETS } from './scene3dConstants'
import { poseMatchesPreset } from './scene3dMath'
import { shouldRecordLocomotionResume } from './scene3dCharacterDrive'
import { activePossessTarget, type PossessTarget } from './scene3dPossessTarget'
import type { Scene3DCamera, Scene3DObject, Scene3DSelection } from './scene3dTypes'

// 角色操控（possess）的临时 UI 态。照 cameraViewEditId 的范本：只活在 Scene3DFullscreen 的 UI state，
// 不持久化进 Scene3DState（退出即回到现有编排态，零持久副作用）。
export function useScene3DCharacterDrive({
  objects,
  cameras,
  selection,
  readOnly,
  patchObject,
  setSelection,
  setViewLocked,
  setFocusId,
  exitTrajectoryMode,
  enterCameraViewEdit,
  exitCameraViewEdit,
  onLocomotionResume,
  onBeforeExit,
}: {
  objects: Scene3DObject[]
  cameras: Scene3DCamera[]
  selection: Scene3DSelection
  readOnly: boolean
  patchObject: (id: string, patch: Partial<Scene3DObject>) => void
  setSelection: (selection: Scene3DSelection) => void
  setViewLocked: (locked: boolean) => void
  setFocusId: (id: string) => void
  exitTrajectoryMode: () => void
  // 操控相机 = 进「取景态」（编辑器相机 fly + CameraViewEditController 实时写回该相机位姿，P1 复用既有机制）。
  enterCameraViewEdit: (cameraData: Scene3DCamera) => void
  exitCameraViewEdit: () => void
  // #4：locomotion 从静态动作('')恢复到 walk/run/idle 时回调（录制器借此补 base 关键帧，治「蹲到片尾」）。
  onLocomotionResume?: () => void
  // #A：退出操控（角色/相机，任何触发路径——按钮/关闭编辑器/对象被删）前的收尾钩子。录制器借此在 possessTarget
  // 真正变 null 之前把「正在进行的录制」flush 成 take（治「退出操控吞掉录制」，见 useScene3DTakeRecorder）。
  // 与 onLocomotionResume 同一个 ref 转发范本，破 drive↔recorder 的初始化先后环（recorder 依赖 drive 的
  // possessTarget，drive 反过来要在退出时通知 recorder，只能用 ref 转发，不能互相当参数传）。
  onBeforeExit?: () => void
}): {
  possessId: string | null
  possessedObject: Scene3DObject | undefined
  selectedMannequin: Scene3DObject | undefined
  activePresetId: string | undefined
  locomotionClip: string
  setLocomotionClip: (clip: string) => void
  canPossess: (selection: Scene3DSelection) => boolean
  enterPossess: (objectId: string) => void
  exitPossess: () => void
  // 返回实际生效的 presetId（toggle 命中已激活预设时会是 'standing'，非原始点击那个，见实现注释）。
  applyActionPreset: (presetId: string) => string
  // 相机操控（运镜）：与角色操控互斥，同一套「操控」动词（P4）。
  cameraPossessId: string | null
  possessedCamera: Scene3DCamera | undefined
  selectedCamera: Scene3DCamera | undefined
  enterCameraPossess: (cameraId: string) => void
  exitCameraPossess: () => void
  // 统一「当前操控目标」（角色/相机/无），互斥单值。供录制器/控制器判走哪条路径。
  possessTarget: PossessTarget
} {
  const [possessId, setPossessId] = React.useState<string | null>(null)
  const [cameraPossessId, setCameraPossessId] = React.useState<string | null>(null)
  // 被操控假人当前 locomotion clip（idle/walk/run），由 CharacterDriveController 按速度上抛。
  // 仅在「桶变化」时更新（rare），不引发渲染风暴。进/退操控都归位 idle。
  const [locomotionClip, setLocomotionClipState] = React.useState<string>(LOCOMOTION_CLIP_IDLE)
  // onLocomotionResume 放 ref，wrap 不随回调身份变（CharacterDriveController 拿到稳定的 setLocomotionClip）。
  const onLocomotionResumeRef = React.useRef(onLocomotionResume)
  onLocomotionResumeRef.current = onLocomotionResume
  // #A：退出前收尾钩子同样放 ref（见形参处注释）。
  const onBeforeExitRef = React.useRef(onBeforeExit)
  onBeforeExitRef.current = onBeforeExit

  // 包一层：CharacterDriveController 上抛桶变化时，若是「从静态动作('')恢复到走/跑」→ 先通知录制器补 base
  // 关键帧（#4），再落 state。其余变化（walk↔run、进/退归 idle）只落 state。判定走纯函数，单一真相。
  const setLocomotionClip = React.useCallback((clip: string) => {
    setLocomotionClipState((prev) => {
      if (shouldRecordLocomotionResume(prev, clip)) onLocomotionResumeRef.current?.()
      return clip
    })
  }, [])

  const possessedObject = possessId
    ? objects.find((object) => object.id === possessId)
    : undefined
  const possessedCamera = cameraPossessId
    ? cameras.find((camera) => camera.id === cameraPossessId)
    : undefined
  // 当前选中的「单个假人」（头部「操控」入口的出现条件）+ 被操控假人当前命中的动作预设（动作库高亮）。
  const selectedMannequin = selection?.type === 'object'
    ? objects.find((object) => object.id === selection.id && object.type === 'mannequin')
    : undefined
  // 当前选中的「单个相机」（「操控镜头」入口的出现条件）。
  const selectedCamera = selection?.type === 'camera'
    ? cameras.find((camera) => camera.id === selection.id)
    : undefined
  const activePresetId = activeActionPresetId(possessedObject)
  const possessTarget = activePossessTarget(possessId, cameraPossessId)

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
    // 让出其它临时态（含相机操控，互斥）+ 把相机 fly 锁成 edit（viewLocked=true），WASD 让给角色，杜绝键盘争用。
    exitTrajectoryMode()
    exitCameraViewEdit()
    setCameraPossessId(null)
    setSelection({ type: 'object', id: objectId })
    setFocusId('')
    setViewLocked(true)
    setLocomotionClipState(LOCOMOTION_CLIP_IDLE)
    setPossessId(objectId)
  }, [exitCameraViewEdit, exitTrajectoryMode, objects, readOnly, setFocusId, setSelection, setViewLocked])

  const exitPossess = React.useCallback(() => {
    // #A：先收尾（若正在录 take 则 flush 出片），此时 possessId 还没清，possessTarget 仍指向真实目标，
    // 录制器读得到「谁被操控」。stopRecording 幂等——非录制态调用是安全 no-op（见 useScene3DTakeRecorder）。
    onBeforeExitRef.current?.()
    setPossessId(null)
    setViewLocked(false)
    setLocomotionClipState(LOCOMOTION_CLIP_IDLE)
  }, [setViewLocked])

  // 操控相机（运镜）：与角色互斥。进入 = 退角色操控 + 进「取景态」（编辑器相机 fly + 实时写回该相机位姿），
  // 这样 WASD 飞的就是这台被选中的场景相机，录的就是它的运镜（复用 enterCameraViewEdit 既有机制，不另写移动）。
  const enterCameraPossess = React.useCallback((cameraId: string) => {
    if (readOnly) return
    const camera = cameras.find((candidate) => candidate.id === cameraId)
    if (!camera) return
    exitTrajectoryMode()
    setPossessId(null)
    setLocomotionClipState(LOCOMOTION_CLIP_IDLE)
    enterCameraViewEdit(camera)
    setCameraPossessId(cameraId)
  }, [cameras, enterCameraViewEdit, exitTrajectoryMode, readOnly])

  const exitCameraPossess = React.useCallback(() => {
    onBeforeExitRef.current?.() // #A：同 exitPossess，先 flush 录制中的运镜 take。
    setCameraPossessId(null)
    exitCameraViewEdit()
  }, [exitCameraViewEdit])

  // 只在「被操控对象被删除/消失」时自动退出操控态。选择变化（含点空白画布清选、选中别的对象）
  // **不**退出——possess 是显式模式，靠「退出操控」按钮或删除对象才结束。否则 3D 视口里随手点一下
  // 空白（onPointerMissed→clearSelection）就会掉出操控，太脆（R13 真机走查实测到）。键盘争用由
  // viewLocked（绑 possessId）+ Scene3DControls.keyboardDisabled（绑 possessedObject）独立兜住，与选择无关。
  React.useEffect(() => {
    if (!possessId) return
    if (!possessedObject) {
      // #A：对象消失前 possessTarget 仍是它（本 effect 触发时 possessId 还没清），录制器还来得及 flush。
      onBeforeExitRef.current?.()
      setPossessId(null)
      setViewLocked(false)
      setLocomotionClipState(LOCOMOTION_CLIP_IDLE)
    }
  }, [possessId, possessedObject, setViewLocked])

  // 被操控相机被删除/消失 → 自动退出相机操控（同角色：显式模式，删除对象才被动结束）。
  React.useEffect(() => {
    if (!cameraPossessId) return
    if (!possessedCamera) {
      onBeforeExitRef.current?.() // #A：同上，删除前先 flush 运镜录制。
      setCameraPossessId(null)
      exitCameraViewEdit()
    }
  }, [cameraPossessId, exitCameraViewEdit, possessedCamera])

  // #B「点了摘不掉」根因修法：再点一次已激活的那个预设 = 顶成「站立」（toggle），不用用户特地去找站立按钮。
  // 单一收口在这里（而不是 Scene3DFullscreen 的 handleApplyActionPreset 里再判一遍）——P1，同一个 toggle
  // 判断只活一处。返回「实际生效的 presetId」，调用方（录制器 recordPoseEvent）据此打点，不是原始点击那个，
  // 否则录出来的动作事件和实际显示的姿势对不上。
  const applyActionPreset = React.useCallback((presetId: string): string => {
    if (readOnly || !possessId) return presetId
    const effectivePresetId = activePresetId === presetId ? 'standing' : presetId
    const preset = MANNEQUIN_POSE_PRESETS.find((candidate) => candidate.id === effectivePresetId)
    if (!preset) return presetId
    patchObject(possessId, { pose: clonePoseValue(preset.pose) })
    // 点静态动作（下蹲/挥手/坐下/站立）→ 让出 locomotion 动画，显示这个静态姿势（clip='' 走 Mannequin 静态 pose 路径）。
    // 再次 WASD 移动时 CharacterDriveController 会把 locomotion 桶上抛回 walk/run，自动接管迈腿动画。
    setLocomotionClipState('')
    return effectivePresetId
  }, [activePresetId, patchObject, possessId, readOnly])

  return {
    possessId,
    possessedObject,
    selectedMannequin,
    activePresetId,
    locomotionClip,
    setLocomotionClip,
    canPossess,
    enterPossess,
    exitPossess,
    applyActionPreset,
    cameraPossessId,
    possessedCamera,
    selectedCamera,
    enterCameraPossess,
    exitCameraPossess,
    possessTarget,
  }
}

// 当前 pose 命中哪个动作预设（用于动作库高亮）。无匹配返回 undefined。
export function activeActionPresetId(object: Scene3DObject | undefined): string | undefined {
  if (!object) return undefined
  return MANNEQUIN_POSE_PRESETS.find((preset) => poseMatchesPreset(object.pose, preset))?.id
}
