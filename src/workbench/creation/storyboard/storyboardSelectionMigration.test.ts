import { describe, expect, it } from 'vitest'
import { readStoryboardCheckboxState, writeStoryboardCheckboxState } from './storyboardSelectionMigration'

describe('B5b legacy checkbox migration', () => {
  it('reads a legacy checked checkbox as skip without selecting the row', () => {
    expect(readStoryboardCheckboxState({ checked: true, legacyCheckboxMeansSkip: true })).toEqual({ selected: false, skipped: true })
  })

  it('reads the new checkbox as selection and keeps skip separate', () => {
    expect(readStoryboardCheckboxState({ checked: true })).toEqual({ selected: true, skipped: false })
  })

  it('writes selection and skip as separate fields', () => {
    expect(writeStoryboardCheckboxState({ selected: true, skipped: true })).toEqual({ selected: true, skipped: true })
  })
})
