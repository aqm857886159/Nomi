export function assistantTimelineIsEmpty(input: {
  messageCount: number
  pendingCallCount: number
  liveBlockCount: number
}): boolean {
  return input.messageCount === 0 && input.pendingCallCount === 0 && input.liveBlockCount === 0
}
