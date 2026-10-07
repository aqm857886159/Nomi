import i18n from '../../../../i18n'
import { classifyGenerationError } from '../../../observability/classifyError'

export type StoryboardFailureCopy = {
  /** 画面格里那一行：失败的原因（与画布节点错误卡同一个分类器、同一份词表）。 */
  reason: string
  /**
   * 悬停说明：下一步怎么办，后面接「技术详情：<这一次的原始原因>」。词表里好几条 hint 写着「见下方技术详情」，
   * 画布错误卡下方有那一栏，分镜画面格没有——所以画面格的悬停自己把那一栏带上，那句话在这里也成立（V-1047 m4）。
   */
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
  const detail = technicalDetail(report.raw)
  return {
    reason: report.reason,
    hint: detail ? `${report.hint}\n\n${i18n.t('generationCommon.error.technicalDetails')}${String(i18n.language).startsWith('zh') ? '：' : ': '}${detail}` : report.hint,
    canRetry: report.primary !== 'reconcile' && report.primary !== 'view-task',
  }
}

/** 技术详情只取原始报错里人能读的那一段：去掉 IPC 外壳（Error invoking remote method …: Error:），截到一行。 */
function technicalDetail(raw: string): string {
  const text = String(raw || '').replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '').split('\n')[0].trim()
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}
