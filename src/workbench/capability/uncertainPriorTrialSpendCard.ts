// 试跑开新单、而上一笔结果不确定时的付费确认卡（设计卡 docs/plan/2026-10-30-try-model-intent-lock.md）。
//
// 这笔是 AI 助手替用户发起的，通用卡的标题和按钮都对；不对的只有 message：用户要在点确认之前知道这一次可能多扣一次。
// 通用卡按 nodeId 去画布找节点，试跑不挂节点，硬套会印一句「新节点」。所以按 intent 查表（spendCardByIntent.ts）落到这里，
// 卡本身仍是全仓唯一那张（useSpendConfirmStore），不改它的结构。
import i18n from '../../i18n'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { spendModelLine, type CredentialProbeSpendPayload } from './credentialProbeSpendCard'

export async function confirmUncertainPriorTrialSpend(info: CredentialProbeSpendPayload): Promise<{ confirmed: boolean }> {
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    kind: 'generation',
    source: 'agent',
    title: i18n.t('runtime.capability.spendTitle', { intent: i18n.t('runtime.capability.intent.fallback') }),
    message: i18n.t('runtime.modelTrial.uncertainPrior'),
    confirmLabel: i18n.t('runtime.capability.confirmGenerate'),
    // 不印金额行（2026-09-26 用户拍板：官方额度上线前隐藏价格维度）。
    details: [{ label: i18n.t('runtime.capability.model'), value: spendModelLine(info.vendor, info.modelKey) }],
  })
  return { confirmed: Boolean(ok) }
}
