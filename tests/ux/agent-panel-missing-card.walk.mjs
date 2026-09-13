#!/usr/bin/env node
// 真实用户任务（R13/R16）：**「模型说『请在确认卡中批准』，我在哪儿批？」**
//
// 2026-09-11 的真实会话：用户让 Agent 把一段素材劈成两半，模型回了一句「已生成剪辑预览，
// 请在确认卡中批准后写入时间线」，dock 上也写着「等你确认 1 条」——而介入槽里一张卡都没有。
// 他先以为在加载，再以为 Nomi 坏了。根因是 announce 与 render 之间那几段链路把三件事
// 塌缩成了同一个返回值（空）：真的没有 / 我读不到 / 我知道有但画不出来。
//
// 这条走查守的不变量：**只要有一条在等用户，介入槽就必须画出点什么。** 它像真人一样点：
// 打字、看槽、答卡——不灌 store、不直调桥、不伪造待决状态。
//
// ⚠️ **这条走查证不到那张「本该有一张确认卡」的错误卡，这是有意的、原因写在这里**（P3）：
// 它的三种成因（读通道抛 / 能力核没装起来 / 认不出这是哪一种确认）没有一种是真人从界面上
// 够得着的——要触发就得在主进程里人为弄坏一个东西，而那已经不是「像真人一样点」了。
// 那三条各自由单测钉着（`src/workbench/ai/v4/missingInterventionCard.test.ts`、
// `electron/capabilityCore/appIntegrationSpendConfirmInstall.test.ts`、
// `electron/productionRun/productionActionIpcPendingSpend.test.ts`）。
// 这里证的是同一条不变量的**正面**：真机上每一条 announce 都有卡，而且开发档里那条硬断言
// （announce 了却什么都没画 → 当场抛）**是活的**——它一旦触发，面板会整块变成错误态，
// 而下面每一步都在断言面板没有变成错误态。
//
// 五条（全部是真人视角看得见的事）：
//   ① 付费待决 announce 了 → 槽里真的有一张卡，卡上是**这一笔**的内容，不是空壳
//   ② 面板没有整块变错误态（那条硬断言没被触发 = 这条链上没有「announce 了却没画」）
//   ③ 换一种 announce 面（切档那张可撤销卡）→ 同样画得出来
//   ④ 答掉之后槽清空——「没有」两边也要一致，否则会留下一个答不掉的幽灵计数
//   ⑤ 整场零额度
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER_PERMISSION, INTERVENTION_CONFIRM, INTERVENTION_REJECT,
  PANEL_ERROR, PERMISSION_POPOVER, createRuntimeWalk, openCanvas, permissionTier, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const ASK = 'S_CARD_ASK：帮我生成一张六棱柱的图。'
const PLAN_CALL = 's-card-plan-1'

const walk = await createRuntimeWalk('panel-missing-card')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  const panelError = win.locator(`${CANVAS_PANEL} ${PANEL_ERROR}`)
  // 开发档里 `assertAnnouncedCardRendered` 一旦抛，这一格就会亮。整趟走查反复读它：
  // 它保持 0 才说明「announce 了却什么都没画」这条链一次都没有发生。
  await expect(panelError, '起手面板就不该是错误态').toHaveCount(0)

  const planner = walk.fixture.expectText({
    label: 'the agent drafts a generation that needs the user to decide',
    match: (body) => flattenRequestText(body).includes('S_CARD_ASK'),
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
    // 模型那句话正是 2026-09-11 那次的形状：它**声称**有一张卡在等。
    reply: { type: 'text', text: 'S_CARD_DONE：已经准备好了，请在确认卡中批准。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'draft request')
  await recorded(plannerDone.received, 'draft result')

  // ① announce 了，槽里就必须有卡。
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProof = await proveProbe(card, 'An announced confirmation always renders a card in the intervention slot')
  // 而且是**这一笔**的卡，不是一张空壳：用户要靠卡上的内容判断该不该点头。
  await expect(card, '卡上必须是这一笔的内容——空壳等于换一种形式的沉默').toContainText('六棱柱')
  // 草稿也确实落到了画布上：announce 的那件事是真的存在的。
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  await walk.snap('missing-card-01-announced-and-rendered')

  // ② 面板没有整块变错误态 —— 那条硬断言没被触发。
  await expect(panelError, '有一条在等用户时，面板必须仍然是可用的面板').toHaveCount(0)

  // ③ 换一种 announce 面：切档那张可撤销卡走的是 lane 那条链（不是付费投影那条）。
  // 两条链各自都可能长出「announce 了却没画」，所以两条都要看一眼。
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_PERMISSION}`), '权限档选择器')
  await expect(win.locator(`${CANVAS_PANEL} ${PERMISSION_POPOVER}`)).toBeVisible()
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${permissionTier('project')}`), '切到「全自动」')
  const switchCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard, 'lane 那条链上的待决同样必须画得出来').toBeVisible()
  await walk.snap('missing-card-02-second-announce-surface')
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到全自动')
  await expect(panelError, '答完一张卡之后面板仍然不该是错误态').toHaveCount(0)

  // ④ 答掉之后两边一起归零。「没有」如果只有一边知道，用户就会盯着一个答不掉的计数。
  await expect(card, '已经在等的那张付费卡不因切档而消失（2026-09-11 用户拍板）').toBeVisible()
  await clickOrFail(card.locator(INTERVENTION_REJECT), '丢弃这份草稿')
  await expectAbsent(card, { provenBy: cardProof, message: '丢弃之后槽里不再留着这张卡' })
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(0)
  await expect(panelError, '清空之后面板依然是可用的面板').toHaveCount(0)
  await walk.snap('missing-card-03-cleared-on-both-sides')

  // ⑤ 整场零额度。
  expect(walk.fixture.images, '整场走查一次供应商生成都没发生（零额度）').toHaveLength(0)

  walk.report.verified = ['announced-confirmation-always-renders', 'panel-never-blanks-into-error',
    'second-announce-surface-renders', 'cleared-on-both-sides']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
