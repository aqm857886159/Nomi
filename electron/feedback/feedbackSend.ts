// 把组好的反馈包交给队列，再把队列的回答翻成界面要的那句话。
import { submitIntake } from '../telemetry/intakeQueue'
import type { FeedbackSendResult } from '../shared/contracts/feedback'
import type { FeedbackReportPayload } from './feedbackReport'

/**
 * 界面最多等多久。到点还没回答就告诉用户「已存在本机」，后台接着发。
 * 比上传超时短得多是有意的：报告已经落盘了，用户没必要守着弱网把几百 KB 传完。
 */
const FEEDBACK_SEND_WAIT_MS = 8_000

export async function sendFeedbackReport(
  report: FeedbackReportPayload,
  options: { waitMs?: number } = {},
): Promise<FeedbackSendResult> {
  const overBudget = report.manifest.excluded.some((item) => item.why === 'report-size-limit')
  const submission = await submitIntake('feedback', report, { waitMs: options.waitMs ?? FEEDBACK_SEND_WAIT_MS })
  switch (submission.status) {
    case 'delivered':
      return { ok: true, id: submission.result.id ?? null, queued: false, trimmed: overBudget || submission.shrunk }
    case 'pending':
      return { ok: true, id: null, queued: true, trimmed: overBudget }
    default:
      return { ok: false, reason: 'failed' }
  }
}
