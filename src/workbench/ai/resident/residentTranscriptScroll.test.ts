import { describe, expect, it } from 'vitest'
import {
  RESIDENT_TRANSCRIPT_BOTTOM_TOLERANCE_PX,
  isTranscriptAtBottom,
  shouldFollowTranscript,
  transcriptScrollBehavior,
  transcriptDistanceFromBottom,
} from './residentTranscriptScroll'

describe('resident transcript scroll policy', () => {
  it('treats a small sub-pixel/layout gap as the latest position', () => {
    expect(transcriptDistanceFromBottom({ scrollTop: 376, scrollHeight: 600, clientHeight: 200 })).toBe(24)
    expect(isTranscriptAtBottom({ scrollTop: 376, scrollHeight: 600, clientHeight: 200 })).toBe(true)
    expect(isTranscriptAtBottom({ scrollTop: 375, scrollHeight: 600, clientHeight: 200 })).toBe(false)
  })

  it('never follows the stream after the user scrolls away', () => {
    expect(shouldFollowTranscript(true)).toBe(true)
    expect(shouldFollowTranscript(false)).toBe(false)
  })

  it('sanitizes an invalid tolerance instead of hiding new messages', () => {
    expect(isTranscriptAtBottom({ scrollTop: 0, scrollHeight: 100, clientHeight: 50 }, Number.NaN)).toBe(false)
    expect(RESIDENT_TRANSCRIPT_BOTTOM_TOLERANCE_PX).toBe(24)
  })

  it('does not animate an explicit jump when reduced motion is requested', () => {
    expect(transcriptScrollBehavior(true)).toBe('auto')
    expect(transcriptScrollBehavior(false)).toBe('smooth')
  })
})
