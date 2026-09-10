/**
 * [INPUT]: 依赖 react 的 createContext/useContext、./useMobileCamera 的 MobileCameraApi
 * [OUTPUT]: 对外提供 MobileCameraContext、useMobileCameraApi()
 * [POS]: director 根的手机虚拟相机注入：hook 住在编辑器壳（拿得到 bridge / 录制器 / ViewportApi），POV HUD 的「连接手机」与对话框经这里调它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { createContext, useContext } from 'react'
import type { MobileCameraApi } from './useMobileCamera'

export const MobileCameraContext = createContext<MobileCameraApi | null>(null)

export function useMobileCameraApi(): MobileCameraApi {
  const api = useContext(MobileCameraContext)
  if (!api) throw new Error('MobileCameraContext missing: wrap with DirectorEditor')
  return api
}
