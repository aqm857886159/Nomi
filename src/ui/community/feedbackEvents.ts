import type { FeedbackOpenRequest } from './feedbackTypes'

export function openFeedbackFor(request: FeedbackOpenRequest): void {
  window.dispatchEvent(new CustomEvent('nomi-open-feedback-share', { detail: request }))
}
