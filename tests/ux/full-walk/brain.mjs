// 剧本里那颗「Agent 大脑」的写法：夹具只替换远端的文本模型，SDK / IPC / 宿主 / 渲染层全是真的。
//
// 大脑按真实模型会做的那样出牌：读用户这一句 → 调工具 → 读工具结果 → 再调工具或说话。
// 每一轮是一串「期望」（agent-runtime-fixture 的 expectText），第 k 个期望认的是第 k-1 次工具调用的结果，
// 所以参数可以从上一次的结果里算（例如 generate 要的 operationId 来自 draft_shots 的结果）。
//
// 大脑说的话由剧本给——它不是被测对象。被测的是**宿主递给大脑的东西**（工具结果 / 回执），监视器从夹具请求里读它们。
import { expect } from '../_assert.mjs'
import { stationTimeout } from '../_station-budget.mjs'
import { flattenRequestText } from '../agent-runtime-fixture.mjs'

/**
 * 一步最长等多久：宿主把这一步的请求发到大脑这里，按 station 预算的一个模型回合算（安全上限，不是完成条件）。
 * 等不到就明说「宿主没把请求发过来」，不让剧本挂到跑器的总超时（第一版一次附件没导进来，剧本在这里干等了 40 分钟）。
 */
const STEP_ARRIVAL_BUDGET_MS = stationTimeout({ turns: 1 })

/** 这一次请求里最后一条用户消息的文字（历史里的旧话不算，免得下一轮又被上一轮的期望认走）。 */
export function lastUserText(body) {
  const users = (body?.messages ?? []).filter((message) => message?.role === 'user')
  return flattenRequestText({ messages: users.slice(-1) })
}

/** 某次工具调用的结果正文（宿主递给模型的原话）。 */
export function toolResultText(body, callId) {
  const message = (body?.messages ?? []).find((entry) => entry?.role === 'tool' && entry.tool_call_id === callId)
  if (!message) return null
  return typeof message.content === 'string' ? message.content : (message.content ?? []).map((part) => part?.text ?? '').join('\n')
}

/** 最后一条消息是不是某次工具调用的结果（「轮到大脑读这个结果了」）。 */
function answersCall(body, callId) {
  const last = (body?.messages ?? []).at(-1)
  return last?.role === 'tool' && last.tool_call_id === callId
}

/**
 * 写一轮。`steps` 依次是 `{ name, args, text? }`（调工具，args 可以是函数 `({ previous, body }) => args`）
 * 或 `{ text }`（说话收尾）。返回每一步的「到达」promise 和工具调用 id。
 * 每一步从上一步落地起最多等 STEP_ARRIVAL_BUDGET_MS；等不到，这一步和它后面的每一步都以「宿主没发」拒绝。
 */
export function scriptTurn(fixture, { label, marker, steps }) {
  if (!steps.length) throw new Error('scriptTurn needs at least one step')
  const callIds = steps.map((_, index) => `${label}-${index}`)
  const landed = steps.map(() => null)
  const failures = steps.map(() => null)
  // 回复一到就放（宿主那边在等模型），和下面「调用方最多等多久」是两件事，互不耽误。
  steps.forEach((step, index) => {
    const match = index === 0
      ? (body) => lastUserText(body).includes(marker) && !(body?.messages ?? []).some((message) => message?.role === 'tool' && callIds.includes(message.tool_call_id))
      : (body) => answersCall(body, callIds[index - 1])
    const handle = fixture.expectText({ label: `${label} #${index}`, match, reply: { type: 'hold' } })
    void handle.received.then((record) => {
      const previous = index === 0 ? null : toolResultText(record.body, callIds[index - 1])
      const context = { previous, body: record.body }
      // 工具那一步写成 `{ name, args }`——和夹具回复同一个形状，check:walkthrough-tool-args 才认得出、才去对 schema。
      const reply = step.name
        ? { type: 'tool', id: callIds[index], name: step.name, args: typeof step.args === 'function' ? step.args(context) : step.args, ...(step.text ? { text: typeof step.text === 'function' ? step.text(context) : step.text } : {}) }
        // 供应商整条回 HTTP 错误（带原始 JSON 体）：走「服务商报错 → Agent 面板那一行」。
        : step.httpError ? { type: 'http-error', status: step.httpError.status, json: step.httpError.json }
          : { type: 'text', text: typeof step.text === 'function' ? step.text(context) : step.text }
      handle.release(reply)
      // 同一步被宿主重发（压缩之后重试、上下文超限之后重试）：真模型会给出同样的回答。
      // 一次性期望已经用掉了，这里补一个只认「这一步」的常驻应答，免得夹具把重试判成计划外请求。
      fixture.respond({ label: `${label} #${index} (retry)`, match, reply })
      landed[index] = { record, previous, reply }
    }).catch((error) => {
      // 出牌本身出错（例如 args 函数读不到上一步的结果）：记下，交给等这一步的人。
      failures[index] = error
    })
  })
  const arrivals = []
  let chain = Promise.resolve()
  steps.forEach((_, index) => {
    chain = chain.then(async () => {
      await expect.poll(() => landed[index] !== null || failures[index] !== null, {
        message: `${label} #${index}：宿主一直没把这一步的请求发给大脑（最多等 ${STEP_ARRIVAL_BUDGET_MS / 1000}s）`,
        timeout: STEP_ARRIVAL_BUDGET_MS,
      }).toBe(true)
      if (failures[index]) throw failures[index]
      return landed[index]
    })
    // 剧本可能只等最后一步：前面某一步的拒绝不许变成「未处理的拒绝」把进程带崩（等它的人照样拿到拒绝）。
    chain.catch(() => {})
    arrivals.push(chain)
  })
  return { callIds, arrivals, done: arrivals.at(-1) }
}

/** 从工具结果里取 operationId（draft_shots / generate 的结果都带它）。 */
export function operationIdOf(text) {
  return /"operationId":"([^"]+)"/.exec(String(text ?? ''))?.[1] ?? null
}

/**
 * App 自己在后台发起、次数不定的文本调用（不是用户这一轮）：给它们一个像样的回答，别让夹具判成「计划外请求」。
 *   · 出图后的镜级审片（`src/workbench/generationCanvas/agent/shotVerify.ts`）：回一份中规中矩的分数。
 */
export function standingBackgroundResponders(fixture) {
  fixture.respond({
    label: 'shot review after an image lands (shotVerify)',
    match: (body) => flattenRequestText(body).includes('资深影视分镜审片'),
    reply: { type: 'text', text: '{"reason":"画面与提示词一致","scores":{"identity":4,"aesthetics":4,"intent":4}}' },
  })
  // 上下文压缩（pi `compaction.js` 的 SUMMARIZATION_SYSTEM_PROMPT）：真供应商会老老实实回一份摘要。
  fixture.respond({
    label: 'context compaction summary (pi compaction)',
    match: (body) => JSON.stringify(body?.messages?.[0] ?? {}).includes('context summarization assistant'),
    reply: { type: 'text', text: '## Goal\n用户在改一份海港剧本。\n## Progress\n已经扩写并收紧了几轮。\n## Next Steps\n按用户下一句继续。' },
  })
}
