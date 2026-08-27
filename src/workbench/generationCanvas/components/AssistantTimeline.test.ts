import { describe, expect, it } from 'vitest'
import { assistantTimelineIsEmpty } from './assistantTimelineState'

describe('assistantTimelineIsEmpty', () => {
  it('keeps independent review results visible without chat history', () => {
    expect(assistantTimelineIsEmpty({
      messageCount: 0,
      pendingCallCount: 0,
      liveBlockCount: 1,
    })).toBe(false)
  })

  it('shows suggestions only when messages, approvals, and results are all empty', () => {
    expect(assistantTimelineIsEmpty({
      messageCount: 0,
      pendingCallCount: 0,
      liveBlockCount: 0,
    })).toBe(true)
  })
})
