import { createContext, useContext } from 'react'

/** The creation host opts in once, including its resident Agent portal. */
export const WorkspacePanelFrameContext = createContext(false)
export function useWorkspacePanelFrame(): boolean { return useContext(WorkspacePanelFrameContext) }
/**
 * 工作面外框（10-08 外壳拍板稿 .panel / .work）：圆角 10、纸色、外圈一道极淡的 line-soft 环。
 * 外壳底色（--nomi-chrome）包住它，层次靠底色不靠粗边框；不投影。
 */
export const workspacePanelFrame = 'overflow-clip rounded-panel bg-nomi-paper ring-1 ring-nomi-line-soft shadow-none'
export const workspacePanelHeader = 'h-12 px-3 py-0 border-b border-nomi-line-soft bg-nomi-paper'
