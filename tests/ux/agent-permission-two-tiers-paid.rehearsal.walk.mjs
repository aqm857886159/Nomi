#!/usr/bin/env node
// #1203 真付费走查的 loopback 演练：**零额度**。把真付费走查（agent-permission-two-tiers.paid.mjs）的步骤本体
// （_permissionTiersPaidSteps.mjs）原样跑在 loopback 夹具上——供应商是本机夹具、大脑是夹具里写好剧本的那个，
// 其余（Electron、IPC、制作 Run 落盘、收据库、渲染层、权限弹层、报价卡、停止钮、事实读数与判据）全是真的。
//
// 它证的是「真付费走查的脚本走得通、读数读得出、判据判得对」，不证模型自己会怎么调工具（那只有真付费能证）。
// 与真付费的差别只有两处：①大脑是剧本；②第 4 步里夹具把第二张的受理压在门口，让「受理第一张后点停止」稳定赶得上。
import path from 'node:path'

import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import {
  IMAGE_CAP, IMAGE_HARD_CAP, collectProblems, createSpendCap, createStepContext, runCanvasDirectStep, runPlanAndBrakeStep, runStopStep, runSwitchStep,
  settleTurn, switchAppLocale,
} from './_permissionTiersPaidSteps.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import { countLaneToolCalls } from './_paidFacts.mjs'
import { CANVAS_PANEL, COMPOSER, CREATION_PANEL, createRuntimeWalk, expandResidentPanel, hasToolResult, sendCanvas, sendCreation } from './agent-runtime-walk-support.mjs'

// 夹具目录里的生成模型没有价目：和干净装机一样（见 agent-spend-confirm-executes.walk.mjs）。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const PLAN_MARK = 'S_PAID_PLAN'
const CANVAS_MARK = 'S_PAID_CANVAS'
const STOP_MARK = 'S_PAID_STOP'
const PLAN2_MARK = 'S_PAID_PLAN2'
const NOGEN_MARK = 'S_PAID_NOGEN'
const ASK_PLAN = `${PLAN_MARK}：按文稿把这两句拆成 2 个镜头各出一张图，现在就生成。`
const ASK_PLAN_MORE = `${PLAN2_MARK}：再补第 3 个镜头，也现在就生成。`
const ASK_NOGEN = `${NOGEN_MARK}: draft one more shot.`
const ASK_CANVAS = `${CANVAS_MARK}：生成 2 张参考图。`
const ASK_STOP = `${STOP_MARK}: generate 2 more images.`
const candidate = { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL }
const shot = (title, prompt) => ({ title, prompt, taskKind: 'text_to_image', candidate })
/** 最后一条用户消息：同一个会话里前面几轮的口令还留在历史里，认口令只认最新这一条。 */
const lastUserText = (body) => flattenRequestText({ messages: (body.messages ?? []).filter((message) => message.role === 'user').slice(-1) })
const toolResultText = (body, callId) => String((body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === callId)?.content ?? '')
/** generate 的结果说「档位替你答了、已经开跑」（宿主回给模型的那句，见 agent-spend-real-image.paid.mjs 的同一判据）。 */
const startedResult = (body, callId) => /full-auto approval mode/i.test(toolResultText(body, callId))
const operationIdOf = (body, callId) => {
  const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === callId)
  return /"operationId":"([^"]+)"/.exec(String(result?.content ?? ''))?.[1]
}

/** 剧本大脑：按「已经收到哪几个工具结果」走状态机，不依赖请求先后（常驻应答，不计入「没用上」）。 */
function installBrain(fixture) {
  // 文稿方案分两轮：第一轮 2 镜，第二轮补第 3 镜（补到同一个方案上）。
  fixture.respond({
    label: 'rehearsal brain · plan round 1 (two shots)',
    match: (body) => lastUserText(body).includes(PLAN_MARK) && !lastUserText(body).includes(PLAN2_MARK),
    reply: (body) => {
      if (!hasToolResult(body, 'rh-plan-1')) return { type: 'tool', id: 'rh-plan-1', name: 'draft_shots', args: { shots: [shot('渔港清晨', '渔港清晨，薄雾，渔船出港'), shot('日落归航', '日落时分，金色海面，渔船归航')] } }
      if (!hasToolResult(body, 'rh-plan-1-generate')) return { type: 'tool', id: 'rh-plan-1-generate', name: 'generate', args: { operationId: operationIdOf(body, 'rh-plan-1') } }
      return { type: 'text', text: `${PLAN_MARK}_DONE：好了。` }
    },
  })
  fixture.respond({
    label: 'rehearsal brain · plan round 2 (a third shot)',
    match: (body) => lastUserText(body).includes(PLAN2_MARK),
    reply: (body) => {
      if (!hasToolResult(body, 'rh-plan-2')) return { type: 'tool', id: 'rh-plan-2', name: 'draft_shots', args: { shots: [shot('渔港夜景', '渔港夜景，灯火')] } }
      if (!hasToolResult(body, 'rh-plan-2-generate')) return { type: 'tool', id: 'rh-plan-2-generate', name: 'generate', args: { operationId: operationIdOf(body, 'rh-plan-2') } }
      return { type: 'text', text: `${PLAN2_MARK}_DONE：好了。` }
    },
  })
  // 阴性对照：只建草稿、不调 generate（D-L19 诊断的 V4 Flash 的样子）。
  fixture.respond({
    label: 'rehearsal brain · drafts but never calls generate',
    match: (body) => lastUserText(body).includes(NOGEN_MARK),
    reply: (body) => (hasToolResult(body, 'rh-nogen-1')
      ? { type: 'text', text: `${NOGEN_MARK}_DONE：草稿建好了。` }
      : { type: 'tool', id: 'rh-nogen-1', name: 'draft_shots', args: { shots: [shot('只建草稿', '只建草稿，不生成')] } }),
  })
  fixture.respond({
    label: 'rehearsal brain · canvas (two shots, generate)',
    match: (body) => lastUserText(body).includes(CANVAS_MARK),
    reply: (body) => {
      if (!hasToolResult(body, 'rh-canvas-1')) return { type: 'tool', id: 'rh-canvas-1', name: 'draft_shots', args: { shots: [shot('日出一', '日出海面，构图一'), shot('日出二', '日出海面，构图二')] } }
      if (!hasToolResult(body, 'rh-canvas-1-generate')) return { type: 'tool', id: 'rh-canvas-1-generate', name: 'generate', args: { operationId: operationIdOf(body, 'rh-canvas-1') } }
      return { type: 'text', text: `${CANVAS_MARK}_DONE：好了。` }
    },
  })
  fixture.respond({
    label: 'rehearsal brain · stop (two shots, then a slow reply that keeps the turn running)',
    match: (body) => lastUserText(body).includes(STOP_MARK),
    reply: (body) => {
      if (!hasToolResult(body, 'rh-stop-1')) return { type: 'tool', id: 'rh-stop-1', name: 'draft_shots', args: { shots: [shot('calm harbour', 'a calm harbour at night'), shot('stormy harbour', 'a stormy harbour at night')] } }
      if (!hasToolResult(body, 'rh-stop-1-generate')) return { type: 'tool', id: 'rh-stop-1-generate', name: 'generate', args: { operationId: operationIdOf(body, 'rh-stop-1') } }
      // 慢慢吐：让这一轮在宿主派发期间一直处在「运行中」，停止钮才点得到。
      return { type: 'stream', text: `${STOP_MARK}_DONE ${'.'.repeat(400)}`, chunkChars: 2, intervalMs: 100 }
    },
  })
}

const walk = await createRuntimeWalk('permission-two-tiers-paid-rehearsal', { generationProvider: 'apimart' })
let cap
let failure
try {
  installBrain(walk.fixture)
  const { win } = await walk.start({ first: true })
  const { projectRoot } = await walk.newProject()
  await expandResidentPanel(win)
  await expect(win.locator(`${CREATION_PANEL} ${COMPOSER}`)).toBeVisible({ timeout: stationTimeout({ operations: 4 }) })

  cap = createSpendCap({ projectRoot, stopApp: () => walk.stopApp() })
  const ctx = createStepContext({
    win, walk, projectRoot, capabilityDir: path.join(walk.report.tempRoot, 'capability'),
    allowedModel: `${FIXTURE_APIMART_VENDOR}/${FIXTURE_APIMART_MODEL}`, cap,
    ask: async (kind, text) => {
      if (kind === 'stop') {
        // 第一张的受理放行，紧接着把后面的受理压在夹具门口（与 agent-spend-stop-midway 同一手法）。
        walk.fixture.holdSubmits(true)
        const imagesBefore = walk.fixture.images.length // 前面画布那一步已经发过 2 张：只等这一步的第一张
        void (async () => {
          const deadline = Date.now() + stationTimeout({ turns: 1 })
          while (walk.fixture.images.length <= imagesBefore && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
          walk.fixture.holdSubmits(false)
          walk.fixture.holdSubmits(true)
        })()
      }
      await (kind === 'plan' || kind === 'plan2' ? sendCreation(win, text) : sendCanvas(win, text))
    },
  })
  walk.report.imageCap = { planned: IMAGE_CAP, worst: IMAGE_HARD_CAP }
  await runSwitchStep(ctx)
  const plan = await runPlanAndBrakeStep(ctx, { askText: ASK_PLAN, askMoreText: ASK_PLAN_MORE })
  if (plan.accepted < 2) await runCanvasDirectStep(ctx, { askText: ASK_CANVAS })
  if ((await win.evaluate(() => localStorage.getItem('nomi:locale:v1'))) !== 'en') await switchAppLocale(win, 'en')
  try {
    await runStopStep(ctx, { askText: ASK_STOP, graceMs: 2_000, settleMs: 5_000 })
  } finally {
    walk.fixture.holdSubmits(false)
  }
  cap.assertNotBreached()
  // 阴性对照：大脑只建草稿不调 generate——「调过几次 generate」的读数要分得出来（正对照：前面真调过）。
  const generatesBefore = countLaneToolCalls(projectRoot, 'generate')
  expect(generatesBefore, '读数的正对照：前面几步 Agent 真调过 generate').toBeGreaterThan(0)
  await ctx.ask('nogen', ASK_NOGEN)
  await settleTurn(win, CANVAS_PANEL)
  expect(countLaneToolCalls(projectRoot, 'generate'), '只建草稿的这一轮没有新增 generate 调用').toBe(generatesBefore)
  const { problems, unverified } = collectProblems(walk.report.steps)
  walk.report.unverified = unverified
  walk.report.paidCalls = 0
  // 文稿方案（#1224 协调定 A：两档下都每批问一次）：第一轮整批确认恰好 1 次、走查点确认、受理 2、决定人是人；
  // 第二轮补第 3 镜再弹整批确认（不是刹车卡，刹车没接到这条路上）→ 取消、不发、记 unverified。
  const manuscript = walk.report.steps['2-manuscript-first-two-shots']
  expect(manuscript?.batchDialogs, '文稿方案第一轮整批确认恰好弹一次').toBe(1)
  expect(manuscript?.confirmedByWalk, '走查点了确认').toBe(true)
  expect(walk.report.steps['3-out-of-plan-brake']?.outcome, '第二轮补第 3 镜弹了整批确认（不是刹车卡）').toBe('dialog')
  expect(walk.report.steps['2b-canvas-direct-two-images'], '文稿方案受理够了，不走回退').toBeUndefined()
  if (problems.length) throw new Error(`演练里有不成立的事实：${problems.join('；')}`)
  walk.report.verified = Object.keys(walk.report.steps).filter((name) => !unverified.includes(name))
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  cap?.stop()
  await walk.finish(failure)
}
