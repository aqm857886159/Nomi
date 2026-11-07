// 评测轨迹：**每一次工具调用的入参、返回、校验错误原文、第几次重试、最终成不成**。
//
// ── 为什么它单独存在 ──
//
// 用户 2026-09-21 原话：「测试过程中会发现轨迹问题，里面经常有重试、参数出错，
// 这些轨迹都对我们后续优化有帮助。」
//
// 走查的 `report.json` 只记工具**名**（`tools=[read_script,draft_shots,…]`），
// 那是给人一眼看结论的，不是给人排查用的：一次 `draft_shots` 连发五遍到底是
// 「参数被拒了四次」还是「它在分五批建」，名字一列看不出半点。真相全在磁盘上那份
// lane transcript 里（`.nomi/agent-sessions/*.jsonl`，入参与返回原文都在），
// 但它是**按会话**存的、混着系统提示词和助手正文，没法按用例读。
//
// 这个模块只做一件事：把那份 transcript **按用例切开、按调用对齐**，
// 写成 `<outputDir>/trajectories/<caseId>.jsonl`，一行一次调用。
//
// ── 格式（一行一次调用，与 `docs/fixes/storyboard-reliability/round-*/trace.jsonl` 同族：
//    一行一条 JSON，字段自解释，不引入新框架）──
//
//   { caseId, seq, toolCallId, name, args, isError, resultText,
//     errorKind, retryOf, attempt, settled }
//
//   · `errorKind` —— 机器分类：`arg_rejected`（参数/schema 被拒）/ `domain_failed`（领域拒绝）
//     / `none`。分开是因为它们该被修的地方完全不同：前者是工具面不好用，后者是世界不允许。
//   · `retryOf` / `attempt` —— 「同一堵墙撞第几次」。判据与生产代码里的熔断**逐字相同**
//     （`laneRepeatedFailure.mts`：工具名 + 失败正文首行），所以这份轨迹里数出来的次数
//     和用户真机上熔断看到的次数是同一个数，不是第二套算法。
//   · `settled` —— 这次调用最终成没成（同一堵墙的最后一次是否 `isError: false`）。
//
// **通过的用例里的重试也要记**（用户点名）：所以这里不按 `isError` 过滤，全量落盘。
import fs from 'node:fs'
import path from 'node:path'

import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'

/** 参数被拒：pi 的 ajv、宿主准入码、宿主 zod 的字段级拒绝。与走查里那把尺子逐字相同。 */
const ARG_REJECTED = /Validation failed for tool|capability_input_invalid|generation_input_invalid|Unrecognized key\(s\)|must be (array|string|number|object)|Required/i

/**
 * 「同一堵墙」的粗尺子：工具名 + 失败正文首行。生产熔断（`electron/agentLane/laneRepeatedFailure.mts`
 * 的 `laneWallKey`）自 2026-11-07 起按「工具 + 失败码 + 出错字段路径」认墙，比这把细：不同字段的形状错
 * 首行相同，这里算一堵、生产算两堵。故意不跟改——修前 / 修后要用同一把尺子比；被熔断拦下的调用正文以
 * `<tool> was not run (tool_retry_stopped)` 开头，这里归 `domain_failed`，要单独数时按这个码筛。
 */
function wallKey(name, resultText) {
  return `${name} ${String(resultText).split('\n', 1)[0]}`
}

function classify(isError, resultText) {
  if (!isError) return 'none'
  return ARG_REJECTED.test(resultText) ? 'arg_rejected' : 'domain_failed'
}

/**
 * 读一个项目目录里**全部**的调用与结果，按 toolCallId 对齐。
 * 形状（2026-09-18 真机实测）：调用是 assistant 消息 `content` 里的 `{type:'toolCall', id, name, arguments}`，
 * 结果是独立的 `role:'toolResult'` 消息，带 `toolName` / `isError` / `content[].text`。
 */
export function readAlignedCalls(projectDir) {
  const calls = []
  const results = new Map()
  for (const session of readLaneTranscripts(projectDir)) {
    for (const message of laneMessages(session)) {
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type === 'toolCall') calls.push({ id: part.id, name: part.name, args: part.arguments })
        }
      } else if (message.role === 'toolResult') {
        const text = (Array.isArray(message.content) ? message.content : [])
          .filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
        results.set(message.toolCallId, { name: message.toolName, isError: message.isError === true, text })
      }
    }
  }
  return calls.map((call) => {
    const result = results.get(call.id)
    return {
      toolCallId: call.id,
      name: call.name,
      args: call.args,
      isError: result?.isError === true,
      resultText: result?.text ?? '',
      hasResult: Boolean(result),
    }
  })
}

/**
 * 给一串调用标上「同一堵墙撞第几次」与「最终成没成」。
 * **顺序敏感**：`attempt` 是这堵墙在这一串里出现的第几次，所以调用必须按真实时序传进来。
 */
export function annotateRetries(calls) {
  const seenWall = new Map()
  const annotated = calls.map((call, seq) => {
    const key = call.isError ? wallKey(call.name, call.resultText) : ''
    const previous = key ? seenWall.get(key) : undefined
    if (key) seenWall.set(key, { seq, toolCallId: call.toolCallId })
    return {
      ...call,
      seq,
      errorKind: classify(call.isError, call.resultText),
      attempt: key ? (previous ? (calls[previous.seq].attempt ?? 1) + 1 : 1) : 1,
      ...(previous ? { retryOf: previous.toolCallId } : {}),
    }
  })
  // 第二趟把 attempt 算对（第一趟里 `calls[previous.seq].attempt` 还没写上）。
  const counter = new Map()
  for (const row of annotated) {
    if (!row.isError) { row.attempt = 1; continue }
    const key = wallKey(row.name, row.resultText)
    const next = (counter.get(key) ?? 0) + 1
    counter.set(key, next)
    row.attempt = next
  }
  // `settled`：同一个工具名在这一串里**最后一次**是不是成功的。
  const lastByTool = new Map()
  for (const row of annotated) lastByTool.set(row.name, !row.isError)
  for (const row of annotated) row.settled = lastByTool.get(row.name) === true
  return annotated
}

/**
 * 把一次走查的轨迹按用例切开落盘。
 *
 * 切法：`report.json` 的每一轮都记了 `toolCalls`（按时序的工具名），而每一轮都是**新对话**，
 * 所以按「这一轮消费掉的调用条数」顺序切即可——不靠时间戳猜（跨进程时钟对不齐），
 * 也不靠 toolCallId 前缀猜（那是 pi 生成的，没有轮次信息）。
 */
export function writeTrajectories(outputDir, report, projectDir) {
  const dir = path.join(outputDir, 'trajectories')
  fs.mkdirSync(dir, { recursive: true })
  const all = annotateRetries(readAlignedCalls(projectDir))
  let cursor = 0
  const summary = []
  for (const row of report.cases ?? []) {
    const take = (row.toolCalls ?? []).length
    const slice = all.slice(cursor, cursor + take)
    cursor += take
    const file = path.join(dir, `${row.id}.jsonl`)
    fs.writeFileSync(file, slice.map((call, index) => JSON.stringify({
      caseId: row.id, userSays: index === 0 ? row.text : undefined, ...call,
    })).join('\n') + (slice.length ? '\n' : ''))
    summary.push({
      caseId: row.id, calls: slice.length,
      argRejected: slice.filter((call) => call.errorKind === 'arg_rejected').length,
      domainFailed: slice.filter((call) => call.errorKind === 'domain_failed').length,
      retried: slice.filter((call) => call.attempt > 1).length,
    })
  }
  // 「工具 × 错误类型 × 次数」那张表，报告直接抄。
  const byTool = new Map()
  for (const call of all) {
    const entry = byTool.get(call.name) ?? { tool: call.name, calls: 0, arg_rejected: 0, domain_failed: 0, retries: 0 }
    entry.calls += 1
    if (call.errorKind !== 'none') entry[call.errorKind] += 1
    if (call.attempt > 1) entry.retries += 1
    byTool.set(call.name, entry)
  }
  const matrix = [...byTool.values()].sort((a, b) => b.calls - a.calls)
  fs.writeFileSync(path.join(dir, '_matrix.json'), JSON.stringify({ perCase: summary, byTool: matrix }, null, 2))
  return { totalCalls: all.length, unassigned: all.length - cursor, perCase: summary, byTool: matrix }
}
