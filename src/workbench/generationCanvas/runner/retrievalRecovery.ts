import { isRetrievalStageCode, matchNomiErrorCode } from '../../../../electron/shared/nomiErrorCodes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/**
 * 「这次失败是结果**取回**那一步没成的吗——而且还找得回来吗？」
 *
 * 与 `recoverableTimeout.ts` 并列：两者都通向 `recoverable` 这一个节点态，但来路不同，
 * 所以各自一个模块、各自一条判据，不合并。
 *
 * 为什么这条判据值一个自己的家：任务**已经被受理、钱多半已经花了**，丢的只是把结果拿回来这一步。
 * 落 `error` 会把用户推到**付费重试**那颗按钮上，而取回族的文案明写着「用『重新取回』免费取回，
 * 不用重新生成」。那颗按钮只在 `recoverable` 态出现：判据一旦走偏，界面就是在骗人，而且骗的是钱。
 *
 * 判据认**稳定机器码**（`NOMI_ERR::retrieval-*::`，`isRetrievalStageCode`）不认人话——人话会被 i18n
 * 换成英文/改词，子串匹配当场断（那正是 `electron/shared/nomiErrorCodes.ts` 存在的理由）。
 * 老数据里的 `outbound-blocked`（取回被已删掉的地址判据拦下）由 `matchNomiErrorCode` 读成 retrieval-download，同样落这里。
 *
 * 刹车方向与超时**相反**，调用方据此记账：超时时上游是健康的、继续跑没有额外风险，不计刹车；
 * 取回确定性失败时后面每一条多半会在同一处失败，而提交侧照旧扣费——让队列停下来才是省钱的那一边。
 */
export function retrievalRecoverableMessage(error: unknown, node: GenerationCanvasNode | undefined): string | null {
  if (!(error instanceof Error) || !error.message) return null
  // #1213：整个「结果取回」族（查询 / 读结果 / 下载 / 等待）都是「任务已受理、丢的只是取回」——同一个判据、同一个去处（可找回）。
  if (!isRetrievalStageCode(matchNomiErrorCode(error.message))) return null
  // 只有拿得到 taskId 才算「找得回来」：免费续查靠 taskId 无状态重建查询（recoverTaskActions 的
  // buildRecoverPayload），没有它那颗按钮按下去也只会报「找不到任务」——那种情况下 `error` 才是
  // 诚实的。不许为了让状态好看而给出一颗按不动的按钮。
  const taskId = String(node?.runs?.[0]?.taskId || '').trim()
  return taskId ? error.message : null
}
