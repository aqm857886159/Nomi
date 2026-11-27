import type { LaneViewModelLabels } from '../../src/workbench/ai/lane/laneViewModel'

export const laneViewTestLabels: LaneViewModelLabels = {
  toolLabel: (name) => `[${name}]`,
  toolSummary: () => undefined,
  toolFailure: () => undefined,
  toolFailureDetail: (failure) => failure.code,
  assistantFailure: (text) => text,
  assistantRecovered: '[已自动重试]',
  thinkingLabel: '[thinking]',
  formatTokens: (value) => `${value}t`,
  formatCost: (usd) => `$${usd.toFixed(4)}`,
  retryLabel: (attempt, maxAttempts) => `[retry ${attempt}/${maxAttempts}]`,
  // 这一句在生产里是 i18n 的 `contextUnknown`。测试里写成醒目的假串，
  // 是为了让「本层自己编了一个字」当场露馅——占位符长什么样是调用方的事，不是这一层的。
  unknown: '[unknown]',
  taskTitle: '[task]',
  formatStages: (done, total) => `${done}/${total} stages`,
  taskUnknown: '[task-unknown]',
  attachmentUnavailable: '[attachment-unavailable]',
  answered: '[answered]',
  skillLabel: (key) => `[skill:${key}]`,
}
