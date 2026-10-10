/**
 * Group chrome has no border: the surface is a soft tint (neutral grey by default, the group's color soft token when chosen,
 * see model/groupColor.ts). Selection adds no outline; interaction accent remains transient.
 */
export const GROUP_VISUAL_CLASS = {
  dropTarget: 'border-dashed border-nomi-ink-60 bg-nomi-ink-05',
  marker: 'border-2',
  collapsedCard: 'shadow-nomi-lg',
  emptyIcon: 'bg-nomi-ink text-nomi-paper shadow-nomi-md',
  stackRear: 'bg-nomi-paper shadow-nomi-md',
  stackTrigger: 'border-nomi-line bg-nomi-paper text-nomi-ink shadow-nomi-md',
} as const
