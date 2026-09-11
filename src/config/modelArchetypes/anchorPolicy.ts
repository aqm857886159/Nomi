import type { ArchetypeReferenceSlotKind } from './types'

export type AnchorConsumption = 'character' | 'scene' | 'firstFrame' | 'none'
export type ReferenceAssetKind = 'image' | 'video' | 'audio'

/** Shared by edge admission and storyboard policy; never inferred from model names. */
export const SLOT_ACCEPTS: Record<ArchetypeReferenceSlotKind, readonly ReferenceAssetKind[]> = {
  first_frame: ['image', 'video'],
  last_frame: ['image'],
  image_ref: ['image'],
  video_ref: ['video'],
  source_video: ['video'],
  audio_ref: ['audio'],
}

type ModeSlots = { slots: readonly { kind: ArchetypeReferenceSlotKind; characterIndexed?: boolean; roleName?: string }[] }

/** Derived capability, never authored in profiles. Generic image slots also accept character sheets. */
export function anchorsConsumedBy(mode: ModeSlots): AnchorConsumption[] {
  const consumed = new Set<AnchorConsumption>()
  for (const slot of mode.slots) {
    if (!SLOT_ACCEPTS[slot.kind].includes('image')) continue
    if (slot.kind === 'image_ref') consumed.add(slot.characterIndexed ? 'character' : 'scene')
    else consumed.add('firstFrame')
  }
  return consumed.size ? [...consumed] : ['none']
}
