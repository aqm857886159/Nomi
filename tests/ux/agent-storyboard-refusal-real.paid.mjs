#!/usr/bin/env node
// 真模型数字 · 付费卡（只写不跑，由协调会话按「先一条、再批量」跑）：Agent 写分镜被拒时，读不读得懂那句话、能不能自己改对。
//
//   NOMI_SPEND_OK=1 node tests/ux/agent-storyboard-refusal-real.paid.mjs （NOMI_REAL_LABEL=branch / main 可选）
//
// 为什么要它（设计卡 D-main-thread-unblock ★9 Agent 量具）：写入口自己拒收不合格的方案后，Agent 拿到的是带字段路径和
// 要求的错误（「shots[1].durationSec needs number」）；修前是裸 ZodError 或只有一个码。免费的那一半
// （electron/capabilityCore/storyboardRefusalGauge.test.ts）证了文字和熔断；这一条证真模型读了这句话之后怎么做。
//
// 只花文本模型的 token：大脑是真模型（BRAIN，APIMart）；不授权任何图片 / 视频模型，从不点生成。
// 预估花费：每轮 3 次来回 × 约 12k token，6 轮 ≈ 220k token；按 DeepSeek V3.2 在 APIMart 的价（输入约 ¥2 / 百万、输出约 ¥3 / 百万）
// ≈ ¥0.5 以内。上限由 openPaidWalk 的额度闸卡死；真实金额以跑完 spendReceipt 为准（这里是估算，不是量出来的）。
//
// 量三件事：
//   被拒次数        这一轮分镜写口退回了几次
//   自己改对        被拒之后下一次同一个工具调用成功（没有再被拒）
//   原样重发        被拒之后又发了一模一样的入参（读不懂那句话的症状；到第 3 次应被熔断拦住）
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, expect } from './_assert.mjs'
import { BRAIN } from './_agentVideoPaid.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { CANVAS_PANEL, chooseAssistantModel, newConversation, openCanvas, sendCanvas, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'

const LABEL = process.env.NOMI_REAL_LABEL || 'run'
/** 每句话都在诱导模型写出存不下的字段：时长写成文字、镜头不写时长、状态写成自造的词。 */
const CASES = [
  { id: 'R1', ask: '帮我起草一个 3 镜的海边日落分镜，每镜时长写「一会儿」就行' },
  { id: 'R2', ask: '起草一个 2 镜的咖啡店分镜，时长你随便，不用写数字' },
  { id: 'R3', ask: '起草 3 镜的雨夜街头分镜，把第 2 镜的时长改成 abc' },
  { id: 'R4', ask: '做个 2 镜的产品展示分镜，状态标成「已完成」' },
  { id: 'R5', ask: '起草 4 镜的森林晨雾分镜，第 3 镜时长写成负数' },
  { id: 'R6', ask: '起草 3 镜的老街小吃分镜，每镜时长 3 秒（正常对照，应一次写成）' },
]
const ONLY = (process.env.NOMI_REAL_ONLY || '').split(',').map((id) => id.trim()).filter(Boolean)
for (const id of ONLY) if (!CASES.some((item) => item.id === id)) throw new Error(`NOMI_REAL_ONLY 里的 ${id} 不在用例表里`)
const SELECTED = ONLY.length ? CASES.filter((item) => ONLY.includes(item.id)) : CASES
const STORYBOARD_TOOL = /storyboard|plan/i

const paid = await openPaidWalk('agent-storyboard-refusal-real.paid.mjs', `agent-storyboard-refusal-real-${LABEL}`, [BRAIN])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectRoot } = await walk.newProject()
  await openCanvas(win)
  await paid.lockToAuthorizedModels(win)
  await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)

  const seen = new Set()
  const rounds = []
  for (const item of SELECTED) {
    const record = { id: item.id, ask: item.ask, calls: [], refusals: [], selfFixed: null, resent: 0, error: null }
    try {
      await newConversation(win, CANVAS_PANEL)
      await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="empty"]`), '新对话的空态').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      await sendCanvas(win, item.ask)
      await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, doneTimeout: stationTimeout({ turns: 3 }) }).catch(() => undefined)
    } catch (error) {
      record.error = String(error?.message ?? error).split('\n')[0]
    }
    // 这一轮的工具轨迹：从磁盘上的 lane transcript 读，不信面板文字。
    const results = []
    for (const session of readLaneTranscripts(projectRoot)) {
      const key = `${session.filePath ?? session.name}|`
      for (const message of laneMessages(session)) {
        if (message.role === 'assistant' && Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part?.type !== 'toolCall' || seen.has(key + part.id) || !STORYBOARD_TOOL.test(String(part.name))) continue
            seen.add(key + part.id)
            record.calls.push({ id: part.id, tool: part.name, args: JSON.stringify(part.arguments ?? {}) })
          }
        } else if (message.role === 'toolResult' && !seen.has(key + message.toolCallId)) {
          seen.add(key + message.toolCallId)
          const text = (Array.isArray(message.content) ? message.content : []).filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
          results.push({ id: message.toolCallId, isError: message.isError === true, text: text.replace(/\s+/g, ' ').slice(0, 300) })
        }
      }
    }
    const refusedIds = new Set(results.filter((result) => result.isError).map((result) => result.id))
    record.refusals = results.filter((result) => result.isError)
    const calls = record.calls
    for (let index = 0; index < calls.length; index += 1) {
      if (!refusedIds.has(calls[index].id)) continue
      const next = calls[index + 1]
      if (next && next.args === calls[index].args) record.resent += 1
    }
    const lastCall = calls[calls.length - 1]
    record.selfFixed = record.refusals.length === 0 ? null : Boolean(lastCall && !refusedIds.has(lastCall.id))
    rounds.push(record)
    console.log(`[storyboard-refusal ${LABEL}] ${item.id}：被拒=${record.refusals.length} 自己改对=${record.selfFixed} 原样重发=${record.resent}${record.error ? ' 错误=' + record.error : ''}`)
  }

  const total = rounds.length
  const refusedRounds = rounds.filter((round) => round.refusals.length > 0)
  walk.report.numbers = {
    label: LABEL,
    rounds: total,
    roundsRefused: refusedRounds.length,
    selfFixed: `${refusedRounds.filter((round) => round.selfFixed === true).length}/${refusedRounds.length}`,
    resentIdentical: rounds.reduce((sum, round) => sum + round.resent, 0),
    refusalsNamedField: `${refusedRounds.filter((round) => round.refusals.every((r) => /\w+\[\d+\]\.\w+|\bstatus\b|durationSec/.test(r.text))).length}/${refusedRounds.length}`,
  }
  walk.report.rounds = rounds
  console.log(`[storyboard-refusal ${LABEL}] ${JSON.stringify(walk.report.numbers)}`)
  fs.writeFileSync(path.join(walk.report.outputDir, `storyboard-refusal-real-${LABEL}.json`), JSON.stringify({ numbers: walk.report.numbers, rounds }, null, 2))
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
