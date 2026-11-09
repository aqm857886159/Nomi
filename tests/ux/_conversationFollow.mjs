// rAF调度允许内容突增当帧落后，必须下一采样帧追回；所有帧保留，阈值不放宽。
export const FOLLOW_SLACK_PX = 70

export function judgeConversationFollow(samples) {
  const heightBursts = []
  const exceptions = []
  const violations = []
  for (const [frame, sample] of samples.entries()) {
    const growth = sample.scrollHeight - (samples[frame - 1]?.scrollHeight ?? sample.scrollHeight)
    if (growth > FOLLOW_SLACK_PX) heightBursts.push({ frame, growth })
    if (sample.gap <= FOLLOW_SLACK_PX) continue
    const detail = { frame, growth, gap: sample.gap, nextGap: samples[frame + 1]?.gap ?? null }
    if (growth > FOLLOW_SLACK_PX && samples[frame + 1]?.gap <= FOLLOW_SLACK_PX) exceptions.push(detail)
    else violations.push(detail)
  }
  return {
    pass: samples.length > 20 && violations.length === 0,
    frames: samples.length,
    maxGap: Math.round(Math.max(...samples.map(sample => sample.gap))),
    heightBursts, exceptions, violations,
  }
}
