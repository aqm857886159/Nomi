import React from 'react'
import { autoReframeCameraPatch, patchCameraFraming } from './scene3dSafeFrame'
import type { Scene3DAspectRatio, Scene3DCamera, Scene3DState } from './scene3dTypes'

/**
 * 相机构图所有权 + 自动安全画幅（F1，从 Scene3DFullscreen 抽出防巨壳 R9）：
 * - patchCamera：改相机走 patchCameraFraming——用户真手动改机位/target → 转 manual，自动取景不再覆盖。
 * - handleCameraAspectChange：auto 相机切画幅后按新画幅重解安全构图（manual 相机只换画幅、不重取景）。
 */
export function useScene3DCameraFraming({
  setState,
  stateRef,
}: {
  setState: React.Dispatch<React.SetStateAction<Scene3DState>>
  stateRef: React.MutableRefObject<Scene3DState>
}): {
  patchCamera: (id: string, patch: Partial<Scene3DCamera>) => void
  handleCameraAspectChange: (camera: Scene3DCamera, aspectRatio: Scene3DAspectRatio) => void
} {
  const patchCamera = React.useCallback((id: string, patch: Partial<Scene3DCamera>) => {
    setState((current) => ({
      ...current,
      cameras: current.cameras.map((camera) => (camera.id === id ? { ...camera, ...patchCameraFraming(camera, patch) } : camera)),
    }))
  }, [setState])

  const handleCameraAspectChange = React.useCallback((camera: Scene3DCamera, aspectRatio: Scene3DAspectRatio) => {
    patchCamera(camera.id, autoReframeCameraPatch(camera, stateRef.current.objects, { aspectRatio }))
  }, [patchCamera, stateRef])

  return { patchCamera, handleCameraAspectChange }
}
