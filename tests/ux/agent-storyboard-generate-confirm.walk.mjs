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
// 三段真人任务：
//   ① 卡出来 → **点取消** → 回包 `decision: 'declined'`；画布一个节点都不多（批准之前不落占位，
//      ad7ae74a7 2026-10-08「defer row materialization until approval」），方案还在左栏，零供应商请求；
//   ② 他在创作页点「放入画布」→ 两镜各落一个节点（还没生成）；
//   ③ 卡再出来 → **点确认** → 回包 `decision: 'started'`，loopback 真的收到两次生成请求，而且**每镜仍只有 1 个节点**
//      （先放到画布再确认，不再落第二份——#1139 验收项「文稿计划先放画布再确认只出 1 个节点」）。
//
// 零额度：供应商是 loopback 夹具。
//
// Run: pnpm run build && node tests/ux/agent-storyboard-generate-confirm.walk.mjs
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from './agent-runtime-fixture.mjs'
import { createRuntimeWalk, openCanvas, readProject } from './agent-runtime-walk-support.mjs'
import { ensureCreationResourceTree } from './_creationResourceTree.mjs'

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
  /** 每一镜在画布上有几个节点（按分镜绑定键 storyboardDesignId × shotId 数，与生产判据 storyboardNodeBinding 同一键）。 */
  const nodesPerShot = async () => {
    const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
    return Object.fromEntries(plan.shots.map(shot => [shot.shotId,
      nodes.filter(node => node.meta?.storyboardDesignId === DESIGN_ID && node.meta?.shotId === shot.shotId && node.meta?.storyboardKeyframe !== true).length]))
  }

  // ── ① 他点取消 ─────────────────────────────────────────────────────────────────────
  await present('declined')
  await expect(dialog, '文稿方案的 generate 停的就是这张全屏花钱确认框').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const dialogProof = await proveProbe(dialog, '那张全屏花钱确认框真的会出现')
  await walk.snap('storyboard-spend-dialog')
  // 批准之前不落占位（ad7ae74a7：行物化推迟到批准之后）：卡在等他点头时，画布上还没有这两镜的节点。
  // 这里原先的探针「两镜各有一个占位」是那次改动之前的形状，origin/main 上同样数到 0（#1139 验收对照）。
  const beforeDecline = await graph()
  expect(await nodesPerShot(), '确认之前一镜都不落').toEqual({ 'shot-1': 0, 'shot-2': 0 })
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

  // ── ② 他先在创作页点「放入画布」──────────────────────────────────────────────────────
  await clickOrFail(win.getByRole('button', { name: /^(创作|Create)$/ }), '去创作页')
  await ensureCreationResourceTree(win, '创作页')
  await clickOrFail(win.locator(`[data-document-row="${documentId}"] button[data-document-id="${documentId}"]`), '选中这份文稿')
  await clickOrFail(win.locator(`[data-storyboard-id="${DESIGN_ID}"]`), '打开这份文稿方案')
  await clickOrFail(win.locator(`[data-place-storyboard="${DESIGN_ID}"]`), '在方案页头点那颗「放到画布上」的按钮')
  await expect.poll(nodesPerShot, { timeout: DEFAULT_TIMEOUT_MS, message: '放入画布：两镜各落一个节点' }).toEqual({ 'shot-1': 1, 'shot-2': 1 })
  const placed = await graph()
  expect(walk.fixture.images, '只是摆上画布，不花钱').toHaveLength(0)
  await walk.snap('storyboard-placed-on-canvas')
  await openCanvas(win)

  // ── ③ 他点确认 ─────────────────────────────────────────────────────────────────────
  //
  // 真出图之后**不再**自动审片（4c1c90b7c 2026-09-26 用户拍板：「生成全部」只花生成的钱）。原先这里等两次审片当作
  // 「真开跑」的下游证据，那是旧形状；现在的证据是两次生成请求真的到了 loopback、两个节点真的拿到了结果。
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
  await expect.poll(async () => {
    const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
    return placed.filter(id => nodes.find(node => node.id === id)?.result?.url).length
  }, { timeout: DEFAULT_TIMEOUT_MS, message: '放上去的两个节点真的拿到了这次的结果' }).toBe(2)
  // 先放到画布再确认：每镜仍只有 1 个节点，就是放上去的那两个（没有第二份）。
  expect(await nodesPerShot(), '确认之后每镜仍只有 1 个节点').toEqual({ 'shot-1': 1, 'shot-2': 1 })
  expect(await graph(), '确认用的就是放上去的那两个节点').toEqual(placed)
  await walk.snap('storyboard-confirmed-really-runs')

  walk.report.verified = ['storyboard-present-shows-the-real-spend-dialog',
    'cancel-reports-declined-and-changes-nothing', 'place-on-canvas-lands-one-node-per-shot',
    'confirm-after-placing-reuses-the-placed-nodes', 'confirm-reports-started-and-really-runs']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
