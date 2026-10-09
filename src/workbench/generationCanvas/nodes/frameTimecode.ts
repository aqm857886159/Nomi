/**
 * 截帧菜单与新卡标题共用的时间码（`0:07.2`，精确到 0.1 秒）。
 *
 * 「说的 = 做的」靠一件事：菜单显示的是 `roundFrameSeconds(播放头)`，截出来的也是同一个数——
 * 显示和动作读同一个值，不是各自再取一次播放头（播放中取两次一定对不上）。
 */
export function roundFrameSeconds(seconds: number): number {
  return Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10) / 10
}

export function frameTimecode(seconds: number): string {
  const tenths = Math.round(roundFrameSeconds(seconds) * 10)
  const whole = Math.floor(tenths / 10)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${tenths % 10}`
}
