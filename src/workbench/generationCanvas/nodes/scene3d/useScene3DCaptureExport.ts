// 出片捕获动作（从 Scene3DFullscreen / useScene3DFullscreenActions 抽出，防巨壳 R9）：
// 视口截图、相机截图、运镜首尾帧离屏导出——「把画面变成产物」的动作集中一处。
import React from 'react'
import i18n from '../../../../i18n'
import { toast } from '../../../../ui/toast'
import {
  type CaptureApi,
  type Scene3DCamera,
  type Scene3DCaptureResult,
  type Scene3DState,
} from './scene3dTypes'
import { cameraWithPlaybackPosition } from './scene3dPlayback'
import { Scene3DTrajectoryCapture, type CameraMoveCaptureResult } from './Scene3DTrajectoryCapture'
import { toastPickCameraFirst } from './useScene3DFullscreenActions'
import type { useScene3DTrajectoryEditing } from './useScene3DTrajectoryEditing'

// 视口/相机截图（live 场景 captureScene——editor-only 对象已由 SCENE3D_EDITOR_ONLY_FLAG 隐藏）。
// 返回是否截成：出片面板据此弹截图完成卡（产物落在被编辑器盖住的画布上，无卡=用户以为没发生）。
export function useScene3DCaptureActions({
  stateRef,
  captureApiRef,
  trajectory,
  selectedCamera,
  onScreenshot,
  onPickCamera,
}: {
  stateRef: React.MutableRefObject<Scene3DState>
  captureApiRef: React.MutableRefObject<CaptureApi | null>
  trajectory: ReturnType<typeof useScene3DTrajectoryEditing>
  selectedCamera: Scene3DCamera | undefined
  onScreenshot: (capture: Scene3DCaptureResult) => void
  onPickCamera: (cameraId: string) => void
}): { captureViewport: () => boolean; captureSelectedCamera: () => boolean } {
  const captureViewport = React.useCallback((): boolean => {
    const capture = captureApiRef.current?.captureViewport()
    if (!capture) {
      toast(i18n.t('scene3d.fullscreen.screenshotFailed'), 'error')
      return false
    }
    onScreenshot(capture)
    return true
  }, [captureApiRef, onScreenshot])

  const captureSelectedCamera = React.useCallback((): boolean => {
    if (!selectedCamera) {
      toastPickCameraFirst(stateRef.current.cameras[0], onPickCamera)
      return false
    }
    const captureCamera = cameraWithPlaybackPosition(
      stateRef.current,
      selectedCamera,
      trajectory.playheadRef.current,
      trajectory.activeTrajectoryIds,
    )
    const capture = captureApiRef.current?.captureCamera(captureCamera)
    if (!capture) {
      toast(i18n.t('scene3d.fullscreen.cameraScreenshotFailed'), 'error')
      return false
    }
    onScreenshot(capture)
    return true
  }, [captureApiRef, onPickCamera, onScreenshot, selectedCamera, stateRef, trajectory.activeTrajectoryIds, trajectory.playheadRef])

  return { captureViewport, captureSelectedCamera }
}

// 运镜首尾帧导出：走与 MP4 参考视频**同一条**离屏采样管线（Scene3DTrajectoryCapture，
// frameCount=2 → frameTimes 恰为运镜段两端点，与 MP4 首/尾帧同 t、同场景内容、同相机位姿函数），
// still-frame 模式用全分辨率（不套 720p cap）。离屏场景按构造不含 gizmo/网格/轨迹点——
// 2026-07-22 审计 P0（live 截图把 TransformControls 烧进成片、构图与 MP4 不一致）在此根治：
// 不再挪 live 播放头、不再走 live captureCamera（P1 删旧路径）。
export function useScene3DMoveFrameExport({
  stateRef,
  onScreenshot,
}: {
  stateRef: React.MutableRefObject<Scene3DState>
  onScreenshot: (capture: Scene3DCaptureResult) => void
}): {
  exportCameraMoveFrames: (cameraId: string) => Promise<void>
  /** 有导出请求时挂在编辑器 JSX 里的隐藏离屏捕获元素 */
  moveFrameCapture: React.ReactElement | null
} {
  const [request, setRequest] = React.useState<{ state: Scene3DState; cameraName: string; attempt: number } | null>(null)

  const exportCameraMoveFrames = React.useCallback(async (cameraId: string) => {
    const current = stateRef.current
    const camera = current.cameras.find((candidate) => candidate.id === cameraId)
    if (!camera) return
    const hasBinding = current.trajectoryBindings.some((binding) => (
      binding.objects.some((bound) => bound.objectId === cameraId)
    ))
    if (!hasBinding) {
      toast(i18n.t('scene3d.fullscreen.cameraHasNoMove'), 'warning')
      return
    }
    // 与 MP4 同口径：离屏采样器恒用 cameras[0]（同 takeRecording 的重排），把选定相机排到首位。
    setRequest((previous) => ({
      state: { ...current, cameras: [camera, ...current.cameras.filter((candidate) => candidate.id !== cameraId)] },
      cameraName: camera.name,
      attempt: (previous?.attempt ?? 0) + 1,
    }))
  }, [stateRef])

  const handleResult = React.useCallback((result: CameraMoveCaptureResult | null, cameraName: string) => {
    setRequest(null)
    if (!result || result.frames.length < 2) {
      toast(i18n.t('scene3d.fullscreen.frameExportFailed'), 'error')
      return
    }
    const labeled: Array<[string, string]> = [
      [result.frames[0], i18n.t('scene3d.fullscreen.firstFrame')],
      [result.frames[result.frames.length - 1], i18n.t('scene3d.fullscreen.lastFrame')],
    ]
    labeled.forEach(([dataUrl, label]) => onScreenshot({
      dataUrl,
      width: result.width,
      height: result.height,
      title: i18n.t('scene3d.fullscreen.cameraMoveFrameTitle', { camera: cameraName, frame: label }),
      source: 'scene3d-camera',
    }))
    toast(i18n.t('scene3d.fullscreen.frameExported'), 'success')
  }, [onScreenshot])

  // 看门狗：离屏 WebGL 出不来（上下文丢失等）不能让导出永远悬着。
  React.useEffect(() => {
    if (!request) return undefined
    const timer = window.setTimeout(() => {
      setRequest(null)
      toast(i18n.t('scene3d.fullscreen.frameExportTimeout'), 'error')
    }, 30_000)
    return () => window.clearTimeout(timer)
  }, [request])

  const moveFrameCapture = request
    ? React.createElement(Scene3DTrajectoryCapture, {
      key: request.attempt,
      state: request.state,
      frameCount: 2,
      fps: 24,
      title: i18n.t('scene3d.fullscreen.cameraMoveFramesTitle', { camera: request.cameraName }),
      sizeMode: 'still-frame',
      onResult: (result) => handleResult(result, request.cameraName),
    })
    : null

  return { exportCameraMoveFrames, moveFrameCapture }
}
