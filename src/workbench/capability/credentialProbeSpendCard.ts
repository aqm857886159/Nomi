// 凭据验证的付费确认卡（T-MO-10，用户 2026-09-22 拍板）。
//
// 这家没有免费的自检端点，验一次 key 就要发一次可能计费的请求。主进程发起确认时带
// `intent: 'credential-probe'`，落到这里。
//
// 为什么它不长在 `confirmSpendFromMainProcess` 里：那段按 `info.nodeId` 去画布里找节点、
// 拿节点标题当卡上的一行。凭据验证**不挂在任何节点上**——用户此刻在接入页，不在画布——
// 硬套会在卡上印一句「新节点」，那是假的。卡本身仍是全仓唯一那张（`useSpendConfirmStore`），
// 报价仍来自同一个 owner；这里只换这件事自己的措辞。
import i18n from '../../i18n'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import type { SpendQuoteLine } from '../../../electron/shared/contracts/spendQuote'

export type CredentialProbeSpendPayload = {
  /** 卡上显示的供应商名。 */
  vendor?: string
  /** 这次探测会打到哪个模型上（报价按它算）。 */
  modelKey?: string
  quote?: SpendQuoteLine
  /** 一次验证 = 一次调用；主进程带上这个数，用户才知道自己批的是「一下」而不是「一批」。 */
  callCount?: number
}

/** 卡上「模型」那一行怎么写（供应商 · 模型），两张卡同一份写法。 */
export function spendModelLine(vendor: string | undefined, modelKey: string | undefined): string {
  return [vendor, modelKey].filter(Boolean).join(' · ') || i18n.t('runtime.capability.defaultModel')
}

export async function confirmCredentialProbeSpend(info: CredentialProbeSpendPayload): Promise<{ confirmed: boolean }> {
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    kind: 'generation',
    source: 'user',
    title: i18n.t('runtime.capability.credentialProbeTitle', { vendor: info.vendor || '' }),
    message: i18n.t('runtime.capability.credentialProbeMessage'),
    confirmLabel: i18n.t('runtime.capability.confirmCredentialProbe'),
    // 不印金额行（2026-09-26 用户拍板：官方额度上线前隐藏价格维度）。
    details: [
      { label: i18n.t('runtime.capability.model'), value: spendModelLine(info.vendor, info.modelKey) },
      { label: i18n.t('runtime.capability.callCount'), value: String(info.callCount ?? 1) },
    ],
  })
  return { confirmed: Boolean(ok) }
}
