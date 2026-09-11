#!/usr/bin/env node
// 真实用户任务（R13/R16）：**在付费确认卡上改一个参数，到底发生了什么。**
//
// 2026-09-11（P1.1b）之前这一段有两个窟窿，都写在 docs/plan/2026-09-11 的「已知缺口」里：
//   · 改完参数价格不动（用户按下去时按钮上印的还是旧的数）；
//   · 卡体直接绑着画布上那个草稿节点，于是**还没答应花钱，画布已经被改了**。
//
// 这条走查逐拍钉住修好之后的时序（三个时刻，缺一不可）：
//   ① 改之前——画布节点的参数是 agent 定的那份，卡上的价是基价；
//   ② 改之后、按下之前——卡上的价**当场**变了，而画布节点**一个字都没动**；
//   ③ 按下之后——改动才回写进画布节点（主进程落候选 → 投影回画布，单向一条链）。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 像真人一样点：在面板里打字、在卡上点 chip、按那颗印着价的按钮——不灌 store、不直调桥。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const ASK = 'S_REPRICE_ASK：帮我生成一张六棱柱的图。'
const PLAN_CALL = 's-reprice-plan-1'
const PRICE_TOTAL = '[data-v4-price="total"]'
// 夹具目录里这一行的价目：基价 0.3，命中 `size:1536x1024` 再加 0.2（agent-runtime-fixture.mjs）。
// 两个数都不是走查编的——卡上印什么由那一行说了算。
const BASE_PRICE = '0.30'
const UPGRADED_PRICE = '0.50'
const BASE_SIZE = '1024x1024'
const UPGRADED_SIZE = '1536x1024'

const nodeSize = async (win, projectId) => {
  const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
  return nodes[0]?.meta?.size
}

const walk = await createRuntimeWalk('spend-reprice')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  // ① agent 建草稿。付费能力按设计不在模型工具面里，它能做的只有建草稿——
  // 「这笔钱花不花」由面板上那张卡来问。
  const planner = walk.fixture.expectText({
    label: 'the agent drafts a generation instead of spending on its own',
    match: (body) => flattenRequestText(body).includes('S_REPRICE_ASK'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'nomi_generation_plan', args: {
      operation: 'create',
      taskKind: 'text_to_image',
      prompt: '一个悬浮的六棱柱，柔和的演播室灯光',
      moduleId: 'generation.single-shot',
      providerId: FIXTURE_VENDOR,
      modelId: FIXTURE_IMAGE_MODEL,
      parameters: { size: BASE_SIZE },
    } },
  })
  const plannerDone = walk.fixture.expectText({
    label: 'the drafting turn completes through the same SDK turn',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL),
    reply: { type: 'text', text: 'S_REPRICE_DONE：草稿已就绪，等你确认。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'generation draft request')
  await recorded(plannerDone.received, 'generation draft result')

  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  // 时刻①：画布上那份草稿带的是 agent 定的参数。
  expect(await nodeSize(win, projectId), '改之前，画布节点的尺寸是 agent 定的那个').toBe(BASE_SIZE)

  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProof = await proveProbe(card, 'The paid confirmation card is on screen before anything is edited')
  await expect(card.locator(PRICE_TOTAL), '卡上的价是宿主按目录那一行算出来的基价').toContainText(BASE_PRICE)
  await walk.snap('reprice-01-before-edit')

  // ② 在卡上把尺寸换成会加价的那一档。chip 就是画布节点那条参数条上的控件，
  // 只是这个宿主把它摆成逐参数 chip（正在确认花多少钱，多一次点击最贵）。
  const sizeChip = card.locator('[data-parameter-chip] button[aria-label="尺寸"]').first()
  const chipProof = await proveProbe(sizeChip, 'The size chip is a live control on the paid card')
  await clickOrFail(sizeChip, '卡上的尺寸 chip')
  await clickOrFail(win.getByRole('option', { name: UPGRADED_SIZE }).first(), `尺寸选项 ${UPGRADED_SIZE}`)

  // 时刻②之一：价格**当场**变了。这是本轮修的那件事——本地按同一条算式重算，不等一个来回。
  await expect(card.locator(PRICE_TOTAL), '改完参数，价格行当场跟着动（基价 + 规格加价）')
    .toContainText(UPGRADED_PRICE, { timeout: DEFAULT_TIMEOUT_MS })
  // 主按钮上印的是同一个数：两个地方印同一件事，任何一个先漂都是在骗按下去的那个人。
  await expect(card.locator(INTERVENTION_CONFIRM)).toContainText(UPGRADED_PRICE)
  await walk.snap('reprice-02-price-follows-the-chip')

  // 时刻②之二：**画布节点一个字都没动**。价格已经变了 = 改动确实落下了，
  // 所以此刻读到的「没动」不是「还没来得及」，而是本轮拍板的语义：
  // 用户还没答应花这笔钱，画布就不该被改。
  expect(await nodeSize(win, projectId), '按下生成之前，画布上那个草稿节点不许被改').toBe(BASE_SIZE)

  // ③ 按下主按钮。改动这才回写：主进程 `generation.revise` 落进候选 → 投影回画布。
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), `确认并生成（${UPGRADED_PRICE}）`)
  await expect.poll(async () => nodeSize(win, projectId), { timeout: DEFAULT_TIMEOUT_MS }).toBe(UPGRADED_SIZE)
  await walk.snap('reprice-03-written-back-on-generate')

  // 「供应商真正收到的那份载荷也带着新尺寸」**本轮不断言**，而且不是忘了：
  // 这一族走查按 `NOMI_E2E_PRODUCTION_FIXTURE: '0'` 起，loopback 那个供应商根本没被
  // 装进生成 provider 面（实测 confirmSpend 回 `configured_provider`），所以生产提交那一段
  // 在这里跑不到底。把提交链接上是另一条分支（P1.1a「确认→生产零额度夹具」）的活。
  // 断言一个我们已经知道跑不到的行为，只会得到一条永远红着没人看的走查（R17）。
  //
  // 本轮要证的那条不变量并不依赖它：**卡上改的东西什么时候落到画布**——三个时刻都已钉死。
  expect(walk.fixture.images.length, '整场走查一次供应商生成都没发生（零额度）').toBe(0)

  walk.report.verified = ['price-follows-the-chip-immediately', 'canvas-node-untouched-until-generate',
    'candidate-written-back-on-generate', 'zero-provider-calls']
  walk.report.probes = { card: cardProof, sizeChip: chipProof }
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
