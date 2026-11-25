#!/usr/bin/env node
// 真付费 · 测试表第 15 行：2 张图，卡上把第 2 张「不生成 ×」、按主按钮 → 供应商那边只多 1 个任务（只跑一次）。
//
//   NOMI_SPEND_OK=1 node tests/ux/agent-spend-per-shot-real.paid.mjs
//
// D2：卡 = 指向元素 + 一行只读摘要 + 主按钮；去掉一镜是它那一格上的「不生成 ×」（可撤回），按下去交给画布那一台
// （和节点 ↑ 同一条提交），作业住在画布那一镜的单镜 Run 里（同样在 `.nomi/runs/` 下，收据照读）。
// 大脑是真模型（APIMart 的 DeepSeek V3.2），图片模型是真的（APIMart 的 Nano Banana 2），花的是这台机器上用户自己配的 key：
// 一张图的钱 + 几轮文本 token。凭据与原库保护见 _paidRun.mjs / _realProfile.mjs：明文 key 不落地、跑完删凭据副本、
// 原库指纹跑前跑后比对；收据（这一场真正发生的付费调用）写进报告。
import fs from 'node:fs'
import path from 'node:path'

import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { BRAIN } from './_agentVideoPaid.mjs'
import { openPaidWalk, readProductionRuns, spendReceipt } from './_paidRun.mjs'
import { CARD_PRIMARY, POINTER, SPEND_CARD, excludeShot, offerRows, pointerAway, primaryLabel } from './_spendCardWalk.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { CANVAS_PANEL, chooseAssistantModel, openCanvas, sendCanvas, waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'

const IMAGE = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
const ASK = '画两张图：一张雨后水洼里漂着红色纸船，一张窗台上晒太阳的橘猫，都是 1:1。起草好就直接提交生成，我在卡上决定生成哪张。'

const paid = await openPaidWalk('agent-spend-per-shot-real.paid.mjs', 'agent-spend-per-shot-real', [BRAIN, IMAGE])
const { walk } = paid
walk.report.rows = {}
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectRoot } = await walk.newProject()
  await openCanvas(win)
  await paid.lockToAuthorizedModels(win)
  await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)
  const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await noShare.isVisible().catch(() => false)) await noShare.click()

  await sendCanvas(win, ASK)
  const card = win.locator(SPEND_CARD)
  await expect(card.locator(CARD_PRIMARY), '确认条答应的是这 2 张').toContainText(primaryLabel('zh-CN', { count: 2, kind: 'image' }), { timeout: stationTimeout({ turns: 2 }) })
  const pointers = await offerRows(card).locator(POINTER).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-node-pointer-id')))
  expect(pointers, '对话里那一组指着画布上的两个节点').toHaveLength(2)
  await pointerAway(win)
  walk.report.rows['15-card'] = await walk.snap('15-card-two')
  await excludeShot(card, pointers[1], '第 2 张「不生成 ×」')
  await pointerAway(win)
  walk.report.rows['15-one-excluded'] = await walk.snap('15-card-one-excluded')
  const probe = await proveProbe(card, '去掉了第 2 张的卡')
  await clickOrFail(card.locator(CARD_PRIMARY), '卡上的主按钮（真花钱，一张）', { noWaitAfter: true })
  await expectAbsent(card, { provenBy: probe, message: '交给画布之后卡关掉' }, stationTimeout({ operations: 4 }))
  // 等那一张真的出图（真供应商要几十秒）。画布单镜 Run 也在 `.nomi/runs/` 下。
  await expect.poll(() => readProductionRuns(projectRoot).flatMap((run) => run.jobs ?? []).filter((job) => job.status === 'ready' || job.status === 'adopted').length,
    { message: '第 1 张出图', timeout: stationTimeout({ operations: 20 }) }).toBe(1)
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, doneTimeout: stationTimeout({ turns: 1 }) }).catch(() => undefined)
  walk.report.rows['15-landed'] = await walk.snap('15-landed')
  const runs = readProductionRuns(projectRoot)
  const jobs = runs.flatMap((run) => (run.jobs ?? []).map((job) => ({ runId: run.runId, kind: run.kind ?? null, status: job.status, providerTaskId: job.providerTaskId ?? null })))
  const receipt = spendReceipt(projectRoot)
  walk.report.row15 = { jobs, mediaTasks: receipt.media, presentations: runs.map((run) => run.generationPlan?.presentations ?? []) }
  console.log(`[real-15] 作业：${JSON.stringify(jobs)}；供应商任务：${receipt.media.length}`)
  expect(receipt.media.length, '供应商那边只多 1 个任务').toBe(1)
  expect(jobs.filter((job) => job.providerTaskId).length, '只有一镜交给了供应商').toBe(1)
  fs.writeFileSync(path.join(walk.report.outputDir, 'row15.json'), JSON.stringify(walk.report.row15, null, 2))
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
