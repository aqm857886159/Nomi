/**
 * 框菜单的排除清单（10-10 拍板）：工具条「⋯」打开同一份 FrameContextMenu，但不重复工具条上已有的动作。
 * 单独成文件：FrameContextMenu.tsx 只导出组件，常量放这里（react-refresh）。
 */
import type { FrameContextMenuAction } from './FrameContextMenu'

/** 工具条「⋯」排除：生成整组、进时间轴、解组。 */
export const FRAME_MENU_TOOLBAR_DUPLICATES: readonly FrameContextMenuAction[] = ['generate', 'timeline', 'dissolve']
