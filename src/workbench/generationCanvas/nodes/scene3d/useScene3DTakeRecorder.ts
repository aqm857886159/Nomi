import React from 'react'
import { toast } from '../../../../ui/toast'
import {
  buildRecordedTakeScene,
  recordingDurationSeconds,
  type RecordedTake,
  type TakeSample,
} from './takeRecording'
import type { Scene3DState, Scene3DVector3 } from './scene3dTypes'

// 录 take（S2）的临时态 hook。和 useScene3DCharacterDrive 同范本：只活在 Scene3DFullscreen 的 UI state，
// 不持久化进 Scene3DState。录制 = 在 possess 态上叠加：边操控边按时间戳采被操控角色世界位置 + 机位，
// 「停止」时把样本转成 trajectory（takeRecording 纯函数）→ 组出可被现有离屏捕获管线回放的 Scene3DState
// → 交给 onRecorded（由 Scene3DEditor 建 scene3d 节点 + 打 cameraMoveAutoCapture，复用 AI 运镜整条管线）。
//
// 采样由 <Scene3DTakeSampler>（Canvas 内 useFrame）调 sampleCharacter/sampleCamera 喂进来；本 hook 只
// 管 buffer + 状态机 + 停止时的纯转换，不碰 three（保持可单测的边界清晰，R9）。

const SAMPLE_INTERVAL_MS = 50 // 采样节流：20Hz，足够还原走位曲线，又不撑爆 buffer/离屏帧数

export type TakeRecorder = {
  isRecording: boolean
  elapsedSeconds: number
  /** 当前是否可录（possess 中且未在录） */
  canRecord: boolean
  startRecording: () => void
  stopRecording: () => void
  /** 采样接口（供 Canvas 内 sampler 调，自带节流，按 wall-clock 时间戳） */
  sampleCharacter: (position: Scene3DVector3) => void
  sampleCamera: (position: Scene3DVector3) => void
}

export function useScene3DTakeRecorder({
  possessId,
  readOnly,
  stateRef,
  onRecorded,
}: {
  possessId: string | null
  readOnly: boolean
  stateRef: React.MutableRefObject<Scene3DState>
  onRecorded: (recordedState: Scene3DState) => void
}): TakeRecorder {
  const [isRecording, setIsRecording] = React.useState(false)
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0)

  const startMsRef = React.useRef(0)
  const characterSamplesRef = React.useRef<TakeSample[]>([])
  const cameraSamplesRef = React.useRef<TakeSample[]>([])
  const lastCharacterSampleMsRef = React.useRef(0)
  const lastCameraSampleMsRef = React.useRef(0)
  const tickRef = React.useRef<number | null>(null)

  const canRecord = !readOnly && Boolean(possessId) && !isRecording

  const clearTick = React.useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  const startRecording = React.useCallback(() => {
    if (readOnly || !possessId || isRecording) return
    characterSamplesRef.current = []
    cameraSamplesRef.current = []
    const now = performance.now()
    startMsRef.current = now
    lastCharacterSampleMsRef.current = 0
    lastCameraSampleMsRef.current = 0
    setElapsedSeconds(0)
    setIsRecording(true)
    clearTick()
    // 计时器只驱动 UI（REC 秒数）；样本时间戳走 performance.now()，与计时器无关（帧准不靠墙钟动画）。
    tickRef.current = window.setInterval(() => {
      setElapsedSeconds((performance.now() - startMsRef.current) / 1000)
    }, 100)
  }, [clearTick, isRecording, possessId, readOnly])

  const sampleCharacter = React.useCallback((position: Scene3DVector3) => {
    if (!isRecording) return
    const now = performance.now()
    if (now - lastCharacterSampleMsRef.current < SAMPLE_INTERVAL_MS && characterSamplesRef.current.length > 0) return
    lastCharacterSampleMsRef.current = now
    characterSamplesRef.current.push({ time: now, position: [...position] as Scene3DVector3 })
  }, [isRecording])

  const sampleCamera = React.useCallback((position: Scene3DVector3) => {
    if (!isRecording) return
    const now = performance.now()
    if (now - lastCameraSampleMsRef.current < SAMPLE_INTERVAL_MS && cameraSamplesRef.current.length > 0) return
    lastCameraSampleMsRef.current = now
    cameraSamplesRef.current.push({ time: now, position: [...position] as Scene3DVector3 })
  }, [isRecording])

  const stopRecording = React.useCallback(() => {
    if (!isRecording) return
    clearTick()
    setIsRecording(false)
    const endMs = performance.now()
    const objectId = possessId
    const characterSamples = characterSamplesRef.current
    const cameraSamples = cameraSamplesRef.current
    setElapsedSeconds(0)
    if (!objectId) return
    const durationSeconds = recordingDurationSeconds(startMsRef.current, endMs)
    const take: RecordedTake = { possessedObjectId: objectId, characterSamples, cameraSamples, durationSeconds }
    const recordedState = buildRecordedTakeScene(stateRef.current, take)
    if (!recordedState) {
      toast('没录到走位（角色全程没移动），请操控角色走动后再录', 'warning')
      return
    }
    onRecorded(recordedState)
  }, [clearTick, isRecording, onRecorded, possessId, stateRef])

  // 退出操控 / 卸载时若还在录 → 静默收尾，不留悬挂计时器。
  React.useEffect(() => {
    if (!possessId && isRecording) {
      clearTick()
      setIsRecording(false)
      setElapsedSeconds(0)
    }
  }, [clearTick, isRecording, possessId])

  React.useEffect(() => () => clearTick(), [clearTick])

  return {
    isRecording,
    elapsedSeconds,
    canRecord,
    startRecording,
    stopRecording,
    sampleCharacter,
    sampleCamera,
  }
}
