import type { TranslationKey } from '../../../i18n/translationKey'
import { isProductionRunRecord } from '../../../../electron/shared/productionShotPhase'
import type { GenerationCanvasNode } from './generationCanvasTypes'

/**
 * 「可找回」节点该说哪一句话——节点、分镜表、任务面板读同一份文案键，三处说同一句。
 *
 * 节点 `recoverable` 有两个来源，事实不同：
 * - 制作投影写的（最新一条运行记录是制作 Run 的）：供应商**已经出片**，只是结果没能取回本机——
 *   这就是任务面板的 `unretrieved`（判定只有 `jobAwaitsRetrieval` 一处，主进程把它投成这条记录）。说的话也取任务面板那两个键；
 * - 本机轮询超时（单镜 / 普通节点）：只知道等不到了，上游**可能**已出片——通用超时文案。
 */
export type RecoverableCopyKeys = Readonly<{ title: TranslationKey; description: TranslationKey; unretrieved: boolean }>

const UNRETRIEVED: RecoverableCopyKeys = {
  title: 'generationCommon.production.status.outputRetrievalFailed',
  description: 'generationCommon.production.description.outputRetrievalFailed',
  unretrieved: true,
}
const TIMED_OUT: RecoverableCopyKeys = {
  title: 'generationCommon.recoverable.title',
  description: 'generationCommon.recoverable.description',
  unretrieved: false,
}

export function recoverableCopyKeys(node: Pick<GenerationCanvasNode, 'runs'> | null | undefined): RecoverableCopyKeys {
  return isProductionRunRecord(node?.runs?.[0]) ? UNRETRIEVED : TIMED_OUT
}

/** 分镜表上「可找回」那一格的悬停说明：取回失败的镜说任务面板那句，超时的镜说原来那句。 */
export function recoverableHintKey(node: Pick<GenerationCanvasNode, 'runs'> | null | undefined): TranslationKey {
  const copy = recoverableCopyKeys(node)
  return copy.unretrieved ? copy.description : 'storyboardEditor.frame.recoverableHint'
}
