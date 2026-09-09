import { createContext, useContext } from 'react'

/** The creation host opts in once, including its resident Agent portal. */
export const WorkspacePanelFrameContext = createContext(false)
export function useWorkspacePanelFrame(): boolean { return useContext(WorkspacePanelFrameContext) }
export const workspacePanelFrame = 'overflow-clip rounded-nomi border border-nomi-line bg-nomi-paper shadow-none'
export const workspacePanelHeader = 'h-12 px-3 py-0 border-b border-nomi-line-soft bg-nomi-paper'
