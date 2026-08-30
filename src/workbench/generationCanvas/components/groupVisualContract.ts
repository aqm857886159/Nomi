/**
 * Persistent group chrome is deliberately neutral. Accent colors are reserved
 * for transient interaction feedback supplied by shared controls (focus and
 * connection handles), never for identifying a group.
 */
export const GROUP_VISUAL_CLASS = {
  frame: 'border-[1.5px] border-nomi-line bg-nomi-paper/[0.32] shadow-nomi-sm',
  dropTarget: 'border-dashed border-nomi-ink-60 bg-nomi-ink-05',
  label: 'border-nomi-line bg-nomi-paper/[0.96] text-nomi-ink shadow-nomi-sm',
  marker: 'border-nomi-line bg-nomi-ink-20',
  count: 'bg-nomi-ink-05 text-nomi-ink-60',
  collapsedCard: 'border-nomi-line bg-nomi-paper shadow-nomi-lg',
  emptyIcon: 'bg-nomi-ink text-nomi-paper shadow-nomi-md',
  stackRear: 'border-nomi-line bg-nomi-paper shadow-nomi-md',
  stackTrigger: 'border-nomi-line bg-nomi-paper text-nomi-ink shadow-nomi-md',
} as const
