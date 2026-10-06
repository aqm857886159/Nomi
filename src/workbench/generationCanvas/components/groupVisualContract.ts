/**
 * Persistent group chrome is neutral grey by default; an opted-in group's semantic color (border + title dot only, never a fill)
 * is added by model/groupColor.ts. Interaction accent remains transient.
 */
export const GROUP_VISUAL_CLASS = {
  frame: 'border-[1.5px] bg-nomi-paper/[0.32] shadow-nomi-sm',
  dropTarget: 'border-dashed border-nomi-ink-60 bg-nomi-ink-05',
  label: 'bg-nomi-paper/[0.96] text-nomi-ink shadow-nomi-sm',
  marker: 'border-2',
  count: 'bg-nomi-ink-05 text-nomi-ink-60',
  collapsedCard: 'bg-nomi-paper shadow-nomi-lg',
  emptyIcon: 'bg-nomi-ink text-nomi-paper shadow-nomi-md',
  stackRear: 'bg-nomi-paper shadow-nomi-md',
  stackTrigger: 'border-nomi-line bg-nomi-paper text-nomi-ink shadow-nomi-md',
} as const
