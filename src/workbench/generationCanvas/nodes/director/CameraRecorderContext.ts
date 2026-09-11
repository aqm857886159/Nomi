/**
 * [INPUT]: 依赖 react 的 createContext/useContext、./useCameraMotionRecorder 的 CameraRecorderApi
 * [OUTPUT]: 对外提供 CameraRecorderContext、useCameraRecorder()
 * [POS]: director 根的录制器注入：录制器 hook 住在编辑器壳（拿得到 ViewportApi），POV HUD / 快捷键 / 时间轴 Space 经这里调它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createContext, useContext } from 'react'
import type { CameraRecorderApi } from './useCameraMotionRecorder'

export const CameraRecorderContext = createContext<CameraRecorderApi | null>(null)

export function useCameraRecorder(): CameraRecorderApi {
  const recorder = useContext(CameraRecorderContext)
  if (!recorder) throw new Error('CameraRecorderContext missing: wrap with DirectorEditor')
  return recorder
}
