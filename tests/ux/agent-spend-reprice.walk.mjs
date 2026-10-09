#!/usr/bin/env node
// 真实用户任务（R13/R16）：**在付费确认卡上改一个参数，到底发生了什么。**
//
// 2026-09-11（P1.1b）之前这一段有两个窟窿，都写在 docs/plan/2026-09-11 的「已知缺口」里：
//   · 改完参数价格不动（用户按下去时按钮上印的还是旧的数）；
//   · 卡体直接绑着画布上那个草稿节点，于是**还没答应花钱，画布已经被改了**。
//
// 这条走查逐拍钉住修好之后的时序（三个时刻，缺一不可）：
//   ① 改之前——画布节点的参数是 agent 定的那份，卡上的参数也是那份；
//   ② 改之后、按下之前——卡上的参数**当场**变了，而画布节点**一个字都没动**；
// 合同 contract-moneycopy（#1099，提交 184ea8997）：卡上不再印 Nomi 按价目表算的金额。原先「价格当场跟着动」
// 是拿金额当「改动已在卡上落下」的证据；金额删了，证据换成卡上那颗尺寸 chip 本身当场显示新值，另断言卡上不出金额。
//   ③ 按下之后——改动才回写进画布节点（主进程落候选 → 投影回画布，单向一条链）。
//
// 断言到③为止：再往后那条「手势 → 收据 → 门 → start → 出站」本轮实测仍然不通，
// 见文件末尾那段说明与计划文档的已知缺口 ⑥。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 像真人一样点：在面板里打字、在卡上点 chip、按那颗印着价的按钮——不灌 store、不直调桥。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas, closeSpendCard,
} from './agent-runtime-walk-support.mjs'

const ASK = 'S_REPRICE_ASK：帮我生成一张六棱柱的图。'
const PLAN_CALL = 's-reprice-plan-1'
const GENERATE_CALL = `${PLAN_CALL}-generate`
const PRICE_TOTAL = '[data-v4-price="total"]'
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
    reply: { type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
      // 20 动词：draft_shots 建草稿（落画布、不出卡），generate 才把报价卡摆到用户面前。
      shots: [{ prompt: '一个悬浮的六棱柱，柔和的演播室灯光', taskKind: 'text_to_image', candidate: { providerId: FIXTURE_VENDOR, modelId: FIXTURE_IMAGE_MODEL }, parameters: { size: BASE_SIZE } }],
    } },
  })
  let operationId
  const plannerDraft = walk.fixture.expectText({
    label: 'the draft result comes back with the host-generated operationId',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
      if (!result) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'hold' },
  })
  const plannerDone = walk.fixture.expectText({
    label: 'the drafting turn completes through the same SDK turn',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === GENERATE_CALL),
    reply: { type: 'text', text: 'S_REPRICE_DONE：草稿已就绪，等你确认。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'generation draft request')
  await recorded(plannerDraft.received, 'generation draft result')
  plannerDraft.release({ type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } })
  // 2026-09-22 裁决 A：`generate` **等**用户答完那张卡才返回——结果要到卡被答掉之后才有（见下）。

  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  // 时刻①：画布上那份草稿带的是 agent 定的参数。
  expect(await nodeSize(win, projectId), '改之前，画布节点的尺寸是 agent 定的那个').toBe(BASE_SIZE)

  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProof = await proveProbe(card, 'The paid confirmation card is on screen before anything is edited')
  await expect(card.locator(PRICE_TOTAL), '卡上不出金额').not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  await walk.snap('reprice-01-before-edit')

  // ② 在卡上把尺寸换成会加价的那一档。chip 就是画布节点那条参数条上的控件，
  // 只是这个宿主把它摆成逐参数 chip（正在确认花多少钱，多一次点击最贵）。
  const sizeChip = card.locator('[data-parameter-chip] button[aria-label="尺寸"]').first()
  const chipProof = await proveProbe(sizeChip, 'The size chip is a live control on the paid card')
  await expect(sizeChip, '改之前，卡上那颗尺寸 chip 显示的是 agent 定的那个').toContainText(BASE_SIZE)
  await clickOrFail(sizeChip, '卡上的尺寸 chip')
  await clickOrFail(win.getByRole('option', { name: UPGRADED_SIZE }).first(), `尺寸选项 ${UPGRADED_SIZE}`)

  // 时刻②之一：卡上的参数**当场**变了（改动已在卡上落下，不等一个来回）；卡上照旧不出金额。
  await expect(sizeChip, '改完参数，卡上那颗尺寸 chip 当场显示新值').toContainText(UPGRADED_SIZE, { timeout: DEFAULT_TIMEOUT_MS })
  await expect(card.locator(INTERVENTION_CONFIRM), '主按钮不出金额').not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  await walk.snap('reprice-02-card-follows-the-chip')

  // 时刻②之二：**画布节点一个字都没动**。卡上 chip 已经变了 = 改动确实落下了，
  // 所以此刻读到的「没动」不是「还没来得及」，而是本轮拍板的语义：
  // 用户还没答应花这笔钱，画布就不该被改。
  expect(await nodeSize(win, projectId), '按下生成之前，画布上那个草稿节点不许被改').toBe(BASE_SIZE)

  // ③ 按下主按钮。改动这才回写：主进程 `generation.revise` 落进候选 → 投影回画布。
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '确认并生成')
  await expect.poll(async () => nodeSize(win, projectId), { timeout: DEFAULT_TIMEOUT_MS }).toBe(UPGRADED_SIZE)
  await walk.snap('reprice-03-written-back-on-generate')

  // ── 这条走查到此为止，以及为什么（P3：假绿比红更糟）──
  //
  // 再往后那条「手势 → 收据 → 门 → start → 出站」**这个夹具跑不到**，而且原因是确定的：
  // `confirmPendingSpend` 回的是
  //   `Provider agent-runtime-loopback lacks required recovery capabilities: configured_provider`
  // （2026-09-11 真机探针实测）。`generationProviderBootstrap.ts` 只为 **`apimart` 这一个
  // vendorKey** 装配语义生成 provider，别的供应商一律 `providerReady:false`；本夹具的供应商叫
  // `agent-runtime-loopback`，所以它永远过不了那道门。**这是夹具的边界，不是本轮改动的回归**
  // （`docs/plan/2026-09-11-permission-p1-implementation.md` 已知缺口 ⑥，那里记着完整现场）。
  //
  // 同一次探针（2026-09-11，卡上还印金额时）还证实了：主进程投影里这一镜的价就是 `0.5`
  // （`candidateRevision:2`、`parameters.size:"1536x1024"`），与当时卡上印的 `CNY 0.50` 分毫不差——
  // 因为两边现在跑的是同一条算式。
  //
  // 顺带暴露的一条（缺口 ⑥ 已记）：渲染层这一侧是**静默**的——`useAgentPanelSpendConfirm` 的
  // `act` 把 `ProductionActionResult` 整个吞掉，成功失败一个样，用户看到的是「按了没反应」。
  expect(walk.fixture.images, '本轮走查零额度：到此为止一次供应商生成都不该发生').toHaveLength(0)
  // 确认在这个夹具里走不通（见上），卡还在原处等——所以等它的那个回合也还在等。看完就答：关掉它。
  await closeSpendCard(card)
  await recorded(plannerDone.received, 'generate returns once the card was closed')

  walk.report.verified = ['card-follows-the-chip-immediately', 'canvas-node-untouched-until-generate',
    'candidate-written-back-on-generate']
  walk.report.unproven = ['confirm-chain-reaches-the-provider（计划文档已知缺口 ⑥，本轮未修）']
  walk.report.probes = { card: cardProof, sizeChip: chipProof }
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
