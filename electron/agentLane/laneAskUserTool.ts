// `ask_user` 的执行那一半。**「他答上了」是成功，不是失败**（2026-09-22）。
//
// 这个工具的全部内容就是停在审批闸里等人：契约声明 `alwaysAsksUser`，`capabilityIsHardGated` ⑥
// 保证任何档位、任何会话级授权都不会替用户答。用户在卡上点完选项 / 打完字之后，闸把他的原话记在
// `answerFor`，放行这次调用，`execute` 在这里把那句话原样交回去。
//
// ── 为什么单独一个文件 ──
//
// 在此之前「答上了」走的是闸的 `allow: false` → 宿主的 `block`，而 pi 对 `block` 是**硬编码**的
// `immediateError(… isError: true)`（`pi-agent-core/dist/harness/execution/tools.js`），再由 `pi-ai`
// 原样映射成 Anthropic `tool_result.is_error: true`。于是每一次「用户答了卡」，模型收到的都是一条
// **「ask_user 失败了」**，正文恰好是他那句答案；Nomi 自己还拿 `event.isError` 计「连续撞墙」——
// 用户每答一次卡，就给这一轮的熔断计数器加一格（run4：6 次 `ask_user` 全中）。
// 既是错误形状，又在教模型「问了会失败」。
//
// 修在源头之后，这条路要有一个**不起半个桌面就能跑**的回归测试（`tests/agent-runtime/lane-approval-gate.test.mts`
// 用的就是这里导出的这一份）。焊在 `laneDesktopTools` 里就意味着测试只能自己再写一份 execute——
// 那测的是测试自己写的那份，不是产品里跑的那份。
import { AGENT_ASK_CAPABILITY } from '../shared/agentCapabilities/askUser'
import { specsForCapability } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { LaneDomainFailure, bindLaneTool, type LaneToolDescriptor } from './laneRuntimePort'

/** 用户在提问卡上答完之后，模型读到的那条**成功**结果的正文就是他的原话。 */
export function createAskUserLaneTools(onAnswer?: (answer: string) => void): LaneToolDescriptor[] {
  return specsForCapability(AGENT_ASK_CAPABILITY.id).map(spec => bindLaneTool(spec, async (_args, context) => {
    const answer = context.approvalAnswer?.trim()
    if (answer) {
      onAnswer?.(answer)
      // **只有他那句话**，没有第二行。宿主会把 `nextAction.userSees` 拼成一行
      // `User sees: …` 附在正文后面（`laneTools.mts`），而这里多说一句的代价是：
      // 模型读到的不再是「用户说了什么」，是「用户说了什么 + Nomi 的旁白」。
      // 面板那一行（「已回答 · 原话」）由审批记录画，不靠回执。
      return { ok: true as const, text: answer, details: { answered: true } }
    }
    // fail-closed：读不到答案 = 这条会话没有能问的人（没装闸 / MCP stdio / 后台批）。
    // 那时候唯一诚实的回答是说清楚这件事，而不是回一句空答案让模型当成用户说过的话。
    throw new LaneDomainFailure({
      code: 'question_has_no_one_to_ask',
      message: 'This session has no user to ask, so the question was not shown to anyone.',
      nextAction: 'Do not ask again here. Say what you would have asked and what you will assume, then carry on with your best default.',
    })
  }))
}
