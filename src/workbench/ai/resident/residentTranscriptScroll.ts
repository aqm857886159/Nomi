/**
 * Pure scroll policy for the resident transcript.
 *
 * The transcript follows new Host items only while the user is already at the
 * latest message. Once they scroll up, new streamed content must not steal
 * their reading position; the UI can expose an explicit "latest" affordance.
 */
export const RESIDENT_TRANSCRIPT_BOTTOM_TOLERANCE_PX = 24

export type TranscriptScrollMetrics = Readonly<{
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}>

export function transcriptDistanceFromBottom(metrics: TranscriptScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop)
}

export function isTranscriptAtBottom(
  metrics: TranscriptScrollMetrics,
  tolerance = RESIDENT_TRANSCRIPT_BOTTOM_TOLERANCE_PX,
): boolean {
  const safeTolerance = Number.isFinite(tolerance) ? Math.max(0, tolerance) : RESIDENT_TRANSCRIPT_BOTTOM_TOLERANCE_PX
  return transcriptDistanceFromBottom(metrics) <= safeTolerance
}

/** Follow new content only if the user was already reading the latest item. */
export function shouldFollowTranscript(wasAtBottom: boolean): boolean {
  return wasAtBottom
}

/** Respect the platform motion preference for the explicit latest-message jump. */
export function transcriptScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? 'auto' : 'smooth'
}
