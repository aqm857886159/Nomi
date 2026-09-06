#!/usr/bin/env node
// 真实用户任务走查（R16）：**让 Agent 从零做一条 20 秒短片**。
//
// 不是功能探索，是一个人带着一个目标走完全程：写脚本 → 改文稿 → 去画布生成 → 中途改主意
// 停下来 → 关掉重开发现东西还在。v4 接线之后每一步都由宿主数据驱动，所以这条走查同时
// 是接线的行为证据：设计实验室的基线证明「同样的 view model 长同样的样子」，
// 单测证明「同样的宿主真相产出同样的 view model」，这里证明「人按下去真的发生了事情」。
//
// 零额度：供应商是 loopback（`agent-runtime-fixture.mjs`），每一次模型调用都要预先声明，
// 没声明的请求会被 400 并在收尾时报出来。不碰任何真实生成 API。
//
// 用法：node tests/ux/agent-v4-short-film.walk.mjs
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD,
  ASSISTANT_MESSAGE,
  CANVAS_PANEL,
  COLLAPSED_SHELL,
  COMPOSER,
  COMPOSER_INPUT,
  COMPOSER_PERMISSION,
  COMPOSER_SEND,
  CONTEXT_RING,
  CREATION_PANEL,
  COLLAPSE_BUTTON,
  DOCUMENT,
  PERMISSION_POPOVER,
  TOOL_RECEIPT,
  USER_BUBBLE,
  V4_FLOW,
  approvePendingIntervention,
  chooseAssistantModel,
  createRuntimeWalk,
  expandResidentPanel,
  hasToolResult,
  openCanvas,
  permissionTier,
  recorded,
  rejectPendingIntervention,
  requireCurrentPersistedWorkbenchDocument,
  readProject,
  sendCanvas,
  sendCreation,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

const BRIEF = '我要做一条 20 秒的短片：咖啡馆推门那段。先把脚本写出来。'
const SCRIPT = '清晨，她推开咖啡馆的门。红色杯子落在白色桌面上，侧光打在杯沿。她坐下，按下录制键。'
const TIGHTEN = '把结尾收紧一点，别拖。'
const TIGHTEN_APPLIED = 'ENDING_TIGHTENED：她按下录制键，画面定格。'
const TIGHTEN_TOOL = 'v4-doc-tighten-1'
const REFUSED = '再把开头也删掉。'
const REFUSED_TOOL = 'v4-doc-delete-1'
const REFUSED_TEXT = 'HEAD_DELETED：不该出现在文稿里'
const REFERENCE = '给这 4 镜生成参考图。'
const REFERENCE_TOOL = 'v4-canvas-plan-1'
const SLOW = '再想想整体节奏。'

const walk = await createRuntimeWalk('v4-short-film')
let failure
try {
  let { win } = await walk.start({ first: true })
  const project = await walk.newProject()
  const { projectId } = project
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)

  // ── 1. 冷启动：面板是空的，但不该是**沉默**的 ──────────────────────────────
  const panel = win.locator(CREATION_PANEL)
  await expect(panel.locator(COMPOSER)).toBeVisible()
  // 上下文环在还没有任何回合时**不知道**用了多少——它必须写「—」而不是「0%」。
  // 「0%」是一个断言（「你几乎没用上下文」），而我们那一刻连模型多大都不知道。
  await expect(panel.locator(CONTEXT_RING)).toContainText('—')
  await expect(panel.locator(`${CONTEXT_RING}[data-context-known="true"]`)).toHaveCount(0)
  // 空框的发送钮是真 disabled，不是「灰着但能按」。
  await expect(panel.locator(COMPOSER_SEND)).toBeDisabled()
  await walk.snap('01-cold-start')

  // ── 2. 写脚本：一条普通对话 ───────────────────────────────────────────────
  const briefTurn = walk.fixture.expectText({
    label: 'agent writes the 20s script',
    match: (body) => flattenRequestText(body).includes(BRIEF),
    reply: { type: 'text', text: SCRIPT },
  })
  await sendCreation(win, BRIEF)
  await recorded(briefTurn.received, 'script request')
  // 出站请求已经到了 loopback——那就是这一轮「起飞」的证据，比等 composer 那一帧可靠：
  // loopback 回得比断言轮询还快，运行态可能整帧都没被采到。落地由**产出**证明。
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).first() })
  await expect(panel.locator(USER_BUBBLE).first()).toContainText('20 秒')
  await expect(panel.locator(ASSISTANT_MESSAGE).first()).toContainText('推开咖啡馆的门')
  // 回合结算后环上必须是**量出来的**数。夹具目录没写 contextWindow，所以仍然是「—」——
  // 这正是「缺字段就不渲染」那条纪律的真机断言：有 token 数不等于知道分母。
  await expect(panel.locator(CONTEXT_RING)).toContainText('—')
  await walk.snap('02-script-written')

  const doc = win.locator(DOCUMENT)
  await doc.fill(SCRIPT)
  await expect(doc).toHaveText(SCRIPT)

  // ── 3. 权限三档：切到「每步问」，验证它没有比它该有的更宽 ────────────────
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), 'composer 权限档')
  const permissionPopover = panel.locator(PERMISSION_POPOVER)
  await expect(permissionPopover).toBeVisible()
  await expect(permissionPopover.locator('[data-tier]')).toHaveCount(3)
  await expect(permissionPopover.locator('[data-tier][data-active="true"]')).toHaveAttribute('data-tier', 'safe-auto')
  await walk.snap('03-permission-popover')
  await clickOrFail(panel.locator(permissionTier('step')), '权限档「每步问」')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'step')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-spend-policy', 'confirm')

  // ── 4. 「每步问」下改文稿：介入槽出现 → 确认 → 收据 ──────────────────────
  const tightenRequest = walk.fixture.expectText({
    label: 'agent proposes tightening the ending',
    match: (body) => flattenRequestText(body).includes(TIGHTEN) && !hasToolResult(body, TIGHTEN_TOOL),
    reply: { type: 'tool', id: TIGHTEN_TOOL, name: 'nomi_document_edit', args: { operation: 'append', content: TIGHTEN_APPLIED } },
  })
  const tightenFollowup = walk.fixture.expectText({
    label: 'tighten result returns to the model',
    match: (body) => hasToolResult(body, TIGHTEN_TOOL),
    reply: { type: 'text', text: '已按你的确认收紧结尾。' },
  })
  await sendCreation(win, TIGHTEN)
  await recorded(tightenRequest.received, 'document edit proposal')
  const slot = panel.locator(APPROVAL_CARD)
  await expect(slot).toBeVisible()
  // 可撤销的改动才有「不再问 →」，而且它只覆盖这一个能力——范围那一行必须说清楚。
  await expect(slot).toHaveAttribute('data-kind', 'approval-reversible')
  await expect(slot).toContainText('只对这一个操作生效')
  await walk.snap('04-intervention-approval')
  await approvePendingIntervention(win, CREATION_PANEL)
  await recorded(tightenFollowup.received, 'approved document tool result')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(TOOL_RECEIPT).last() })
  await expect(doc).toContainText(TIGHTEN_APPLIED)
  await expect(panel.locator(TOOL_RECEIPT).last()).toBeVisible()
  await expect.poll(async () => JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    { message: '确认过的改动必须真的落进项目，不只是气泡上说做了', timeout: 30_000 }).toContain(TIGHTEN_APPLIED)
  await walk.snap('05-approved-and-applied')

  // ── 5. 改主意：拒绝一次，并且带上原因 ────────────────────────────────────
  const refusedRequest = walk.fixture.expectText({
    label: 'agent proposes deleting the opening',
    match: (body) => flattenRequestText(body).includes(REFUSED) && !hasToolResult(body, REFUSED_TOOL),
    reply: { type: 'tool', id: REFUSED_TOOL, name: 'nomi_document_edit', args: { operation: 'append', content: REFUSED_TEXT } },
  })
  const refusedFollowup = walk.fixture.expectText({
    label: 'rejection returns to the model',
    match: (body) => hasToolResult(body, REFUSED_TOOL),
    reply: { type: 'text', text: '好，开头保留。' },
  })
  await sendCreation(win, REFUSED)
  await recorded(refusedRequest.received, 'delete proposal')
  const rejectProof = await proveProbe(panel.locator(APPROVAL_CARD), '拒绝前介入槽确实浮出来了')
  await walk.snap('06-intervention-before-reject')
  await rejectPendingIntervention(win, CREATION_PANEL, '开头是全片的锚，先留着')
  await recorded(refusedFollowup.received, 'rejected tool result')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).last() })
  await expectAbsent(panel.locator(APPROVAL_CARD), { provenBy: rejectProof, message: '拒绝之后介入槽必须收掉' })
  await expect(doc).not.toContainText(REFUSED_TEXT)
  // 用户点的「不要」必须记成**拒绝**，不是失败：行尾写「已拒绝」而不是「失败」。
  // 少一个 `denied: true` 就会把用户的决定记成系统故障——历史里读起来完全是两件事。
  await expect(panel.locator(`${TOOL_RECEIPT}[data-status="output-denied"]`).last()).toBeVisible()
  await walk.snap('07-rejected')

  // 切回「自动改」：档位是**面板上唯一的授权控件**，切回来必须真的切回来。
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), 'composer 权限档')
  await clickOrFail(panel.locator(permissionTier('safe-auto')), '权限档「自动改」')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'safe-auto')

  // ── 6. 去画布：同一条对话跨面继续 ───────────────────────────────────────
  await openCanvas(win)
  const canvas = win.locator(CANVAS_PANEL)
  const referenceRequest = walk.fixture.expectText({
    label: 'agent drafts the reference shots',
    match: (body) => flattenRequestText(body).includes(REFERENCE) && !hasToolResult(body, REFERENCE_TOOL),
    reply: { type: 'tool', id: REFERENCE_TOOL, name: 'nomi_canvas_read', args: {} },
  })
  const referenceFollowup = walk.fixture.expectText({
    label: 'canvas read result returns to the model',
    match: (body) => hasToolResult(body, REFERENCE_TOOL),
    reply: { type: 'text', text: '画布上还没有镜头，我先按脚本排 4 镜。' },
  })
  await sendCanvas(win, REFERENCE)
  await recorded(referenceRequest.received, 'canvas request')
  await recorded(referenceFollowup.received, 'canvas tool result')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: canvas.locator(TOOL_RECEIPT).last() })
  await expect(canvas.locator(TOOL_RECEIPT).last()).toBeVisible()
  await walk.snap('08-canvas-surface')

  // ── 7. 停止三态：空闲 → 运行中 → 停下 ───────────────────────────────────
  const slowTurn = walk.fixture.expectText({
    label: 'a turn the user changes their mind about',
    match: (body) => flattenRequestText(body).includes(SLOW),
    reply: { type: 'hold' },
  })
  await sendCanvas(win, SLOW)
  await recorded(slowTurn.received, 'slow turn request')
  const running = canvas.locator(`${COMPOSER}[data-mode="running"]`)
  await expect(running).toBeVisible()
  // 运行中占位文案换成「可继续输入，将排队发送」——它是这一刻唯一在说话的东西。
  await expect(canvas.locator(COMPOSER_INPUT)).toHaveAttribute('placeholder', /排队/)
  await walk.snap('09-running')
  await clickOrFail(canvas.locator(`${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}`), 'composer 停止')
  slowTurn.release({ type: 'text', text: '好，先停在这里。' })
  await expect(running, '停止之后 composer 必须退出运行态').toBeHidden({ timeout: 60_000 })
  await walk.snap('10-stopped')

  // ── 8. 收起：藏起对话流，不是藏起对话 ───────────────────────────────────
  await clickOrFail(canvas.locator(COLLAPSE_BUTTON), '收起面板')
  const collapsed = win.locator(COLLAPSED_SHELL)
  await expect(collapsed).toBeVisible()
  // 收起后 composer 仍在画面下沿：这是「结果全屏」的承诺——把屏幕还给内容，但对话不中断。
  await expect(collapsed.locator(COMPOSER)).toBeVisible()
  await walk.snap('11-collapsed')
  await expandResidentPanel(win)
  await expect(win.locator(`${CANVAS_PANEL} ${V4_FLOW}`)).toBeVisible()

  // ── 9. 关掉重开：昨天的活儿还在 ────────────────────────────────────────
  //
  // 这一段测的是**收据的七态 join 在冷启动之后仍然对**：重启后渲染层的待决登记表是空的，
  // 只剩宿主快照，所以每一条收据的状态必须完全由宿主说了算。判定顺序写反的话，
  // 这里会看到一条早就完成的调用被画成「待确认」。
  const requestsBeforeRestart = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: project.name }), '冷重启后打开同一项目')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作工作区')
  await expandResidentPanel(win)
  const restored = win.locator(CREATION_PANEL)
  await expect(restored.locator(USER_BUBBLE).first(), '冷重启后对话流必须还在').toContainText('20 秒', { timeout: 60_000 })
  const restoredProof = await proveProbe(restored.locator(TOOL_RECEIPT), '冷重启后收据仍在流里')
  await expectAbsent(restored.locator(APPROVAL_CARD), {
    provenBy: restoredProof,
    message: '冷重启后不该有介入槽——待决登记表是空的，一条早就完成的调用被画成「待确认」就是七态 join 写反了',
  })
  // 重启本身不该产生任何模型调用：恢复读的是落盘的宿主状态，不是重跑一遍。
  expect(walk.fixture.requests).toHaveLength(requestsBeforeRestart)
  await walk.snap('12-cold-restart')

} catch (error) {
  failure = error
}
await walk.finish(failure)
