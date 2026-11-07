// 浏览器「提取提示词」的付费确认卡（2026-10-27，用户拍板文案；设计卡 docs/plan/2026-10-27-browser-extract-grant.md §3.3）。
//
// 主进程每次提取都经 confirmSpendAndMintGrant 带 `intent: 'prompt-extraction'` 问人，按 intent 查表（spendCardByIntent.ts）落到这里。
// 为什么不套通用卡：通用卡按 nodeId 去画布找节点、写「AI 助手想生成一个素材」——提取不挂在节点上、是用户自己点的、
// 也不生成素材，每一句都不对。卡本身仍是全仓唯一那张（useSpendConfirmStore），这里只换这件事自己的措辞与明细。
//
// 卡上必须写清「读的是哪个页面的哪张图」：页内的「提取」按钮在网页里，网页能伪造那一下点击，用户只能靠这张卡认出来。
// 两行值由主进程算好、经那条链现有的 `prompt` 字段带来（格式的主人是 electron/shared/contracts/browserPromptExtraction.ts）；
// 解不开就不问人（fail-closed）：说不清读哪张图的卡，不该让用户点确认。
import i18n from '../../i18n'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { decodePromptExtractionSubject } from '../../../electron/shared/contracts/browserPromptExtraction'
import { spendModelLine } from './credentialProbeSpendCard'

export type PromptExtractionSpendPayload = {
  /** 读图模型（主进程已解成执行身份：报价与真实调用是同一行）。 */
  vendor?: string
  modelKey?: string
  /** 编码过的「来源页 + 图片」两行。 */
  prompt?: string
}

export async function confirmPromptExtractionSpend(info: PromptExtractionSpendPayload): Promise<{ confirmed: boolean }> {
  const subject = decodePromptExtractionSubject(info.prompt)
  if (!subject) return { confirmed: false }
  const ok = await useSpendConfirmStore.getState().requestConfirm({
    kind: 'generation',
    // 用户自己点的那一下（金币图标，同拆解）：不是 AI 代他花钱。
    source: 'user',
    title: i18n.t('runtime.capability.promptExtractionTitle'),
    message: i18n.t('runtime.capability.promptExtractionMessage'),
    confirmLabel: i18n.t('runtime.capability.confirmPromptExtraction'),
    // 不印金额行（2026-09-26 用户拍板：官方额度上线前隐藏价格维度）。
    details: [
      ...(subject.page ? [{ label: i18n.t('runtime.capability.promptExtractionPage'), value: subject.page }] : []),
      { label: i18n.t('runtime.capability.promptExtractionImage'), value: subject.image || i18n.t('runtime.capability.promptExtractionScreenshot') },
      { label: i18n.t('runtime.capability.visionModelLine'), value: spendModelLine(info.vendor, info.modelKey) },
    ],
  })
  return { confirmed: Boolean(ok) }
}
