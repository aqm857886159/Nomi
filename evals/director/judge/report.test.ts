import { describe, expect, it } from 'vitest'
import { summarizePositionProbe } from './report'

describe('position preference probe', () => {
  it('marks a rate at or above half as red and ignores non-decisive calls', () => {
    expect(summarizePositionProbe([
      { cardId: 'a', forward: 'left', reverse: 'left' },
      { cardId: 'b', forward: 'right', reverse: 'left' },
      { cardId: 'c', forward: 'unclear', reverse: 'right' },
    ])).toEqual({ total: 3, comparable: 2, samePosition: 1, rate: 0.5, flagged: true })
  })
})
