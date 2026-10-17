// #1203「Agent 权限两档 + 两个刹车」真付费验收的步骤本体（2026-10-16）。
// 真付费走查（agent-permission-two-tiers.paid.mjs）与 loopback 演练（agent-permission-two-tiers-paid.rehearsal.walk.mjs）
// 跑**同一份**步骤：差别只在 `ctx.ask`——真付费让真模型自己决定怎么调工具，演练给夹具里的大脑写剧本。
//
// 步骤与判据照 D-L19 报告「给协调的最小量真付费验收」，再按 #1224（协调定 A）改：文稿方案两档下都每批问一次。图片最多 4 张：
//   ① 切到「直接生成」——不花钱（创作面板）；
//   ② 文稿方案第一轮「拆 2 镜，现在就生成」（创作面板）：预期整批确认**恰好弹一次**（没弹 = 档位悄悄代答、弹两次 = 重复问，都判失败），
//        走查点确认，核受理 2、收据 1～2 条、decidedBy 是人批那一类（不是 policy:full_auto）；
//   ③ 第二轮「再补第 3 镜，也现在就生成」：核计划外刹车（刹车卡出现、计划外这一张不发）。文稿方案这条路目前没接刹车
//        （docs/plan/2026-10-16-manuscript-plan-own-run.md），所以预期是再弹一次整批确认：取消它（不发、不花钱），记 unverified；
//   ②b 回退：文稿方案第一轮一张都没花时，到画布面板走 D-L19 原来的第 2 步（画布草稿 2 镜，直接生成不弹卡）；
//   ④ 画布面板再生成一次（要 2 张），供应商**受理**第一张后马上点停止（宿主一张一张交：上一张被受理了才批下一张，「交出」指交给供应商）：
//      停止后新增提交 0，已交出的那张照常完成、只扣一次，重开面板后没有重复提交。这几条钱上的判据不变。
//      第二张可能抢在停止之前就发出去（lostRace）：记 unverified，不判失败。**停止的时机由 loopback 测试覆盖**
//      （演练里夹具把第二张的受理压在门口，让「受理第一张后点停止」稳定赶得上），真付费只核钱上的事实。
//   总数：2（文稿方案）+ 至多 2（停止步）= 最多 4 张；回退路径同样 2 + 2。
// 刹车 1（同一镜连续失败）不在真付费里验：不该花钱造失败，靠适配器边界测试。
//
// 每一步只记事实（受理次数、收据条数与 decidedBy、有没有弹卡 / 弹框、停止后新增提交数），事实全部取自盘上，不取自界面；
// 判据在 _paidFacts.mjs（纯函数，单测钉着）。
import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import {
  acceptedByRuns, countLaneToolCalls, deltaFacts, readSpendFacts, stepBrakeVerdict, stepDirectBatchVerdict, stepManuscriptBatchVerdict, stepStopVerdict, stepSwitchVerdict,
} from './_paidFacts.mjs'
import { SPEND_DIALOG } from './_paidRun.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_PERMISSION, COMPOSER_STOP, CREATION_PANEL, DOCUMENT, INTERVENTION_ALTERNATE,
  INTERVENTION_CONFIRM, PERMISSION_POPOVER, expandResidentPanel, permissionTier,
} from './agent-runtime-walk-support.mjs'
import { uiText } from './full-walk/invariants.mjs'

export const spendCardSelector = (panel) => `${panel} ${APPROVAL_CARD}[data-kind="spend"]`
/** 预计总数（张）与最坏总数：再多就是跑飞了，保险丝立刻停 App。 */
export const IMAGE_CAP = 3
export const IMAGE_HARD_CAP = 4
/** 一张图「交出」的 job 状态（与 _spendStopRounds.mjs 的 settledJobs 同一组词）。 */
const DELIVERED = new Set(['adopted', 'ready'])

/** 「之后再没有新的提交」的观察窗口：只是看一会儿，不是完成条件（公共预算 owner：tests/ux/_station-budget.mjs）。 */
export const QUIET_WINDOW_MS = stationTimeout({ operations: 1 })

export const DOCUMENT_TEXT = '清晨的渔港，薄雾里渔船缓缓出港。\n日落时分，海面被染成金色，渔船归航。'

/**
 * 花钱保险丝：盯着盘上的受理数，超过当前上限就当场停 App（App 停了就再没有新的提交）。
 * 它不替代步骤自己的判据——只是兜住「模型反复生成」这类跑飞的情形，把多花的钱限制在一张以内。
 */
export function createSpendCap({ projectRoot, stopApp, ceiling = IMAGE_HARD_CAP, intervalMs = 700, read = acceptedByRuns }) {
  let limit = ceiling
  let breached = null
  const timer = setInterval(() => {
    if (breached) return
    const accepted = read(projectRoot)
    if (accepted > limit) {
      breached = { accepted, limit }
      console.error(`[paid] 受理数 ${accepted} 超过当前上限 ${limit}——立即停掉被测 App`)
      Promise.resolve(stopApp()).catch(() => {})
    }
  }, intervalMs)
  return {
    setCeiling(next) { limit = Math.min(next, IMAGE_HARD_CAP) },
    stop() { clearInterval(timer) },
    breached: () => breached,
    assertNotBreached() { if (breached) throw new Error(`花钱保险丝跳了：供应商受理 ${breached.accepted} 次，当前上限 ${breached.limit}`) },
  }
}

/**
 * 在真实 DOM 上挂观察者：Agent 面板的报价卡、全局确认框（旧版 SpendConfirmDialog）各**出现过几次**，以及出现时的字。
 * 两个都算「花钱前问了人」：直接生成档下，哪一个都不该出现。
 */
export async function watchSpendUi(win, panel) {
  const slot = `__paidSpendUiWatch${Date.now()}`
  await win.evaluate(({ card, dialog, slot: key }) => {
    const log = { cards: 0, dialogs: 0, cardTexts: [], dialogTexts: [] }
    let cardOpen = false
    let dialogOpen = false
    const sample = () => {
      const cardEl = document.querySelector(card)
      if (cardEl && !cardOpen) { log.cards += 1; log.cardTexts.push((cardEl.textContent ?? '').trim().slice(0, 600)) }
      cardOpen = Boolean(cardEl)
      const dialogEl = document.querySelector(dialog)
      if (dialogEl && !dialogOpen) { log.dialogs += 1; log.dialogTexts.push((dialogEl.textContent ?? '').trim().slice(0, 600)) }
      dialogOpen = Boolean(dialogEl)
    }
    window[key] = log
    sample()
    new MutationObserver(sample).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
  }, { card: spendCardSelector(panel), dialog: SPEND_DIALOG, slot })
  return { read: () => win.evaluate((key) => window[key], slot) }
}

export async function switchAppLocale(win, locale) {
  const code = locale === 'zh-CN' ? 'zh-CN' : 'en'
  await clickOrFail(win.getByRole('button', { name: /^(设置|Settings)$/ }).first(), '顶栏「设置」按钮')
  await clickOrFail(win.locator('[data-settings-tab-id="general"]'), '设置导航「通用」')
  await clickOrFail(win.locator(`[data-settings-locale="${code}"]`), `语言 ${locale}`)
  await expect(win.locator(`[data-settings-locale="${code}"][aria-pressed="true"]`), `界面已切到 ${locale}`).toBeVisible()
  await clickOrFail(win.locator('[data-settings-close]'), '设置对话框「关闭」按钮')
}

/** 回到画布面板（中英文界面都认「生成 / Generate」那颗顶栏钮）。 */
export async function openCanvasAnyLocale(win) {
  await clickOrFail(win.getByRole('button', { name: /^(生成|Generate)$/ }), '生成工作区')
  await expect(win.locator('.generation-canvas-v2__stage')).toBeVisible()
  await expandResidentPanel(win)
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}`)).toBeVisible()
}

export function createStepContext({ win, walk, projectRoot, capabilityDir, ask, allowedModel, cap }) {
  const snapshot = () => readSpendFacts({ projectRoot, capabilityDir })
  const record = (name, value) => { (walk.report.steps ??= {})[name] = value; return value }
  return { win, walk, projectRoot, capabilityDir, ask, allowedModel, cap, snapshot, record }
}

/** 步骤 ①：权限弹层 → 「直接生成」→ 确认卡 → 档位变 direct。不花钱。 */
export async function runSwitchStep(ctx, { panel = CREATION_PANEL } = {}) {
  const { win, walk, snapshot, record } = ctx
  const before = snapshot()
  await clickOrFail(win.locator(`${panel} ${COMPOSER_PERMISSION}`), '权限档选择器')
  await expect(win.locator(`${panel} ${PERMISSION_POPOVER}`)).toBeVisible()
  await clickOrFail(win.locator(`${panel} ${permissionTier('direct')}`), '点「直接生成」')
  const switchCard = win.locator(`${panel} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard, '切档先弹一张确认卡').toBeVisible()
  await walk.snap('paid-01-zh-switch-confirm-card')
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), `确认卡「${uiText('zh-CN', 'agentPanelV4.autoModeConfirmOk')}」`)
  const mode = await win.locator(`${panel} ${COMPOSER}`).first().getAttribute('data-approval-mode')
  await walk.snap('paid-02-zh-direct-with-reminder')
  const problems = stepSwitchVerdict({ mode, delta: deltaFacts(before, snapshot()) })
  return record('1-switch-to-direct', { mode, problems })
}

/**
 * 等「报价卡出现」「全局确认框出现」「这一轮落地且什么都没弹」或超时。返回 'card' | 'dialog' | 'idle' | 'timeout'。
 * 起飞宽限 8 秒：刚点发送时 composer 还没进运行态，不能把「还没起飞」当成「已落地」。
 */
export async function waitForSpendUiOrIdle(win, panel, { timeout, graceMs = 8_000, pollMs = 500 }) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await win.locator(spendCardSelector(panel)).count()) return 'card'
    if (await win.locator(SPEND_DIALOG).count()) return 'dialog'
    const running = await win.locator(`${panel} ${COMPOSER}[data-mode="running"]`).count()
    if (!running && Date.now() - started > graceMs) return 'idle'
    await win.waitForTimeout(pollMs)
  }
  return 'timeout'
}

/** 取消那个全局确认框（旧版 SpendConfirmDialog）：不花钱，让被它挂住的这一轮收尾。 */
async function cancelSpendDialog(win) {
  await clickOrFail(win.locator(SPEND_DIALOG).getByRole('button', { name: /^(取消|Cancel)$/ }), '确认框「取消」')
  await expect(win.locator(SPEND_DIALOG), '确认框关掉了').toHaveCount(0, { timeout: stationTimeout({ operations: 2 }) })
}

/**
 * 让这一轮收尾：又冒出确认框就取消，15 秒后还在跑就点停止（模型被拒之后可能重试，不能让它把后面的步骤堵住）。
 * 只做「关掉 / 停下」，不做任何会花钱的动作。返回 'idle' | 'stopped' | 'timeout'。
 */
export async function settleTurn(win, panel, { maxMs = stationTimeout({ turns: 1, operations: 4 }), stopAfterMs = 15_000, pollMs = 500 } = {}) {
  const started = Date.now()
  let stopped = false
  while (Date.now() - started < maxMs) {
    if (await win.locator(SPEND_DIALOG).count()) { await cancelSpendDialog(win).catch(() => {}); continue }
    if (!(await win.locator(`${panel} ${COMPOSER}[data-mode="running"]`).count())) return stopped ? 'stopped' : 'idle'
    if (!stopped && Date.now() - started > stopAfterMs) {
      const stop = win.locator(`${panel} ${COMPOSER_STOP}`)
      if (await stop.count()) { await stop.first().click().catch(() => {}); stopped = true }
    }
    await win.waitForTimeout(pollMs)
  }
  return 'timeout'
}

/**
 * 等「受理够了」「报价卡出现」「全局确认框出现」「这一轮落地且什么都没弹」或超时。
 * 返回 'accepted' | 'card' | 'dialog' | 'idle' | 'timeout'。`wantAccepted` 缺省 = 不看受理数。
 */
async function waitForTurnOutcome(ctx, panel, { wantAccepted = null, baseline = 0, timeout, graceMs = 8_000, pollMs = 500 }) {
  const { win, cap } = ctx
  const started = Date.now()
  while (Date.now() - started < timeout) {
    cap.assertNotBreached()
    if (wantAccepted !== null && acceptedByRuns(ctx.projectRoot) - baseline >= wantAccepted) return 'accepted'
    if (await win.locator(spendCardSelector(panel)).count()) return 'card'
    if (await win.locator(SPEND_DIALOG).count()) return 'dialog'
    const running = await win.locator(`${panel} ${COMPOSER}[data-mode="running"]`).count()
    if (!running && Date.now() - started > graceMs) return 'idle'
    await win.waitForTimeout(pollMs)
  }
  return 'timeout'
}

/** 文稿方案的整批确认（#1224 的确认入口 `confirmStoryboardPlanBatch`）：全局确认框里挂着逐镜勾选清单。返回 { shots, text } 或 null。 */
async function readBatchConfirm(win) {
  const dialog = win.locator(SPEND_DIALOG).first()
  if (!(await dialog.count())) return null
  const shots = await dialog.locator('input[type="checkbox"], [role="checkbox"]').count()
  const text = ((await dialog.textContent().catch(() => '')) ?? '').trim().slice(0, 300)
  return { shots, text }
}

/**
 * 步骤 ② + ③：文稿方案分两轮。
 * 第一轮「拆 2 镜，现在就生成」：#1224（协调定 A）起文稿方案两档下都**每批问一次**——整批确认恰好弹一次（没弹 / 弹两次都判失败），
 * 走查点确认，再核受理 2、收据 1～2 条、决定人是人。
 * 第二轮「再补第 3 镜，也现在就生成」：要核计划外刹车（卡出现、计划外这一张不发）。文稿方案这条路目前没有接刹车（见
 * docs/plan/2026-10-16-manuscript-plan-own-run.md），第二轮预期是**再弹一次整批确认**而不是刹车卡：取消它（不发、不花钱），
 * 记 unverified——刹车卡出现了才算验到。返回 { accepted, dialogShown, abort }。
 */
export async function runPlanAndBrakeStep(ctx, { askText, askMoreText }) {
  const { win, walk, snapshot, record, cap, allowedModel } = ctx
  const panel = CREATION_PANEL
  // 写两句文稿（真键盘输入，编辑器是 tiptap）。
  await clickOrFail(win.locator(DOCUMENT), uiText('zh-CN', 'creationAi.editor.documentAria'))
  await win.keyboard.type(DOCUMENT_TEXT)
  await win.waitForTimeout(1_500)
  const watch = await watchSpendUi(win, panel)
  const before = snapshot()
  const beforeRuns = acceptedByRuns(ctx.projectRoot)
  const brakeTitle = (locale) => uiText(locale, 'agentPanelV4.brakeOutOfPlan.title')
  const turnTimeout = stationTimeout({ turns: 2, operations: 4 })

  // ── 第一轮：拆 2 镜、现在就生成。分两轮是因为一句话里说完 3 镜，模型会一次把 3 镜建进同一个方案，刹车 2 无从触发。
  cap.setCeiling(before.accepted + 2)
  await ctx.ask('plan', askText)
  const first = await waitForTurnOutcome(ctx, panel, { timeout: turnTimeout })
  let confirm = null
  let confirmed = false
  if (first === 'dialog') {
    confirm = await readBatchConfirm(win)
    await walk.snap('paid-03-zh-doc-plan-batch-confirm')
    if (confirm && confirm.shots === 2) {
      await clickOrFail(win.locator(SPEND_DIALOG).locator('[data-spend-confirm-action="confirm"]'), '整批确认的「生成」')
      confirmed = true
      await waitForTurnOutcome(ctx, panel, { wantAccepted: 2, baseline: beforeRuns, timeout: turnTimeout })
      await settleTurn(win, panel) // 让这一轮收尾（收据与 Run 落盘）；要是又冒出确认框，settleTurn 会取消它，而下面按出现次数判失败
    } else {
      await cancelSpendDialog(win) // 不是预期的 2 镜整批确认：取消，不花钱，下面判失败
    }
  } else if (first === 'card') {
    await clickOrFail(win.locator(spendCardSelector(panel)).locator(INTERVENTION_ALTERNATE), '报价卡上的「去掉」')
    await settleTurn(win, panel)
  }
  cap.assertNotBreached()
  const afterFirst = snapshot()
  const log1 = await watch.read()
  const front = deltaFacts(before, afterFirst)
  const generateCalls = countLaneToolCalls(ctx.projectRoot, 'generate')
  const problems2 = stepManuscriptBatchVerdict({
    expected: 2, batchDialogs: log1.dialogs, cardAppearances: log1.cards, delta: front, models: afterFirst.models, allowedModel,
  })
  if (first === 'dialog' && confirm && confirm.shots !== 2) problems2.push(`整批确认里的镜头数应为 2，实际 ${confirm.shots}（没点确认）`)
  // 第一轮落地之后 generate 一次都没调：大脑没按要求生成，别再往下花 token（D-L19 诊断：V4 Flash 只建草稿不调 generate）。
  const brainNoGenerate = (first === 'idle' || first === 'timeout') && generateCalls === 0
  if (brainNoGenerate) problems2.push('大脑没调 generate：第一轮落地后 generate 次数为 0，文稿方案的整批确认根本没出现（不是档位的问题）')
  record('2-manuscript-first-two-shots', {
    outcome: first, batchDialogs: log1.dialogs, cardsShown: log1.cards, confirmedByWalk: confirmed, generateCalls,
    accepted: front.accepted, receipts: front.receipts, decidedBy: front.decidedBy,
    ...(confirm ? { confirmShots: confirm.shots, confirmText: confirm.text } : {}), ...(brainNoGenerate ? { brainNoGenerate: true } : {}), problems: problems2,
  })
  if (brainNoGenerate) {
    await settleTurn(win, panel)
    record('3-out-of-plan-brake', { skipped: true, inconclusive: true, note: '第一轮大脑没调 generate，没有继续（没再花 token）', problems: [] })
    return { accepted: front.accepted, dialogShown: false, abort: 'brain-no-generate' }
  }
  if (!confirmed || front.accepted < 2) {
    record('3-out-of-plan-brake', { skipped: true, inconclusive: true, note: `第一轮没有凑够 2 次受理（${first}），没有发第二轮`, problems: [] })
    return { accepted: front.accepted, dialogShown: first === 'dialog' }
  }

  // ── 第二轮：再补第 3 镜，也现在就生成——计划外的新镜；刹车卡出现才算验到「计划外那一张不发」。
  cap.setCeiling(afterFirst.accepted)
  await ctx.ask('plan2', askMoreText)
  const second = await waitForTurnOutcome(ctx, panel, { timeout: turnTimeout })
  cap.assertNotBreached()
  const atUi = snapshot()
  let brakeLineShown = false
  let secondDialog = null
  if (second === 'card') {
    const card = win.locator(spendCardSelector(panel)).first()
    brakeLineShown = (await card.textContent().catch(() => '')).includes(brakeTitle('zh-CN'))
    await walk.snap('paid-04-zh-brake-card-out-of-plan')
    // 同一张卡切成 English 再看一次（卡不收：待决状态与语言无关）。
    await switchAppLocale(win, 'en')
    await expect(card, '英文界面下刹车那一行也在').toContainText(brakeTitle('en'))
    await walk.snap('paid-05-en-brake-card-out-of-plan')
    await clickOrFail(win.locator(spendCardSelector(panel)).locator(INTERVENTION_ALTERNATE), '报价卡上的「去掉」')
  } else if (second === 'dialog') {
    secondDialog = await readBatchConfirm(win)
    await walk.snap('paid-04-zh-doc-plan-second-batch-confirm')
    await cancelSpendDialog(win) // 计划外这一张不发
  }
  if (second === 'card' || second === 'dialog') await settleTurn(win, panel)
  await win.waitForTimeout(QUIET_WINDOW_MS)
  cap.assertNotBreached()
  const afterAction = snapshot()
  const generateCalls2 = countLaneToolCalls(ctx.projectRoot, 'generate') - generateCalls
  const verdict = stepBrakeVerdict({
    cardAppeared: second === 'card', brakeLineShown, acceptedTotal: deltaFacts(before, afterAction).accepted, deltaAfterRemove: deltaFacts(atUi, afterAction),
  })
  const problems3 = second === 'dialog' ? [] : verdict.problems
  if (second === 'dialog' && deltaFacts(atUi, afterAction).accepted !== 0) problems3.push('取消第二轮整批确认之后供应商不该再受理')
  const noGenerate2 = second !== 'card' && second !== 'dialog' && generateCalls2 === 0
  if (noGenerate2) problems3.push('第二轮大脑没调 generate：刹车没有被触发的机会（不是刹车的问题）')
  record('3-out-of-plan-brake', {
    outcome: second, generateCalls: generateCalls2, cardAppeared: second === 'card', brakeLineShown, boundary: verdict.boundary,
    acceptedAfterRemove: deltaFacts(before, afterAction).accepted, receiptsAfterRemove: deltaFacts(atUi, afterAction).receipts,
    ...(second === 'dialog' ? {
      note: '第二轮弹的是整批确认（文稿方案每批问一次），不是计划外刹车卡：刹车没有接到文稿方案这条路上（unverified）；已取消，计划外那一镜没发',
      inconclusive: true, secondConfirmShots: secondDialog?.shots,
    } : {}),
    problems: problems3,
  })
  return { accepted: deltaFacts(before, afterAction).accepted, dialogShown: second === 'dialog' }
}

/** 回退步骤（D-L19 原第 2 步）：画布面板，一次要 2 张图——直接生成档下不弹卡、不弹框、受理 2 次、收据 2 条（policy:full_auto）。 */
export async function runCanvasDirectStep(ctx, { askText }) {
  const { win, walk, snapshot, record, cap, allowedModel } = ctx
  const panel = CANVAS_PANEL
  await openCanvasAnyLocale(win)
  // 档位是项目级的：画布面板上也应该显示 direct。
  const mode = await win.locator(`${panel} ${COMPOSER}`).first().getAttribute('data-approval-mode')
  const watch = await watchSpendUi(win, panel)
  const before = snapshot()
  cap.setCeiling(before.accepted + 2)
  await ctx.ask('canvas', askText)
  const timeout = stationTimeout({ turns: 2, operations: 4 })
  const started = Date.now()
  let outcome = 'timeout'
  while (Date.now() - started < timeout) {
    const now = snapshot()
    if (now.accepted - before.accepted >= 2) { outcome = 'accepted'; break }
    if (await win.locator(SPEND_DIALOG).count()) { outcome = 'dialog'; break }
    if (await win.locator(spendCardSelector(panel)).count()) { outcome = 'card'; break }
    const running = await win.locator(`${panel} ${COMPOSER}[data-mode="running"]`).count()
    if (!running && Date.now() - started > 8_000) { outcome = 'idle'; break }
    cap.assertNotBreached()
    await win.waitForTimeout(500)
  }
  // 受理 2 次之后再等一会儿，让收据与 Run 落盘、有没有第三次受理也露出来。
  await win.waitForTimeout(outcome === 'accepted' ? QUIET_WINDOW_MS : 0)
  cap.assertNotBreached()
  const log = await watch.read()
  const delta = deltaFacts(before, snapshot())
  await walk.snap('paid-05-zh-canvas-direct-two-images')
  const problems = stepDirectBatchVerdict({
    expected: 2, cardAppearances: log.cards, dialogAppearances: log.dialogs, delta, models: snapshot().models, allowedModel,
  })
  if (mode !== 'direct') problems.push(`画布面板上的档位应为 direct，实际 ${mode}`)
  if (outcome === 'dialog') await cancelSpendDialog(win).catch(() => {})
  await settleTurn(win, panel)
  const generateCalls = countLaneToolCalls(ctx.projectRoot, 'generate')
  const brainNoGenerate = (outcome === 'idle' || outcome === 'timeout') && generateCalls === 0
  if (brainNoGenerate) problems.push('大脑没调 generate：落地后 generate 次数为 0，「直接生成」档的代答根本没被触发（不是档位的问题）')
  return record('2b-canvas-direct-two-images', {
    brainNoGenerate: brainNoGenerate || undefined, generateCalls, outcome, panelMode: mode, cardsShown: log.cards, dialogsShown: log.dialogs, accepted: delta.accepted, receipts: delta.receipts, decidedBy: delta.decidedBy, problems,
  })
}

/** 步骤 ④：画布面板再生成一次（2 张），供应商受理第一张后马上点停止。 */
export async function runStopStep(ctx, { askText, graceMs = QUIET_WINDOW_MS, settleMs = QUIET_WINDOW_MS }) {
  const { win, walk, snapshot, record, cap } = ctx
  const panel = CANVAS_PANEL
  await openCanvasAnyLocale(win)
  const before = snapshot()
  const beforeRuns = acceptedByRuns(ctx.projectRoot)
  cap.setCeiling(IMAGE_HARD_CAP)
  await ctx.ask('stop', askText)
  const timeout = stationTimeout({ turns: 2, operations: 4 })
  const started = Date.now()
  // 100ms 一问：宿主受理第一张之后批下一张很快，问得慢就赶不上停止。
  while (acceptedByRuns(ctx.projectRoot) <= beforeRuns) {
    if (Date.now() - started > timeout) throw new Error('第 4 步：等了很久供应商都没受理第一张')
    if (await win.locator(SPEND_DIALOG).count()) throw new Error('第 4 步：直接生成档下弹出了全局确认框，没有开始生成（一分钱没多花）')
    // 这一轮已经落地（composer 不再运行）、过了起飞宽限，而 generate 一次都没调：大脑没按要求生成，别干等。
    if (Date.now() - started > 8_000 && !(await win.locator(`${panel} ${COMPOSER}[data-mode="running"]`).count()) && countLaneToolCalls(ctx.projectRoot, 'generate') === 0) {
      throw new Error('第 4 步：大脑没调 generate（这一轮已落地、generate 次数为 0），没有再往下花 token')
    }
    cap.assertNotBreached()
    await win.waitForTimeout(100)
  }
  const stopButton = win.locator(`${panel} ${COMPOSER_STOP}`)
  const stopAvailable = (await stopButton.count()) > 0
  const acceptedAtClick = snapshot().accepted
  if (stopAvailable) await stopButton.first().click()
  await win.waitForTimeout(graceMs)
  const acceptedAtStop = snapshot().accepted
  await win.waitForTimeout(settleMs)
  const settled = snapshot()
  const fresh = new Set(settled.taskIds.filter((id) => !before.taskIds.includes(id)))
  const deliveredTaskIds = settled.jobs.filter((job) => DELIVERED.has(job.status) && job.providerTaskId && fresh.has(job.providerTaskId)).map((job) => job.providerTaskId)
  await walk.snap('paid-06-en-after-stop')
  // 重开面板：整页重载（项目路由在地址里），再等一会儿看有没有重复提交。
  await win.reload({ waitUntil: 'domcontentloaded' })
  await expect(win.locator(`${panel} ${COMPOSER}`).first(), '重载后面板回来了').toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
  await win.waitForTimeout(QUIET_WINDOW_MS)
  const acceptedAfterReopen = snapshot().accepted
  cap.assertNotBreached()
  const lostRace = acceptedAtStop - before.accepted >= 2 // 停止前第二张已经发出去了
  const problems = stopAvailable
    ? stepStopVerdict({ acceptedAtStop, acceptedAfterSettle: settled.accepted, acceptedAfterReopen, deliveredTaskIds })
    : []
  return record('4-stop-after-first-accepted', {
    stopAvailable, lostRace, acceptedAtClick, acceptedAtStop, acceptedAfterSettle: settled.accepted, acceptedAfterReopen,
    inFlightAtClick: acceptedAtStop - acceptedAtClick, deliveredTasks: deliveredTaskIds.length, newAcceptedThisStep: deltaFacts(before, snapshot()).accepted,
    note: !stopAvailable ? '第一张被受理时停止钮已不在（这一轮已经收尾）——unverified' : lostRace ? '第二张抢在停止之前就发出去了——停止没赶上，unverified' : undefined,
    problems,
  })
}

/** 全部步骤的问题合并成一份清单（空 = 全部成立；边界、没结论、没赶上的另列 unverified，不算失败也不算通过）。 */
export function collectProblems(steps) {
  const problems = Object.entries(steps).flatMap(([name, step]) => (step.problems ?? []).map((problem) => `${name}：${problem}`))
  const unverified = Object.entries(steps)
    .filter(([, step]) => step.boundary || step.inconclusive || step.stopAvailable === false || step.lostRace)
    .map(([name]) => name)
  return { problems, unverified }
}

/**
 * 大脑冒烟（花图片钱之前先问一句话）：Agent 在这个面板里能不能用被授权的大脑模型回一句话。
 * 2026-10-16 真 key 首跑：保存 key、收窄模型都对，但每一轮 Agent 回复都是红卡、0 token，直到第 4 步才发现——
 * 这一步把它提前到第 1 步之前：出红卡就当场停（还没花图片的钱），日志已经随证据目录留下。
 * 返回 { ok, reason }；不抛，由调用方记进报告并决定停不停。
 */
export async function runBrainSmokeStep(ctx, { panel = CREATION_PANEL, askText, timeout = stationTimeout({ turns: 1 }) }) {
  const { win, walk, record } = ctx
  await ctx.ask('smoke', askText)
  const started = Date.now()
  let outcome = 'timeout'
  while (Date.now() - started < timeout) {
    if (await win.locator(`${panel} [data-v4-block="errorbar"]`).count()) { outcome = 'error-card'; break }
    const replied = await win.locator(`${panel} [data-v4-block="assistant"]`).filter({ hasText: /\S/ }).count()
    const running = await win.locator(`${panel} ${COMPOSER}[data-mode="running"]`).count()
    if (replied && !running) { outcome = 'replied'; break }
    await win.waitForTimeout(500)
  }
  await walk.snap(`paid-00-brain-smoke-${outcome}`)
  const ok = outcome === 'replied'
  record('0-brain-smoke', {
    outcome,
    problems: ok ? [] : [outcome === 'error-card' ? 'Agent 用被授权的大脑模型回话时出了红卡（原始报错在证据目录的 app-logs 里）' : 'Agent 一直没回话'],
  })
  return { ok, outcome }
}
