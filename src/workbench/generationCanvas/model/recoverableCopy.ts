import type { TranslationKey } from '../../../i18n/translationKey'
import { matchNomiErrorCode } from '../../../../electron/shared/nomiErrorCodes'
import { isProductionRunRecord } from '../../../../electron/shared/productionShotPhase'
import type { GenerationCanvasNode } from './generationCanvasTypes'

/**
 * 「可找回」节点该说哪一句话——节点、分镜表、任务面板读同一份文案键，三处说同一句。
 *
 * 这一次 Nomi 连问都问不了（判别码 `retrieval-unavailable` 从主进程带下来，不从人话里猜）：说这个原因，下面两句都不是实话。
 * 关窗或重启之后节点上还没有这条错误，第一眼是下面的说法，点一次「重新取回」才变成这一句（已知限制）。
 *
 * 除此之外节点 `recoverable` 有两个来源，事实不同：
 * - 制作投影写的（最新一条运行记录是制作 Run 的）：供应商**已经出片**，只是结果没能取回本机——
 *   这就是任务面板的 `unretrieved`（判定只有 `jobAwaitsRetrieval` 一处，主进程把它投成这条记录）。说的话也取任务面板那两个键；
 * - 本机轮询超时（单镜 / 普通节点）：只知道等不到了，上游**可能**已出片——通用超时文案。
 */
export type RecoverableCopyKeys = Readonly<{ aria: TranslationKey; title: TranslationKey; description: TranslationKey; unretrieved: boolean }>

const UNAVAILABLE: RecoverableCopyKeys = {
  aria: 'generationCommon.recoverable.unavailableTitle',
  title: 'generationCommon.recoverable.unavailableTitle',
  description: 'generationCommon.recoverable.unavailableDescription',
  unretrieved: true,
}
const UNRETRIEVED: RecoverableCopyKeys = {
  aria: 'generationCommon.recoverable.aria',
  title: 'generationCommon.production.status.outputRetrievalFailed',
  description: 'generationCommon.production.description.outputRetrievalFailed',
  unretrieved: true,
}
const TIMED_OUT: RecoverableCopyKeys = {
  aria: 'generationCommon.recoverable.aria',
  title: 'generationCommon.recoverable.title',
  description: 'generationCommon.recoverable.description',
  unretrieved: false,
}

const isUnavailable = (failure: string | null | undefined): boolean => matchNomiErrorCode(failure ?? '') === 'retrieval-unavailable'

/** 任务面板：这一笔只差取回时该说哪一句（`failure` 是账本上这一笔的错误）。 */
export function unretrievedCopyKeys(failure: string | null | undefined): RecoverableCopyKeys {
  return isUnavailable(failure) ? UNAVAILABLE : UNRETRIEVED
}

export function recoverableCopyKeys(node: Pick<GenerationCanvasNode, 'runs' | 'error'> | null | undefined): RecoverableCopyKeys {
  if (isUnavailable(node?.error)) return UNAVAILABLE
  return isProductionRunRecord(node?.runs?.[0]) ? UNRETRIEVED : TIMED_OUT
}

/** 分镜表上「可找回」那一格的悬停说明：取回失败的镜说任务面板那句，超时的镜说原来那句。 */
export function recoverableHintKey(node: Pick<GenerationCanvasNode, 'runs' | 'error'> | null | undefined): TranslationKey {
  const copy = recoverableCopyKeys(node)
  return copy.unretrieved ? copy.description : 'storyboardEditor.frame.recoverableHint'
}
