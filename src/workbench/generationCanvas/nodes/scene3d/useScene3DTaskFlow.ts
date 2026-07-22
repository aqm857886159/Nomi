// 任务优先状态机（从 Scene3DFullscreen 抽出，防巨壳 R9）：任务切换 / 录制倒计时 /
// 主视图身份切换 / 全局状态句 / 任务 CTA / 原位重播。行为与原内联实现等价（P1 无并行版）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../../ui/toast'
import { cloneScene3DState } from './scene3dSerializer'
import { setScene3DPlayheadSeconds } from './trajectory'
import { cameraWithPlaybackPosition } from './scene3dPlayback'
import {
  scene3dStatusSentence,
  scene3dTaskCta,
  scene3dViewIdentityLabel,
  type Scene3DTaskMode,
} from './scene3dTaskMode'
import type { Scene3DCamera, Scene3DSelection, Scene3DState } from './scene3dTypes'
import type { useScene3DTrajectoryEditing } from './useScene3DTrajectoryEditing'

export function useScene3DTaskFlow({
  stateRef,
  selection,
  selectionRef,
  selectedCamera,
  cameraViewEditCamera,
  trajectory,
  trajectoryMode,
  takeRecorder,
  possessedObjectName,
  possessedCameraName,
  hasPossessTarget,
  enterPossess,
  setSelection,
  setState,
  setRightPanelOpen,
  openMovePresetHub,
  enterCameraViewEdit,
  exitCameraViewEdit,
  handleExportReferenceVideo,
  handleExportScreenshotCamera,
}: {
  stateRef: React.MutableRefObject<Scene3DState>
  selection: Scene3DSelection
  selectionRef: React.MutableRefObject<Scene3DSelection>
  selectedCamera: Scene3DCamera | undefined
  cameraViewEditCamera: Scene3DCamera | undefined
  trajectory: ReturnType<typeof useScene3DTrajectoryEditing>
  trajectoryMode: boolean
  takeRecorder: { isRecording: boolean; elapsedSeconds: number; startRecording: () => void; stopRecording: () => void }
  possessedObjectName: string | null
  possessedCameraName: string | null
  hasPossessTarget: boolean
  enterPossess: (objectId: string) => void
  setSelection: React.Dispatch<React.SetStateAction<Scene3DSelection>>
  setState: React.Dispatch<React.SetStateAction<Scene3DState>>
  setRightPanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  openMovePresetHub: () => void
  enterCameraViewEdit: (camera: Scene3DCamera) => void
  exitCameraViewEdit: () => void
  handleExportReferenceVideo: () => void
  handleExportScreenshotCamera: () => void
}) {
  const { t } = useTranslation()
  // 任务优先（2026-07-22 拍板样张）：当前任务持续可见，三任务共用同一套编辑器状态（无并行版）。
  const [taskMode, setTaskMode] = React.useState<Scene3DTaskMode>('compose')
  // 录制前 3 秒倒计时（审计 §6.3：给用户就位时间），Esc/再点 CTA 可取消。
  const [recordCountdown, setRecordCountdown] = React.useState<number | null>(null)
  const countdownTimerRef = React.useRef<number | null>(null)
  // 刚录完的 take 场景：完成卡「原位重播」把它载回编辑器播一遍，不先赶用户回画布。
  const lastTakeStateRef = React.useRef<Scene3DState | null>(null)

  const cancelRecordCountdown = React.useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    setRecordCountdown(null)
  }, [])

  const beginCountdownRecording = React.useCallback(() => {
    if (takeRecorder.isRecording || countdownTimerRef.current !== null) return
    if (!hasPossessTarget) {
      // effect-first：act 任务 CTA 直达——没在操控就替用户接管第一个角色。
      const firstMannequin = stateRef.current.objects.find((object) => object.type === 'mannequin')
      if (!firstMannequin) {
        toast(t('scene3d.taskFlow.addCharacterBeforeRecord'), 'warning')
        return
      }
      setSelection({ type: 'object', id: firstMannequin.id })
      enterPossess(firstMannequin.id)
    }
    setRecordCountdown(3)
    countdownTimerRef.current = window.setInterval(() => {
      setRecordCountdown((current) => {
        if (current === null) return null
        if (current <= 1) {
          if (countdownTimerRef.current !== null) {
            window.clearInterval(countdownTimerRef.current)
            countdownTimerRef.current = null
          }
          takeRecorder.startRecording()
          return null
        }
        return current - 1
      })
    }, 1000)
  }, [enterPossess, hasPossessTarget, setSelection, stateRef, takeRecorder, t])

  React.useEffect(() => {
    if (recordCountdown === null) return undefined
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      cancelRecordCountdown()
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [cancelRecordCountdown, recordCountdown])

  React.useEffect(() => () => {
    if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current)
  }, [])

  // —— 主视图身份切换（审计 §6.2：主画面必须明说是不是输出画面）——
  const handleToggleOutputView = React.useCallback(() => {
    if (cameraViewEditCamera) {
      exitCameraViewEdit()
      return
    }
    const camera = selectedCamera ?? stateRef.current.cameras[0]
    if (!camera) {
      toast(t('scene3d.taskFlow.addCameraForOutputView'), 'warning')
      return
    }
    if (selectionRef.current?.type !== 'camera' || selectionRef.current.id !== camera.id) {
      setSelection({ type: 'camera', id: camera.id })
    }
    enterCameraViewEdit(cameraWithPlaybackPosition(stateRef.current, camera, trajectory.playheadRef.current, trajectory.activeTrajectoryIds))
  }, [cameraViewEditCamera, enterCameraViewEdit, exitCameraViewEdit, selectedCamera, selectionRef, setSelection, stateRef, trajectory.activeTrajectoryIds, trajectory.playheadRef, t])

  // —— 任务 CTA：完成按钮就是产物动作（构图=相机截图 / 动作=录 take / 运镜=参考视频）——
  const handleTaskCta = React.useCallback(() => {
    if (taskMode === 'act') {
      if (recordCountdown !== null) {
        cancelRecordCountdown()
        return
      }
      if (takeRecorder.isRecording) takeRecorder.stopRecording()
      else beginCountdownRecording()
      return
    }
    if (taskMode === 'move') {
      handleExportReferenceVideo()
      return
    }
    handleExportScreenshotCamera()
  }, [beginCountdownRecording, cancelRecordCountdown, handleExportReferenceVideo, handleExportScreenshotCamera, recordCountdown, takeRecorder, taskMode])

  const handleTaskChange = React.useCallback((next: Scene3DTaskMode) => {
    setTaskMode(next)
    cancelRecordCountdown()
    if (next === 'move') {
      // 运镜任务：先确认相机画面再选怎么动——右栏落到「整运镜 > 预设」，默认选中第一台相机。
      setRightPanelOpen(true)
      openMovePresetHub()
      const camera = stateRef.current.cameras[0]
      if (camera && selectionRef.current?.type !== 'camera') setSelection({ type: 'camera', id: camera.id })
    }
  }, [cancelRecordCountdown, openMovePresetHub, selectionRef, setRightPanelOpen, setSelection, stateRef])

  // 原位重播刚录的 take（审计 §6.3：不先把用户赶回画布）——take 场景载回编辑器从头播一遍。
  const rememberLastTake = React.useCallback((recordedState: Scene3DState) => {
    lastTakeStateRef.current = recordedState
  }, [])
  const replayLastTake = React.useCallback(() => {
    const takeState = lastTakeStateRef.current
    if (!takeState) return
    setState(cloneScene3DState(takeState))
    trajectory.playheadRef.current = 0
    setScene3DPlayheadSeconds(0)
    trajectory.setTimelineOpen(true)
    trajectory.setIsPlaying(true)
  }, [setState, trajectory])

  const taskCtaLabel = recordCountdown !== null ? t('scene3d.taskFlow.cancelCountdown') : scene3dTaskCta(taskMode, takeRecorder.isRecording)
  const taskCtaTitle = taskMode === 'compose'
    ? t('scene3d.taskFlow.composeCtaTitle')
    : taskMode === 'act'
      ? (takeRecorder.isRecording ? t('scene3d.taskFlow.actCtaRecordingTitle') : t('scene3d.taskFlow.actCtaTitle'))
      : t('scene3d.taskFlow.moveCtaTitle')
  const viewIdentity = scene3dViewIdentityLabel(cameraViewEditCamera?.name ?? null, cameraViewEditCamera?.aspectRatio ?? null)
  const statusSentence = scene3dStatusSentence({
    recording: takeRecorder.isRecording,
    recordingSeconds: takeRecorder.elapsedSeconds,
    countdownRemaining: recordCountdown,
    possessedName: possessedObjectName,
    possessedCameraName: possessedCameraName,
    cameraViewEditName: cameraViewEditCamera?.name ?? null,
    trajectoryMode,
    isPlaying: trajectory.isPlaying,
    selectionName: selection?.type === 'object'
      ? stateRef.current.objects.find((object) => object.id === selection.id)?.name ?? null
      : selectedCamera?.name ?? null,
    selectionKind: selection?.type ?? null,
  })

  return {
    taskMode,
    recordCountdown,
    lastTakeStateRef,
    beginCountdownRecording,
    handleToggleOutputView,
    handleTaskCta,
    handleTaskChange,
    rememberLastTake,
    replayLastTake,
    taskCtaLabel,
    taskCtaTitle,
    viewIdentity,
    statusSentence,
  }
}
