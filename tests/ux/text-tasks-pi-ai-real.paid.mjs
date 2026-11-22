#!/usr/bin/env node
// 真模型走查 · 文本任务迁 pi-ai 单次调用（设计卡 docs/plan/2026-10-21-text-tasks-to-pi-ai.md ★9 第 3 条）。
//
//   APIMART_API_KEY=… NOMI_SPEND_OK=1 node tests/ux/text-tasks-pi-ai-real.paid.mjs
//
// 本线不跑（协调带 key 跑一次）。key 只从运行时环境变量读（_paidEnvKey：APIMART_API_KEY），经可见接入页装进隔离副本，
// 不进日志 / 报告 / 截图，跑完整个隔离副本删除并断言已删（见 _paidRun.mjs）。
// 最小花费：思考型模型（DeepSeek V4 Pro）对 #1 文本节点扩写（流式）与 #2 改写选区（一次性）各一次，翻译、优化各一次，
// 输入都很短；不跑拆解（读图按镜计费，演练已覆盖它的接线）。每次调用打印一行摘要：入口、协议、首个可见反馈耗时、结果、错误类别。
// 步骤本体与零额度演练（text-tasks-pi-ai.rehearsal.walk.mjs）共用 _textTasksSteps.mjs。
import { BRAIN } from './_agentVideoPaid.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { CANVAS_PANEL, chooseAssistantModel, openCanvas } from './agent-runtime-walk-support.mjs'
import { runTextTaskEntries } from './_textTasksSteps.mjs'

const paid = await openPaidWalk('text-tasks-pi-ai-real.paid.mjs', 'text-tasks-pi-ai-real', [BRAIN])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)
  await win.keyboard.press('Escape')
  // 真模型：不逐字核结果，只核「有结果、不是错误」；预算档给到思考型模型（站点预算 16 档）。
  await runTextTaskEntries(win, { report: walk.report, snap: (name) => walk.snap(name), operations: 16 })
  console.log('\n摘要：')
  for (const row of walk.report.calls ?? []) console.log(`  ${row.entry} · ${row.protocol} · 首个可见反馈 ${row.firstFeedbackMs ?? '—'}ms · ${row.result} · ${row.errorKind ?? '—'}`)
} catch (error) {
  failure = error
  process.exitCode = 1
  console.error('text-tasks-pi-ai-real 走查失败:', error instanceof Error ? error.message : String(error))
} finally {
  await paid.finish(failure)
}
