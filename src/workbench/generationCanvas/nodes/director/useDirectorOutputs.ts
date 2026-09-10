/**
 * [INPUT]: 依赖 react、react-i18next、../../../../ui/toast、./bridge/persistOutputs 的 persistDirectorScreenshot / persistDirectorFramesVideo（落盘桥）、
 *          ./DirectorEditorContext、./scene/ViewportApiContext 的 ViewportApiRef 类型、./model/exportSize、./model/programCamera 的 programCameraIdAt、./model/timeGrid 的 entityClips、
 *          ./model/cameraLens 的 fovToFocalMm、./timeline/timelineCommands 的 seekTo、./OutputsContext 的类型
 * [OUTPUT]: 对外提供 useDirectorOutputs({ apiRef, ownerNodeId, onSendToCanvas }) → DirectorOutputsApi
 * [POS]: director 根的出片编排（清单 §4.7 P1/P2）：截图 = 当前视角（POV 用该机位，否则视口相机）在导出尺寸离屏渲染 → 烧标签 → PNG → 资产桥 → outputs.screenshots；
 *        录制 = 前置检查（有片段 / 有机位）→ 逐帧 seek + 等两帧让求值与骨骼管线跑到位 → 节目机位（无覆盖 = 黑场）→ 帧 dataURL[] → 帧转视频桥 → outputs.videos；任务锁跨采样与编码，关闭/取消后的迟到结果不登记。
 *        像素来自 ViewportApi.captureFrame（scene/capture），这里只做流程、命名、持久化与提示。无桌面运行时：截图退回 blob URL（仅本会话），录制明说无法编码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../../ui/toast'
import { persistDirectorFramesVideo, persistDirectorScreenshot } from './bridge/persistOutputs'
import { useDirectorStoreApi } from './DirectorEditorContext'
import { fovToFocalMm } from './model/cameraLens'
import { DIRECTOR_EXPORT_FPS, exportDimensions, exportFrameCount } from './model/exportSize'
import { programCameraIdAt } from './model/programCamera'
import { entityClips } from './model/timeGrid'
import type { DirectorOutput, DirectorOutputsApi } from './OutputsContext'
import type { ViewportApiRef } from './scene/ViewportApiContext'
import { seekTo } from './timeline/timelineCommands'

const DEFAULT_OWNER = 'director-lab'

function nextFrames(count: number = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
    step(count)
  })
}

function timeStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export function useDirectorOutputs({ apiRef, ownerNodeId, onSendToCanvas }: { apiRef: ViewportApiRef; ownerNodeId?: string; onSendToCanvas?: (output: DirectorOutput) => void }): DirectorOutputsApi {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const operationRef = React.useRef<{ cancelled: boolean } | null>(null)
  const mountedRef = React.useRef(true)
  const owner = ownerNodeId ?? DEFAULT_OWNER

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (operationRef.current) operationRef.current.cancelled = true
    }
  }, [])

  const exportSize = React.useCallback(() => {
    const state = store.getState()
    const viewport = apiRef.current?.getViewportSize() ?? { width: 16, height: 9 }
    return exportDimensions(state.project.exportRatio, state.project.exportResolution, viewport.width / Math.max(1, viewport.height))
  }, [apiRef, store])

  const takeScreenshot = React.useCallback(async (): Promise<boolean> => {
    const api = apiRef.current
    if (!api) return false
    const state = store.getState()
    const scene = state.activeScene()
    const camera = state.activeCameraId !== 'free' ? scene.cameras.find((item) => item.id === state.activeCameraId) : undefined
    const { width, height } = exportSize()
    const index = state.project.outputs.screenshots.length + 1
    const name = camera
      ? t('director.timeline.screenshotNameCamera', { camera: camera.name, mm: fovToFocalMm(camera.fov), index })
      : t('director.timeline.screenshotNameFree', { index })
    try {
      const frame = await api.captureFrame({ cameraId: camera ? camera.id : 'free', width, height, burnLabels: true })
      if (!mountedRef.current) return false
      if (!frame) throw new Error('capture failed')
      const persisted = await persistDirectorScreenshot(frame.dataUrl, owner, name)
      if (!mountedRef.current) return false
      // 无桌面运行时：V1 桥会把 dataURL 原样回吐；产物只存句柄（禁 base64 进工程）→ 退回本会话的 blob URL 并明说
      const assetUrl = persisted.localOnly ? URL.createObjectURL(frame.blob) : persisted.url
      store.getState().addOutputImage({ name, cameraName: camera?.name ?? '', assetUrl })
      toast(persisted.localOnly ? t('director.timeline.screenshotTemporary') : t('director.timeline.screenshotDone', { name }), persisted.localOnly ? 'info' : 'success')
      return true
    } catch {
      if (mountedRef.current) toast(t('director.timeline.screenshotFailed'), 'error')
      return false
    }
  }, [apiRef, exportSize, owner, store, t])

  const cancelRecording = React.useCallback(() => {
    if (operationRef.current) operationRef.current.cancelled = true
  }, [])

  const recordVideo = React.useCallback(async (): Promise<boolean> => {
    const api = apiRef.current
    const state = store.getState()
    if (!api || !mountedRef.current || operationRef.current || state.videoRecording || state.recording) return false
    const scene = state.activeScene()
    const hasClips = [...scene.objects, ...scene.cameras].some((entity) => entityClips(entity).length > 0)
    if (!hasClips) {
      toast(t('director.timeline.recordVideoNeedsClips'), 'warning')
      return false
    }
    const hasProgramCamera = scene.cameras.some((camera) => (camera.trajectoryClips?.length ?? 0) > 0 || (camera.closeupClips?.length ?? 0) > 0)
    if (!hasProgramCamera) {
      toast(t('director.timeline.recordVideoNeedsCamera'), 'warning')
      return false
    }
    const total = exportFrameCount(state.contentEndSeconds())
    const { width, height } = exportSize()
    const resumeTime = state.timeline.currentTime
    const operation = { cancelled: false }
    operationRef.current = operation
    const cancelled = () => operation.cancelled || !mountedRef.current || store.getState().activeScene().id !== scene.id
    const reportCancelled = () => {
      if (mountedRef.current) toast(t('director.timeline.recordVideoCancelled'), 'info')
      return false
    }
    state.setTimelineContext({ isPlaying: false })
    state.setVideoRecording({ current: 0, total })
    const frames: string[] = []
    try {
      for (let index = 0; index < total; index += 1) {
        if (cancelled()) return reportCancelled()
        const time = index / DIRECTOR_EXPORT_FPS
        seekTo(store, time)
        await nextFrames(2)
        if (cancelled()) return reportCancelled()
        const current = store.getState().activeScene()
        const cameraId = programCameraIdAt(time, current.cameras, current.timelineTrackOrder)
        const frame = await api.captureFrame({ cameraId: cameraId ?? 'black', width, height, burnLabels: true })
        if (cancelled()) return reportCancelled()
        if (!frame) throw new Error('capture failed')
        frames.push(frame.dataUrl)
        store.getState().setVideoRecording({ current: index + 1, total })
      }
      const name = t('director.timeline.videoName', { stamp: timeStamp() })
      const persisted = await persistDirectorFramesVideo(frames, owner, name, DIRECTOR_EXPORT_FPS)
      if (cancelled()) return reportCancelled()
      if (persisted.localOnly || !persisted.url) {
        toast(t('director.timeline.recordVideoNoBridge', { frames: frames.length }), 'warning')
        return false
      }
      store.getState().addOutputVideo({ name, assetUrl: persisted.url, width, height, duration: frames.length / DIRECTOR_EXPORT_FPS })
      toast(t('director.timeline.recordVideoDone', { name, frames: frames.length }), 'success')
      return true
    } catch {
      if (cancelled()) return reportCancelled()
      toast(t('director.timeline.recordVideoFailed'), 'error')
      return false
    } finally {
      operationRef.current = null
      store.getState().setVideoRecording(null)
      if (mountedRef.current && store.getState().activeScene().id === scene.id) seekTo(store, resumeTime)
    }
  }, [apiRef, exportSize, owner, store, t])

  const sendToCanvas = React.useMemo(() => {
    if (!onSendToCanvas) return null
    return (output: DirectorOutput) => {
      onSendToCanvas(output)
      toast(t('director.timeline.outputSent', { name: output.name }), 'success')
    }
  }, [onSendToCanvas, t])

  return React.useMemo(() => ({ takeScreenshot, recordVideo, cancelRecording, sendToCanvas }), [cancelRecording, recordVideo, sendToCanvas, takeScreenshot])
}
