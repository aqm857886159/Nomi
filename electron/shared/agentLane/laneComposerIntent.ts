// Running input defaults to native steering. The host records the user entry before
// releasing an approval wait; explicit secondary input (Alt+Enter) is follow-up.
// This pure mapping is shared by the renderer client and runtime tests.
import type { LaneCommand, LaneProjection } from './laneContracts'
import type { PendingSpendRead } from '../contracts/pendingSpendConfirm'

/** 输入框那一刻面对的是什么。顺序即优先级：等人的卡永远盖过「在跑」。 */
export type LaneComposerState = 'awaiting-approval' | 'running' | 'idle'

/**
 * 一个可选动作的身份。**它不是文案**——可见文字全部走 i18n（R15），这一层只说
 * 「这个按钮是哪一个」，让主进程与渲染层对同一个身份说同一句话。
 */
export const LANE_COMPOSER_OPTIONS = ['deny-with-reason', 'queue-steer', 'queue-follow-up', 'new-turn'] as const
export type LaneComposerOption = (typeof LANE_COMPOSER_OPTIONS)[number]

export interface LaneComposerChoice {
  readonly option: LaneComposerOption
  readonly command: LaneCommand
}

export interface LaneComposerIntent {
  readonly state: LaneComposerState
  /** 用户直接按回车会发生的事。 */
  readonly primary: LaneComposerChoice
  /** 显式次级手势。空闲态没有次选——「新一轮」没有第二种读法。 */
  readonly secondary?: LaneComposerChoice
}

/**
 * 「等你确认」只有一种表示（2026-10-05）：投影里有一张在等用户的卡——闸自己的卡（`pending`），
 * 或这个项目里有一笔钱在等点头（`spend`，工作区投影）。后者以前不进投影（闸的 hold 替它等，却不出现在这里），
 * 于是等付费卡时这里答「在跑」。
 *
 * 付费卡只在**回合在跑**时才算「等你」：全自动代答失败留下的那张卡没有回合在等它，此刻打的字是开新一轮，
 * 不是对那张卡的回答（主进程那头同样只在 hold 存在时把字递给卡）。
 */
export function laneComposerState(projection: LaneProjection, spend?: PendingSpendRead): LaneComposerState {
  if (projection.pending) return 'awaiting-approval'
  if (!projection.running) return 'idle'
  return spend?.surface === 'ready' && spend.rows.length > 0 ? 'awaiting-approval' : 'running'
}

/** Preserve the user's words; the host owns approval wake-up and pi owns queue order. */
export function laneComposerIntent(projection: LaneProjection, text: string, spend?: PendingSpendRead): LaneComposerIntent {
  const state = laneComposerState(projection, spend)
  if (state !== 'idle') {
    return {
      state,
      primary: { option: 'queue-steer', command: { kind: 'steer', text } },
      secondary: { option: 'queue-follow-up', command: { kind: 'follow-up', text } },
    }
  }
  return { state, primary: { option: 'new-turn', command: { kind: 'prompt', text } } }
}
