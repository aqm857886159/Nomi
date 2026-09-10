/**
 * [INPUT]: 依赖 react 的 createContext/useContext、../model/directorTypes 的 Vec3
 * [OUTPUT]: 对外提供 ViewportApi 类型、CaptureFrameRequest / CaptureFrameResult、ViewportApiRef、ViewportApiContext、useViewportApi()；applyViewPose 给手机虚拟相机在录制中驱动视口相机
 * [POS]: director/scene 与 DOM 面板之间的命令式接口：面板（顶栏重置视角、F 聚焦、创建栏取当前视角）不直接碰 three，
 *        经这里调 ViewCamera 暴露的方法；DirectorCanvas 挂载时把实现写进 ref。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createContext, useContext, type MutableRefObject } from 'react'
import type { Vec3 } from '../model/directorTypes'

export type ViewPose = { position: Vec3; yaw: number; pitch: number; roll: number; fov: number }

export type ViewportApi = {
  resetView: () => void
  focusEntity: (entityId: string) => void
  getViewPose: () => ViewPose
  // 把位姿立刻套到 three 相机（录制中视口相机是真相，手机包必须走这里，不能只写 store）
  applyViewPose: (pose: ViewPose) => void
  setOrbitEnabled: (enabled: boolean) => void
  // 屏幕坐标 → 地面平面（y = gridHeight）的世界点；射线不交地面或太远返回 null
  groundPointFromClient: (clientX: number, clientY: number) => Vec3 | null
  // 双脚吸附地面：需要蒙皮几何（scene 侧角色注册自己的处理器）
  snapCharacterFeet: (objectId: string) => void
  // 出片：按机位（或 'free' = 当前视口相机）在导出尺寸下离屏渲染一帧，返回 PNG dataURL（editor-only 与辅助物体不画，可选烧角色标签）
  captureFrame: (request: CaptureFrameRequest) => Promise<CaptureFrameResult | null>
  // 视口画布当前像素尺寸（free 画幅按它定导出比例）
  getViewportSize: () => { width: number; height: number }
}

// cameraId：机位 id / 'free' = 当前视口相机 / 'black' = 无节目机位的黑场帧
export type CaptureFrameRequest = { cameraId: string | 'free' | 'black'; width: number; height: number; burnLabels: boolean }
export type CaptureFrameResult = { dataUrl: string; blob: Blob; width: number; height: number }

export type ViewportApiRef = MutableRefObject<ViewportApi | null>

export const ViewportApiContext = createContext<ViewportApiRef | null>(null)

export function useViewportApi(): ViewportApiRef {
  const ref = useContext(ViewportApiContext)
  if (!ref) throw new Error('ViewportApiContext missing: wrap with DirectorEditor')
  return ref
}
