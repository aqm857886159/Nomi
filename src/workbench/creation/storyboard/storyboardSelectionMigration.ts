/**
 * B5b migration boundary. Older storyboard snapshots used the row checkbox to
 * mean "skip this run". The checkbox is now selection, so the old bit must be
 * read into the skip set and must never be written back as a selection bit.
 */
export type LegacyStoryboardCheckboxState = Readonly<{
  checked: boolean
  legacyCheckboxMeansSkip?: boolean
}>

export type StoryboardCheckboxState = Readonly<{
  selected: boolean
  skipped: boolean
}>

export function readStoryboardCheckboxState({ checked, legacyCheckboxMeansSkip = false }: LegacyStoryboardCheckboxState): StoryboardCheckboxState {
  return legacyCheckboxMeansSkip
    ? { selected: false, skipped: checked }
    : { selected: checked, skipped: false }
}

/** Persist the two current meanings separately; legacy readers can consume only the skip field. */
export function writeStoryboardCheckboxState({ selected, skipped }: StoryboardCheckboxState): { selected: boolean; skipped: boolean } {
  return { selected, skipped }
}
