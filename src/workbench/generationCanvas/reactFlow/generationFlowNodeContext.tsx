/* eslint-disable react-refresh/only-export-components */
import React, { type JSX } from 'react'

const GenerationFlowNodeContext = React.createContext(false)

export function GenerationFlowNodeScope({ children }: { children: React.ReactNode }): JSX.Element {
  return <GenerationFlowNodeContext.Provider value>{children}</GenerationFlowNodeContext.Provider>
}

export function useGenerationFlowNodeManagedDrag(): boolean {
  return React.useContext(GenerationFlowNodeContext)
}

/** 点一下「+」（不拖）要开的菜单：哪张卡、哪一侧、锚在哪（视口坐标）。画布宿主提供，节点外壳的把手调用。 */
export type GenerationFlowHandleMenuRequest = { nodeId: string; side: 'left' | 'right'; clientX: number; clientY: number }

const GenerationFlowHandleMenuContext = React.createContext<((request: GenerationFlowHandleMenuRequest) => void) | null>(null)

export function GenerationFlowHandleMenuScope({ open, children }: { open: (request: GenerationFlowHandleMenuRequest) => void; children: React.ReactNode }): JSX.Element {
  return <GenerationFlowHandleMenuContext.Provider value={open}>{children}</GenerationFlowHandleMenuContext.Provider>
}

/** 没有宿主（只读预览、缩略图）→ null：点「+」什么都不开。 */
export function useGenerationFlowHandleMenu(): ((request: GenerationFlowHandleMenuRequest) => void) | null {
  return React.useContext(GenerationFlowHandleMenuContext)
}
