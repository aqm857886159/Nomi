import { tagNomiError } from '../../../electron/shared/nomiErrorCodes'

/**
 * 本机处理失败的**唯一**标记入口（截帧 / 提取深度 / 本地素材复制）。
 *
 * 为什么要它：失败卡的「下一步」按「这次失败是谁的事」决定。服务商那一侧的失败（含认不出的）默认给「换个模型」，
 * 可这几步全在用户这台电脑上做、没有任何模型参与，那颗按钮就是误导。判据是稳定机器码 `NOMI_ERR::local-processing::`
 * （classifyGenerationError 认码不认人话），所以**写失败卡的人只要走这个函数，就不会再长出「换个模型」**。
 * 新增一个本机处理入口 = 失败文案过一遍这里；漏了就会回到「认不出」那一类，所以 `localProcessingError.test.ts` 把现有入口钉住。
 */
export function localProcessingError(message: string): string {
  return tagNomiError('local-processing', message)
}
