#!/usr/bin/env node
// 真实用户任务（R13/R16）：**「我把档位切到全自动，之后让 Agent 生成，还会不会逐笔问我价钱？」**
//
// 2026-09-12 用户拍板：三档里只有「全自动」代答付费门——那一档下付费生成直接跑，不出报价卡；
// 「每步问」「自动改」一个字不变。这一条走查证的就是这句话在真机上成不成立。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 走查像真人一样点：在面板里打字、在权限胶囊里选档、看槽里有没有卡——
// 不灌 store、不直调桥、不伪造待决状态。
//
// ⚠️ **这条走查证不到「决成了所以没有卡」那一半，这是有意的、原因写在这里**（P3：假绿比红更糟）：
// 这台夹具的供应商身份是 `agent-runtime-loopback`，而 `generationProviderBootstrap.ts` 只把
// **apimart** 装成可提交的生成供应商。所以「全自动」在这里去决门时，封印那一步会被宿主
// 诚实地拒绝（供应商缺少必需能力），一分钱不花，草稿也就仍然是草稿。
// 「免卡放行 → 封印 → 铸收据（`decidedBy: policy:full_auto`）→ 决门 → 真的跑起来 → 没有卡」
// 那一整条，由零额度的 `electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts` 在真
// loopback HTTP 供应商上逐条断言。同样的取舍与理由见 `agent-spend-confirm-executes.walk.mjs`。
//
// 那这条走查还剩什么可证的？——**档位到底有没有改变宿主的行为**。它有一个真人看得见的判据：
//
//   · 「自动改」档下问一次：宿主**根本不去碰那道门**，所以面板上不会出现任何失败；
//   · 「全自动」档下问一次：宿主当场就去决门了，于是这台夹具上必然出现一条**看得见的失败**。
//
// 两次问的是同一件事、走的是同一条夹具，唯一的变量是档位。这条差异一旦消失
// （比如那段策略分支又挂到一个真实模型走不到的入口上，2026-09-12 就发生过一次），这条走查立刻红。
//
// 五条（全部是真人视角看得见的事）：
//   ① 阳性对照——默认档「自动改」下问一次：报价卡出现，且**没有**任何失败条
//   ② 切到「全自动」：它自己那张确认卡要说清「付费生成会直接跑」，不能还写着「付费仍然每次问」
//   ③ 再问一次：宿主真的去决了那道门——面板上出现一条看得见的失败（不是沉默）
//   ④ 决不成就不假装成功：那张报价卡仍然在原处等人答（「没决成，所以它仍然待决」）
//   ⑤ 整场零额度
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER_PERMISSION, INTERVENTION_CONFIRM,
  PERMISSION_POPOVER, createRuntimeWalk, openCanvas, permissionTier, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const ASK_SAFE = 'S_AUTO_ASK_1：帮我生成一张六棱柱的图。'
const ASK_FULL = 'S_AUTO_ASK_2：再来一张，换个角度。'
const PRICE_TOTAL = '[data-v4-price="total"]'

/** 一次「模型建草稿」的脚本回合。付费能力不在模型工具面里（paidBoundary），它能做的只有这个。 */
function draftTurn(walk, { marker, callId, prompt, done }) {
  const planner = walk.fixture.expectText({
    label: `the agent drafts a generation for ${marker}`,
    match: (body) => flattenRequestText(body).includes(marker),
    reply: { type: 'tool', id: callId, name: 'nomi_generation_plan', args: {
      operation: 'create',
      taskKind: 'text_to_image',
      prompt,
      moduleId: 'generation.single-shot',
      providerId: FIXTURE_VENDOR,
      modelId: FIXTURE_IMAGE_MODEL,
      parameters: { size: '1024x1024' },
    } },
  })
  const finished = walk.fixture.expectText({
    label: `the drafting turn for ${marker} completes through the same SDK turn`,
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === callId),
    reply: { type: 'text', text: done },
  })
  return { planner, finished }
}

const walk = await createRuntimeWalk('spend-full-auto')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  // ① 阳性对照：默认档（「自动改」）下问一次，报价卡必须出现。
  //
  // 没有这一步，③ 的「没有卡」就毫无意义——一个根本长不出卡的现场里断言「没有卡」恒真。
  const first = draftTurn(walk, { marker: 'S_AUTO_ASK_1', callId: 'auto-draft-1', prompt: '一个悬浮的六棱柱，柔和的演播室灯光', done: 'S_AUTO_DONE_1：草稿已就绪，等你确认。' })
  await sendCanvas(win, ASK_SAFE)
  await recorded(first.planner.received, 'safe-auto draft request')
  await recorded(first.finished.received, 'safe-auto draft result')

  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await expect(card, '「自动改」档下每一笔付费生成照旧逐次问——这一档一个字都没变').toBeVisible()
  // 草稿也确实落到了画布上：卡上问的那件事是真的存在的。
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  await expect(card.locator(PRICE_TOTAL), '「自动改」档下那张卡照旧印着宿主按目录算的价').toContainText('0.30')
  // 阴性对照：这一档下宿主**根本不去碰那道门**，所以不该有任何失败。
  // ③ 里同一个定位器要变成「有」——两次之间唯一的变量就是档位。
  const failures = win.locator(`${CANVAS_PANEL} [data-v4-block="errorbar"], ${CANVAS_PANEL} [data-v4-block="tool"][data-status="failed"]`)
  await expect(failures, '「自动改」档下不该去决门，也就不该有任何失败').toHaveCount(0)
  await walk.snap('full-auto-01-safe-auto-still-asks')

  // 这一张**不丢弃**：2026-09-11 用户拍板「已经在等的那张卡不因切档而被放行」，
  // 而 ④ 正要证它在决门失败之后仍然在原处。切档对它的影响那一条由
  // `agent-spend-card.walk.mjs` 钉着，这里不重复断言。

  // ② 切到「全自动」。那张二次确认卡上的话必须和今天的行为一致——
  // 它 2026-09-12 之前写的是「付费和不可逆的操作仍然每次问」，而那句话现在是假的。
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_PERMISSION}`), '权限档选择器')
  await expect(win.locator(`${CANVAS_PANEL} ${PERMISSION_POPOVER}`)).toBeVisible()
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${permissionTier('project')}`), '切到「全自动」')
  const switchCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard, '切档本身仍然要问一次——这一次点头就是他对之后每一笔付费的授权').toBeVisible()
  await expect(switchCard, '切档确认必须说清「付费生成会直接跑」，不能还写着「付费仍然每次问」')
    .toContainText('付费生成也会直接跑')
  await walk.snap('full-auto-02-switch-says-paid-runs-directly')
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到全自动')

  const banner = win.locator(`${CANVAS_PANEL} [data-v4-block="auto-mode"]`)
  await expect(banner, '全自动档要有常驻提醒——用户得一直知道自己在这一档').toBeVisible()
  await expect(banner, '提醒那一行也要说实话：付费生成会直接跑').toContainText('付费生成会直接跑')

  // ③ 再问一次。这一次宿主会**当场去决那道门**——在这台夹具上它会被诚实地拒绝，
  // 而拒绝必须是用户看得见的（沉默是这一族里最贵的回答）。
  const second = draftTurn(walk, { marker: 'S_AUTO_ASK_2', callId: 'auto-draft-2', prompt: '同一个六棱柱，换一个俯视角度', done: 'S_AUTO_DONE_2：这一笔我按你的档位直接处理了。' })
  await sendCanvas(win, ASK_FULL)
  await recorded(second.planner.received, 'full-auto draft request')
  await recorded(second.finished.received, 'full-auto draft result')

  await expect(failures.first(), '「全自动」档下宿主要真的去决门——它没去，这一格就永远是空的')
    .toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await walk.snap('full-auto-03-host-really-decided-the-gate')

  // ④ 决不成就不假装成功：那一笔仍然待决，卡还在原处等人答。
  // 这正是「不吞错、不兜底」——**不是**「全自动地什么都没发生」。
  await expect(card, '决门失败时那一笔仍然待决：卡必须还在，不许被悄悄吃掉').toBeVisible()
  await walk.snap('full-auto-04-failed-decision-leaves-the-card')

  expect(walk.fixture.images, '整场走查一次供应商生成都没发生（零额度）').toHaveLength(0)

  walk.report.verified = ['safe-auto-does-not-touch-the-gate', 'switch-copy-matches-behaviour',
    'full-auto-really-decides-the-gate', 'failed-decision-leaves-the-card']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
