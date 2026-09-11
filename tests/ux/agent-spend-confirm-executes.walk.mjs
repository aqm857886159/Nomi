#!/usr/bin/env node
// 真实用户任务（R13/R16）：**「帮我生成一张六棱柱」→ 我在卡上把尺寸改了 → 我按了那颗印着价的按钮。
// 然后呢？** —— `agent-spend-card.walk.mjs` 停在按钮之前（它只证卡长对了、丢弃干净）；
// 这一条把按下去那一刻走完。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 走查像真人一样点：打字、看卡、在卡上换尺寸、按主按钮——不灌 store、不直调桥、不伪造待决状态。
//
// ⚠️ **这条走查证不到「产物落回节点」那一步，这是有意的、原因写在这里**（P3：假绿比红更糟）：
// 这台夹具的供应商身份是 `agent-runtime-loopback`，而 `generationProviderBootstrap.ts` 只把
// **apimart** 装成可提交的生成供应商——别的供应商一律 `providerReady:false`。所以在这台夹具上
// 按下确认，宿主会诚实地拒绝（「供应商缺少必需能力」），一分钱不花。
// 「确认 → 封印 → 铸收据 → 决门 → 真的跑起来 → 产物落回同一个节点」那一整条，由零额度的
// `electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts` 在真 loopback HTTP 供应商上逐条断言。
// 缺口与修法记在 docs/plan/2026-09-10-permission-model-rework.md 的「P1.1a 已知缺口」。
//
// 四条（全部是真人视角看得见的事）：
//   ① 卡在介入槽里等着，价格是宿主按目录算的 0.30
//   ② 在卡上把尺寸换成 1536x1024（目录里唯一有加价的规格）
//   ③ 按主按钮 → 改动真的到了宿主：卡上的价格原地变成 0.50（渲染层读不到价目，编不出这个数）
//   ④ 宿主拒绝时**用户看得见为什么**——不是按了没反应；且一分钱没花、草稿和节点都还在
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const ASK = 'S_SPEND_EXEC：帮我生成一张六棱柱的图。'
const PLAN_CALL = 's-spend-exec-1'
const PRICE_TOTAL = '[data-v4-price="total"]'
const EDITED_SIZE = '1536x1024'

const walk = await createRuntimeWalk('spend-confirm-executes')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  // ① agent 只建草稿——付费能力不在模型工具面里（paidBoundary），钱那一下只能由人按。
  const planner = walk.fixture.expectText({
    label: 'the agent drafts a generation instead of spending on its own',
    match: (body) => flattenRequestText(body).includes('S_SPEND_EXEC'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'nomi_generation_plan', args: {
      operation: 'create',
      taskKind: 'text_to_image',
      prompt: '一个悬浮的六棱柱，柔和的演播室灯光',
      moduleId: 'generation.single-shot',
      providerId: FIXTURE_VENDOR,
      modelId: FIXTURE_IMAGE_MODEL,
      parameters: { size: '1024x1024' },
    } },
  })
  const plannerDone = walk.fixture.expectText({
    label: 'the drafting turn completes through the same SDK turn',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL),
    reply: { type: 'text', text: 'S_SPEND_EXEC_DONE：草稿已就绪，等你确认。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'generation draft request')
  await recorded(plannerDone.received, 'generation draft result')

  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const draftedNodeId = (await readProject(win, projectId)).payload.generationCanvas.nodes[0].id

  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await proveProbe(card, 'The paid confirmation lives in the agent panel intervention slot')
  await expect(card.locator(PRICE_TOTAL), '价格由宿主按目录算（基价 0.30）').toContainText('0.30')
  expect(walk.fixture.images, '卡还没按之前，一次供应商生成都没发生').toHaveLength(0)

  // ② 在卡上把尺寸换掉。这是真的点开下拉再选一项——不是往 store 里写一个值。
  const sizeChip = card.locator('[data-parameter-chip="size"]')
  await expect(sizeChip, '付费卡底栏上的尺寸 chip').toBeVisible()
  await clickOrFail(sizeChip.locator('button').first(), '卡上的尺寸 chip')
  await clickOrFail(win.locator('[data-nomi-select-dropdown] [role="option"]').filter({ hasText: EDITED_SIZE }).first(),
    `尺寸选项「${EDITED_SIZE}」`)
  await expect(sizeChip, 'chip 上印的值就是选完的那个')
    .toHaveAttribute('data-parameter-chip-value', EDITED_SIZE)
  await walk.snap('spend-card-size-edited')

  // ③ 按那颗印着价的按钮。改动是在**按下那一刻**才写进 durable 候选的（持续双向同步会和落地链
  //    拉锯，见 useAgentPanelSpendConfirm 里的理由），所以「价格从 0.30 变成 0.50」正是
  //    「这一下真的把改动送到了主进程、主进程按目录重算过」的用户可见证据。
  //    0.50 = 基价 0.30 + `size:1536x1024` 的规格加价 0.20。
  // 按之前先在真实 DOM 上架一个观察者：错误提示只活 6 秒（toast.ts 的 error TTL），
  // 而下面还要等价格重算——直接去 locator 上断言会跟它的自动消失赛跑，赢不了就是 flake。
  // 观察的是真通知节点，不是往 store 里塞东西。
  // 注意：页面里有**好几个** `mantine-Notifications-root`（不同挂载点各一个），真正收到通知的不是
  // `.first()` 那个——所以这里认的是通知本体的类名，并且盯 body 整棵树，不去猜是哪个容器。
  await win.evaluate(() => {
    window.__nomiToastLog = []
    const record = () => {
      for (const node of document.querySelectorAll('[class*="mantine-Notification-root"]')) {
        const text = (node.textContent ?? '').trim()
        if (text && !window.__nomiToastLog.includes(text)) window.__nomiToastLog.push(text)
      }
    }
    record()
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true })
  })

  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '卡上的主按钮「生成 ¥…」', { noWaitAfter: true })

  // ④ 这台夹具上宿主会拒（供应商不是 apimart，见文件头）。要证的是**拒得让人看得见**：
  //    此前这里是 `.catch(() => undefined)`，用户按下去之后界面一动不动、一个字都没有。
  await expect.poll(async () => (await win.evaluate(() => window.__nomiToastLog ?? [])).length,
    { message: '宿主拒绝必须当场说出来，不能按了没反应', timeout: DEFAULT_TIMEOUT_MS }).toBeGreaterThan(0)
  const spoken = (await win.evaluate(() => window.__nomiToastLog ?? [])).join(' ')
  expect(spoken, '说的是人话：没成 · 没开始生成 · 没花钱').toContain('没有开始生成')
  // 宿主那句原话（`Provider X lacks required recovery capabilities: configured_provider`）
  // 只该进控制台：内部术语和英文倒给中文用户，等于把状态机糊在他脸上（R15 / R2）。
  expect(spoken, '不许把宿主的内部错误串直接印给用户').not.toContain('configured_provider')

  await expect(card.locator(PRICE_TOTAL), '改动到了宿主：价格按新规格原地重算成 0.50')
    .toContainText('0.50', { timeout: DEFAULT_TIMEOUT_MS })

  // 钱没花、草稿还在、节点还是原来那个——被拒得干净，用户可以改了再按。
  expect(walk.fixture.images, '被拒之后依然一次供应商生成都没发生（零额度）').toHaveLength(0)
  await expect(card, '被拒之后卡还在等人答（问题没答完就不该消失）').toBeVisible()
  const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
  expect(nodes, '全程只有一个节点（落地幂等：建草稿 / 改参数共用同一个章）').toHaveLength(1)
  expect(nodes[0].id, '还是草稿那一刻建的那个节点').toBe(draftedNodeId)
  await walk.snap('spend-confirm-refusal-is-visible')

  walk.report.verified = ['card-waits-in-intervention-slot', 'param-edited-on-the-card',
    'confirm-pushes-the-edit-to-the-host-and-reprices', 'host-refusal-is-visible-and-costs-nothing']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
