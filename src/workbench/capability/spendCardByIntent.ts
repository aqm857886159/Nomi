// 主进程付费确认里「有自己措辞的那几种」按 intent 查表（2026-10-27，设计卡 docs/plan/2026-10-27-browser-extract-grant.md §3.4）。
//
// 它们都不挂在画布节点上、都是用户自己点的那一下，通用卡（按节点找标题、「AI 助手想生成…」）套上去每一句都不对；
// 卡本身仍是全仓唯一那张（useSpendConfirmStore），各家只换措辞与明细。
// 为什么是一张表而不是在 capabilityApplyHandler.ts 里一种一个 `if`：那个文件是热点，每来一种专用卡就长一个分支
// （P1「第三个特例分支」）。新的一种只在这里加一行，热点文件不动。
// 拆解的措辞还内嵌在通用分支里（三处三元），要改它的措辞时先搬进这张表。
import { PROMPT_EXTRACTION_SPEND_INTENT } from '../../../electron/shared/contracts/browserPromptExtraction'
import { UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT } from '../../../electron/shared/contracts/modelTrialSpend'
import { confirmCredentialProbeSpend, type CredentialProbeSpendPayload } from './credentialProbeSpendCard'
import { confirmPromptExtractionSpend, type PromptExtractionSpendPayload } from './promptExtractionSpendCard'
import { confirmUncertainPriorTrialSpend } from './uncertainPriorTrialSpendCard'

type DedicatedSpendCard = (info: CredentialProbeSpendPayload & PromptExtractionSpendPayload) => Promise<{ confirmed: boolean }>

const SPEND_CARD_BY_INTENT: Readonly<Record<string, DedicatedSpendCard>> = {
  // 凭据验证：用户此刻在接入页，不在画布。
  'credential-probe': confirmCredentialProbeSpend,
  // 浏览器「提取提示词」：卡上写清来源页、哪张图、哪个读图模型。
  [PROMPT_EXTRACTION_SPEND_INTENT]: confirmPromptExtractionSpend,
  // 试跑开新单而上一笔结果不确定：明说可能多扣一次。
  [UNCERTAIN_PRIOR_TRIAL_SPEND_INTENT]: confirmUncertainPriorTrialSpend,
}

/** 这个 intent 有专用卡就给它，没有 = undefined（落进通用卡）。只认表里自己的键，不认原型链上的。 */
export function dedicatedSpendCardFor(intent: string | undefined): DedicatedSpendCard | undefined {
  return intent && Object.prototype.hasOwnProperty.call(SPEND_CARD_BY_INTENT, intent) ? SPEND_CARD_BY_INTENT[intent] : undefined
}
