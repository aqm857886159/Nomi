/**
 * [INPUT]: 依赖 react、./model/directorTypes（DirectorOutputImage / DirectorOutputVideo）
 * [OUTPUT]: 对外提供 DirectorOutput、DirectorOutputsApi、OutputsContext、useOutputs()
 * [POS]: director 根的产物动作注入：截图 / 录制 / 取消 / 发送到画布 由 useDirectorOutputs 实现一份，时间轴头部按钮、产出弹层、快捷键共用同一个实例。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import type { DirectorOutputImage, DirectorOutputVideo } from './model/directorTypes'

export type DirectorOutput = ({ kind: 'image' } & DirectorOutputImage) | ({ kind: 'video' } & DirectorOutputVideo)

export type DirectorOutputsApi = {
  takeScreenshot: () => Promise<boolean>
  recordVideo: () => Promise<boolean>
  cancelRecording: () => void
  // 没接画布（开发入口）时为 null，按钮禁用并说明
  sendToCanvas: ((output: DirectorOutput) => void) | null
}

export const OutputsContext = React.createContext<DirectorOutputsApi | null>(null)

export function useOutputs(): DirectorOutputsApi {
  const api = React.useContext(OutputsContext)
  if (!api) throw new Error('OutputsContext missing: wrap with DirectorEditor')
  return api
}
