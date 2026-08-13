export type StoryboardShotMode = 'image' | 'video' | 'image-video'

/** The first-run action has one plain-language CTA; media type stays editable per shot. */
export const DEFAULT_STORYBOARD_SHOT_MODE: StoryboardShotMode = 'image'

export function storyboardActionMode(): StoryboardShotMode {
  return DEFAULT_STORYBOARD_SHOT_MODE
}
