export const NODE_DRAG_MIME = 'application/x-nomi-node-id'
export const GROUP_DRAG_MIME = 'application/x-nomi-group-id'
export const NODE_DRAG_EXPAND_DELAY_MS = 450

type SidebarDragKind = 'node' | 'group'

export function classifySidebarDrag(types: readonly string[]): SidebarDragKind | null {
  if (types.includes(NODE_DRAG_MIME)) return 'node'
  if (types.includes(GROUP_DRAG_MIME)) return 'group'
  return null
}
