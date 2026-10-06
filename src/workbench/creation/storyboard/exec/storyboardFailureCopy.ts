import { classifyGenerationError } from '../../../observability/classifyError'

export type StoryboardFailureCopy = {
  /** 画面格里那一行：失败的原因（与画布节点错误卡同一个分类器、同一份词表）。 */
  reason: string
  /** 悬停说明：下一步怎么办。 */
  hint: string
  /** 画面格上的「重试」该不该在：结果待核对 / 只能去任务面板取回的失败，重试会被拒或者再花一次钱。 */
  canRetry: boolean
}

/**
 * 分镜画面格（参考卡、镜头行）失败态的说法。以前只写「生成失败」，原因藏在悬停里的原始报错，
 * 用户不知道为什么、也不知道能不能重试（V-1042 第 22 张截图）。这里不另写一套判据：原因和动作都出自
 * `classifyGenerationError`（画布节点错误卡用的同一个），画面格只是换一个更窄的地方说同一句话。
 */
export function storyboardFailureCopy(errorMessage: string | null | undefined): StoryboardFailureCopy {
  const report = classifyGenerationError(String(errorMessage || ''))
  return {
    reason: report.reason,
    hint: report.hint,
    canRetry: report.primary !== 'reconcile' && report.primary !== 'view-task',
  }
}
