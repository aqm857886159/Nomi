export type ComfyWorkflowOutputKind = 'image' | 'video' | 'model3d'
export type ComfyWorkflowTaskKind =
  | 'text_to_image'
  | 'image_edit'
  | 'text_to_video'
  | 'image_to_video'
  | 'text_to_3d'
  | 'image_to_3d'

type DeclaredMediaInput = { mediaKind?: 'image' | 'video' | 'audio' }

/**
 * ComfyUI transport is a property of the imported graph, not of the URLs filled
 * for one run. Video-only and audio-only inputs stay in the text bucket because
 * Nomi has no video-to-video/audio-to-video ProfileKind; any declared still-image
 * input (or an input with no declared mediaKind — omitted mediaKind defaults to
 * image-compatible everywhere else in this file's neighborhood) selects the
 * image variant of the output contract.
 *
 * `hasImageInput` used to be `!== 'video'` (root-cause fix 2026-09-11): that
 * treated an **audio-only** LoadAudio input as "has image input" too, so a
 * workflow with a LoadAudio node but no LoadImage would wrongly resolve to
 * image_edit/image_to_video/image_to_3d instead of the text_to_* variant —
 * the same class of "binary image/video assumption breaks on a third media
 * kind" bug as the canvas reference-edge gate (anchorPolicy.ts).
 */
export function resolveComfyWorkflowTaskKind(
  outputKind: ComfyWorkflowOutputKind,
  mediaInputs: readonly DeclaredMediaInput[],
): ComfyWorkflowTaskKind {
  const hasImageInput = mediaInputs.some((input) => input.mediaKind === 'image' || input.mediaKind === undefined)
  if (outputKind === 'model3d') return hasImageInput ? 'image_to_3d' : 'text_to_3d'
  if (outputKind === 'video') return hasImageInput ? 'image_to_video' : 'text_to_video'
  return hasImageInput ? 'image_edit' : 'text_to_image'
}
