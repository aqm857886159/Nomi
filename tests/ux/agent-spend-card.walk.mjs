#!/usr/bin/env node
// 真实用户任务（R13/R16）：**「帮我生成一张六棱柱」之后，钱这一步长什么样。**
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 走查像真人一样点：在面板里打字、看卡、在卡上改参数、按那颗印着价的按钮——
// 不灌 store、不直调桥、不伪造待决状态。
//
// 四条：
//   ① agent 建草稿 → 草稿落画布 + 面板出付费卡（模型/价格与节点一致）
//   ② 卡上改参数 → 价格原地刷新（宿主重算，不是渲染层现算）
//   ③ 等待中切到「全自动」→ 卡仍然在等人答（钱不因档位放行）
//   ④ × → 草稿取消、画布节点消失
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER_PERMISSION, INTERVENTION_CONFIRM, INTERVENTION_REJECT,
  PERMISSION_POPOVER, createRuntimeWalk, openCanvas, permissionTier, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const ASK = 'S_SPEND_ASK：帮我生成一张六棱柱的图。'
const PLAN_CALL = 's-spend-plan-1'
const PRICE_TOTAL = '[data-v4-price="total"]'

const walk = await createRuntimeWalk('spend-card')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  // ① agent 建草稿。付费能力按设计不在模型工具面里（paidBoundary），所以它能做的只有建草稿——
  // 「这笔钱花不花」必须由面板上那张卡来问，这正是本走查要证明的东西。
  const planner = walk.fixture.expectText({
    label: 'the agent drafts a generation instead of spending on its own',
    match: (body) => flattenRequestText(body).includes('S_SPEND_ASK'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'nomi_generation_plan', args: {
      operation: 'create',
      taskKind: 'text_to_image',
      prompt: '一个悬浮的六棱柱，柔和的演播室灯光',
      // 模型身份三件套写全：真实用户没在设置里存过「图片默认模型」时，宿主拒绝替他从目录
      // 顺序里挑一个花钱的模型（semanticGenerationCandidate.ts:199-207），这是对的。
      // 走查因此像真实 agent 那样先从 context 拿到身份再写进 create。
      moduleId: 'generation.single-shot',
      providerId: FIXTURE_VENDOR,
      modelId: FIXTURE_IMAGE_MODEL,
      parameters: { size: '1024x1024' },
    } },
  })
  const plannerDone = walk.fixture.expectText({
    label: 'the drafting turn completes through the same SDK turn',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL),
    reply: { type: 'text', text: 'S_SPEND_DONE：草稿已就绪，等你确认。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'generation draft request')
  await recorded(plannerDone.received, 'generation draft result')

  // 草稿落画布（一本账）：节点先出现，用户看得见 agent 到底要生成什么。
  await expect.poll(async () => {
    return (await readProject(win, projectId)).payload.generationCanvas.nodes.length
  }, { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const node = (await readProject(win, projectId)).payload.generationCanvas.nodes[0]
  expect(node.meta.modelKey, '落地的节点必须带 agent 定的模型身份').toBe(FIXTURE_IMAGE_MODEL)

  // 面板出卡。它是**介入槽**里的一张卡，不是居中弹窗——单轨化的可见证据。
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProof = await proveProbe(card, 'The paid confirmation lives in the agent panel intervention slot')
  await expect(win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }),
    'agent 代发的付费确认不许再弹居中卡').toHaveCount(0)
  // 价格是宿主按目录 pricing 算出来的数字，不是标签。
  await expect(card.locator(PRICE_TOTAL)).toContainText('0.30')
  // 卡体就是画布节点那张生成框整件：提示词在卡上，不是留在画布上（v1 被打回的那个窟窿）。
  await expect(card).toContainText('六棱柱')
  await walk.snap('spend-card-in-intervention-slot')

  // ② 卡上的参数条就是画布节点那一条：点开、改一个值，改的是那份**还没落到画布上**的草稿本身。
  //
  // ⚠️ 「改完价格当场刷新」这一段**本轮没有断言**：改动要到按下确认那一刻才写进 durable 候选
  // （持续双向同步会和落地链拉锯，见 useAgentPanelSpendConfirm 里的理由），所以此刻价格还是旧的。
  // 与其断言一个我们已经知道不成立的行为，不如在这里只证「参数条是真能点的那一条」，
  // 把缺口写在 docs/plan/2026-09-11 的「已知缺口」里（P3：假绿比红更糟）。
  // 付费卡这一处的参数条是**逐参数 chip**（`parameterLayout='chips'`，2026-09-11 用户拍板：
  // 只改付费卡、画布节点那条不动）。所以这里断言的不是「点开摘要 pill 能看到参数」，
  // 而是「看得见的那个值本身就是可点的控件」——正在确认花多少钱的那一刻，多一次点击最贵。
  await expect(card.locator('[data-parameter-summary]'),
    '付费卡不摆摘要 pill：它是 chips 形态，不是画布节点那套').toHaveCount(0)
  const chips = card.locator('[data-parameter-chip]')
  await expect(chips.first(), '付费卡底栏至少有一颗逐参数 chip（档案 derive 断了就会一颗都没有）').toBeVisible()
  // 尺寸在这个夹具模型上是 `size`（角色 aspect）→ 它必须**直接**在底栏上，不藏在 ⚙ 后面。
  const sizeSelect = card.locator('[data-parameter-chip] button[aria-label="尺寸"]').first()
  await expect(sizeSelect, '卡体就是画布节点那条参数条的 chips 摆法：尺寸一步可点，不用先点开面板').toBeVisible()
  await clickOrFail(sizeSelect, '卡上的尺寸 chip')
  await walk.snap('spend-card-parameters-are-editable')
  await win.keyboard.press('Escape')

  // ③ 等待中切到「全自动」。钱这条轴与档位正交：卡必须还在等人答。
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_PERMISSION}`), '权限档选择器')
  await expect(win.locator(`${CANVAS_PANEL} ${PERMISSION_POPOVER}`)).toBeVisible()
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${permissionTier('project')}`), '切到「全自动」')
  // 切「全自动」自己也要过一张确认卡（换档可撤销，所以它是介入槽的可撤销档）。
  const switchCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard).toBeVisible()
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到全自动')
  await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="auto-mode"]`), '全自动档要有常驻提醒').toBeVisible()
  await expect(card, '付费卡在切档之后仍然等着人答——钱不因档位放行').toBeVisible()
  await expect(card.locator(PRICE_TOTAL), '让位回来之后价格一个字都没变——它没有倒计时，等多久都行').toContainText('0.30')
  await walk.snap('spend-card-still-waiting-under-full-auto')

  // ④ × = 丢弃这份草稿：Run 取消，画布上那个占位节点跟着消失。
  await clickOrFail(card.locator(INTERVENTION_REJECT), '丢弃这份草稿')
  await expectAbsent(card, { provenBy: cardProof, message: '丢弃之后付费卡不再可操作' })
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(0)
  expect(walk.fixture.images, '整场走查一次供应商生成都没发生（零额度）').toHaveLength(0)
  await walk.snap('spend-card-discarded-canvas-clean')

  walk.report.verified = ['draft-lands-on-canvas-and-card-appears', 'card-body-is-the-real-node-composer',
    'card-still-waits-under-full-auto', 'discard-removes-draft-and-node']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
