#!/usr/bin/env node
// 真实用户任务（R13/R16）：**Agent 对「文稿方案」说「生成」之后，那张全屏花钱确认框的结局去了哪。**
//
// ── 这条走查补的是哪一格 ──
//
// 方案 §6 第 5 步的验收门里有一条「文稿方案 generate 端到端成功」，到 2026-09-22 为止没过。
// run5 抓到的形态（发现 ③）：用户在全屏 `SpendConfirmDialog` 上**答了**（A1 一次、A3 两次，
// 与 `spend-dialog:declined` 的次数一一对应），而 `generate` 那一轮读到的是
// `generation_approval_unavailable`「this host did not wait for his answer」——**错误形状**，
// 模型据此重试、进熔断。成因是渲染层把结局吞了：`presentStoryboard` 对确认和取消一律回
// `{status:'presented'}`（源码里那句「Original confirmation returns void for both acceptance
// and cancellation」）。
//
// 所以这里钉的是**那一格结局真的走回来了**，而且走的是真路：
//   真 Electron / 真项目 / 真渲染层 handler（`__nomiCapabilityApply('storyboard.present')` 就是
//   主进程 `presentStoryboardAuthoring` 打的那一个 op）/ 真 `SpendConfirmDialog` / 真 loopback 供应商。
//   不灌 store、不伪造回包、不直调 `confirmAndRunPlan`。
//
// 两条真人任务：
//   ① 卡出来 → **点取消** → 回包 `decision: 'declined'`；画布节点**一个不多也一个不少**，
//      方案还在左栏、还是 draft，零供应商请求（他没同意，就不该花钱）；
//   ② 卡再出来 → **点确认** → 回包 `decision: 'started'`，loopback 真的收到了生成请求。
//
// 零额度：供应商是 loopback 夹具。
//
// Run: pnpm run build && node tests/ux/agent-storyboard-generate-confirm.walk.mjs
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from './agent-runtime-fixture.mjs'
import { createRuntimeWalk, openCanvas, readProject, recorded } from './agent-runtime-walk-support.mjs'

const DESIGN_ID = 'walk-storyboard-design'
const SPEND_DIALOG = '[data-spend-confirm-dialog]'

/** 一份**文稿方案**：两镜，都还没有结果，所以 present 必然要问一次花钱。 */
const plan = {
  title: 'D5 文稿方案走查',
  anchors: [],
  shots: [1, 2].map(index => ({
    index, shotId: `shot-${index}`, shotKind: 'image', durationSec: 2, anchorIds: [],
    prompt: `一只悬浮的六棱柱，第 ${index} 镜`,
    modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR,
  })),
}

const walk = await createRuntimeWalk('storyboard-generate-confirm')
let failure
try {
  let { win } = await walk.start({ first: true })
  // `__nomiCapabilityApply` 只在 `__nomiE2E=1` 时挂上（挂载期 effect）。**先写标志再建项目**，
  // 省掉「reload 之后还要把项目重开一遍」那一段。
  await win.evaluate(() => window.localStorage.setItem('__nomiE2E', '1'))
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  const { projectId } = await walk.newProject()
  await win.waitForFunction(() => typeof window.__nomiCapabilityApply === 'function', undefined, { timeout: DEFAULT_TIMEOUT_MS })

  // 文档身份从**真的落盘那一份**读，不猜：方案挂在这个文档下（`storyboardDesignsByDocumentId`）。
  const documentId = await expect.poll(async () => (await readProject(win, projectId)).payload.workbenchDocuments?.[0]?.id,
    { timeout: DEFAULT_TIMEOUT_MS, message: '新建项目必须真的有一份创作文档' }).toBeTruthy()
    .then(async () => (await readProject(win, projectId)).payload.workbenchDocuments[0].id)

  // 建方案走的是 Agent 自己那条真路（`storyboard.upsert-design` = 主进程 `upsertStoryboardDesign` 打的 op）。
  const saved = await win.evaluate(async ({ projectId, documentId, designId, plan }) =>
    window.__nomiCapabilityApply('storyboard.upsert-design', { projectId, documentId, designId, plan, initiator: 'agent' }),
  { projectId, documentId, designId: DESIGN_ID, plan })
  expect(saved, '方案要真的落到用户左栏那一份存储里').toMatchObject({ status: 'saved', designId: DESIGN_ID })

  await openCanvas(win)
  const dialog = win.locator(SPEND_DIALOG)
  const present = async (label) => win.evaluate(async ({ projectId, documentId, designId, label }) => {
    // **不 await**：卡要先画出来给人看，回包在他点完之后才 resolve。
    window.__nomiStoryboardPresent = window.__nomiStoryboardPresent ?? {}
    window.__nomiStoryboardPresent[label] = window.__nomiCapabilityApply('storyboard.present',
      { projectId, designId, sourceDocumentId: documentId })
      .then(reply => ({ ok: true, reply }), error => ({ ok: false, message: String(error?.message ?? error) }))
    return true
  }, { projectId, documentId, designId: DESIGN_ID, label })
  const settled = async (label) => win.evaluate(l => window.__nomiStoryboardPresent[l], label)
  const graph = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.map(node => node.id).sort()

  // ── ① 他点取消 ─────────────────────────────────────────────────────────────────────
  await present('declined')
  await expect(dialog, '文稿方案的 generate 停的就是这张全屏花钱确认框').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const dialogProof = await proveProbe(dialog, '那张全屏花钱确认框真的会出现')
  await walk.snap('storyboard-spend-dialog')
  // 占位是 present 这一步落的（草稿的东西）；取消之后它们一个都不该少——与 × 同一条裁决。
  const beforeDecline = await graph()
  expect(beforeDecline.length, '探针：两镜各有一个占位落在画布上').toBeGreaterThanOrEqual(2)
  await clickOrFail(dialog.locator('[data-spend-confirm-action="cancel"]').first(), '在花钱确认框上点取消')
  await expectAbsent(dialog, { provenBy: dialogProof, message: '点完取消这张框就走了' })
  const declined = await expect.poll(async () => await settled('declined'),
    { timeout: DEFAULT_TIMEOUT_MS, message: 'present 必须在他答完之后 resolve' }).toMatchObject({ ok: true })
    .then(async () => (await settled('declined')).reply)
  expect(declined, '**结局要走回来**：这一格 2026-09-22 之前是空的，于是模型读到「没人等过他的答案」')
    .toMatchObject({ status: 'presented', designId: DESIGN_ID, decision: 'declined' })
  expect(walk.fixture.images, '他没同意，就不该花钱').toHaveLength(0)
  await expect.poll(graph, { timeout: DEFAULT_TIMEOUT_MS, message: '取消之后画布节点一个不多也一个不少' })
    .toEqual(beforeDecline)
  const design = await readProject(win, projectId)
  expect(design.payload.storyboardDesignsByDocumentId[documentId].find(entry => entry.id === DESIGN_ID)?.plan.shots.length,
    '方案还在左栏，两镜一个不丢').toBe(2)
  await walk.snap('storyboard-declined-nothing-changed')

  // ── ② 他点确认 ─────────────────────────────────────────────────────────────────────
  //
  // 真出图之后会跟着两次「审片」（每镜一次，`shotVerifyStore`）。它们是**真开跑的下游证据**：
  // 没跑过就不会有画面要审。先挂上等它们，别让它们落成「计划外请求」。
  const reviews = [1, 2].map(index => walk.fixture.expectText({
    label: `shot ${index} really came back and got reviewed`,
    match: body => JSON.stringify(body).includes(`一只悬浮的六棱柱，第 ${index} 镜`)
      && JSON.stringify(body).includes('资深影视分镜审片'),
    reply: { type: 'text', text: '{"identity":5,"aesthetics":4,"intent":5}' },
  }))
  await present('started')
  await expect(dialog).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]').first(), '在花钱确认框上点确认')
  await expectAbsent(dialog, { provenBy: dialogProof, message: '点完确认这张框也走了' })
  const started = await expect.poll(async () => await settled('started'),
    { timeout: DEFAULT_TIMEOUT_MS, message: 'present 必须在他答完之后 resolve' }).toMatchObject({ ok: true })
    .then(async () => (await settled('started')).reply)
  expect(started, '同意之后回包说的是「开跑了」').toMatchObject({ status: 'presented', decision: 'started' })
  await expect.poll(() => walk.fixture.images.length,
    { timeout: DEFAULT_TIMEOUT_MS, message: '确认之后 loopback 供应商真的收到了生成请求' }).toBe(2)
  for (const [index, review] of reviews.entries()) {
    await recorded(review.received, `shot ${index + 1} came back and got reviewed`)
  }
  await walk.snap('storyboard-confirmed-really-runs')

  walk.report.verified = ['storyboard-present-shows-the-real-spend-dialog',
    'cancel-reports-declined-and-changes-nothing', 'confirm-reports-started-and-really-runs']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
