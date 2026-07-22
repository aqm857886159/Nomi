import { cn } from '../../../utils/cn'
import type { FloatingWindowResizeEdge } from '../window/useResizableFloatingWindow'

export const CANVAS_IMPORT_TARGET_SELECTOR = '[data-nomi-generation-canvas-import-target="true"]'
export const BROWSER_DIALOG_ROOT_SELECTOR = '.nomi-browser-dialog-root'
export const PROMPT_EXTRACTION_SETTINGS_DIALOG_SELECTOR = '[data-nomi-prompt-extraction-settings-dialog="true"]'
export const NOMI_ASSET_DRAG_MIME = 'application/x-nomi-assets'
export const LEGACY_BROWSER_ASSET_DRAG_MIME = 'application/x-nomi-browser-assets'
export const BROWSER_IMAGE_DRAG_MIME = 'application/x-nomi-browser-image'
export const DOCK_EDGE_THRESHOLD = 32
export const DOCK_GAP = 10
export const DOCK_DEFAULT_WIDTH = 500
export const DOCK_MAX_WIDTH_RATIO = 0.54
export const PERSISTED_ASSET_PAGE_LIMIT = 200
export const ASSET_GRID_HORIZONTAL_PADDING = 32
export const ASSET_GRID_COLUMN_GAP = 12
export const ASSET_GRID_MIN_COLUMN_WIDTH = 112
export const ASSET_GRID_COMPACT_MIN_COLUMN_WIDTH = 128
export const ASSET_GRID_COMPACT_MAX_COLUMNS = 3
export const ASSET_CONTEXT_MENU_WIDTH = 168
// 2 项（导入画布/删除）满配估高：2×32 + padding。clamp 用，宁高勿低。
export const ASSET_CONTEXT_MENU_ESTIMATED_HEIGHT = 78
export const ASSET_CONTEXT_MENU_MARGIN = 8
export const MARQUEE_AUTO_SCROLL_EDGE_SIZE = 44
export const MARQUEE_AUTO_SCROLL_MAX_SPEED = 22

export const TOOL_BUTTON_CLASS = cn(
  'inline-grid size-8 place-items-center rounded-nomi-sm border-0 bg-transparent',
  'cursor-pointer text-nomi-ink-60 transition-[background,color] duration-[var(--nomi-transition-fast)]',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink',
)

export const RESIZE_HANDLE_CLASS: Record<FloatingWindowResizeEdge, string> = {
  n: '-top-2 left-5 right-5 h-4 cursor-ns-resize',
  s: '-bottom-2 left-5 right-5 h-4 cursor-ns-resize',
  e: '-right-2 bottom-5 top-5 w-4 cursor-ew-resize',
  w: '-left-2 bottom-5 top-5 w-4 cursor-ew-resize',
  ne: '-right-2 -top-2 size-5 cursor-nesw-resize',
  nw: '-left-2 -top-2 size-5 cursor-nwse-resize',
  se: '-bottom-2 -right-2 size-5 cursor-nwse-resize',
  sw: '-bottom-2 -left-2 size-5 cursor-nesw-resize',
}
