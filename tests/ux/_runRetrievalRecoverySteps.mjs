// 「钱花了、任务号还在的单子只取回」零费用走查和真付费走查共用的一段步骤：
// 提交 → 中断（关窗或重启）+ 取回出故障 → 重开，观察者第一次查询失败 → 点重新取回又失败 → 老项目的错误卡 → 故障好了 → 重新取回落地。
// 全程只下过一单。差别只在 ctx 给的几个零件：怎么中断、怎么造故障、怎么数请求。
// 另外三段只给零费用演练：本机查不了（原连接停用）时卡上写真实原因；这单不要了就标记失败，这时才给重试；
// 窗口一直开着、单还在跑时渲染层放手给观察者（windowOpenJourney：3797fde0c 再发弹确认卡，c05ac86b4 观察者收完自动按号落回镜头）。
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { expect, expectAbsent, expectVisibleText, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { readProductionRuns } from './_paidRun.mjs'
import { closeRailDrawer, openRailDrawer } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

/** 修复后才会原样进产物的字面量（electron/productionRun/singleShotRunLifecycle.ts、electron/shared/nomiErrorCodes.ts）。 */
export const RECOVERY_BUILD_MARKERS = ['Nomi could not check this accepted task this time', 'Nomi cannot ask the provider about this accepted task right now']
const OLD_STORED_SENTENCE = '生成结果未能安全落入项目，请查看任务并处理'
/** 界面上的说法都从词典取，不在走查里另抄一份。 */
function labelsFor(locale) {
  const text = key => uiText(locale, key)
  const resendWaiting = text('generationCommon.spend.resend.waiting').split('\n')
  return {
    retrieve: text('generationCommon.production.runAction.retry-retrieval'),
    goRetrieve: text('generationCommon.observability.action.openRecoverable.main'),
    retry: text('generationCommon.observability.action.retry.main'),
    markFailed: text('generationCommon.recoverable.dismiss'),
    timedOut: text('generationCommon.recoverable.title'),
    unavailable: text('generationCommon.recoverable.unavailableTitle'),
    stillRunningTitle: text('generationCommon.spend.resend.title.image'),
    stillRunning: resendWaiting[0],
    mightChargeAgain: resendWaiting[1],
    projectAssets: text('assetLibrary.projectAssets'),
  }
}

function nodeFact(page, id) {
  return page.evaluate(id => {
    const node = window.__nomiCanvasStore.getState().nodes.find(item => item.id === id)
    return { status: node?.status, taskId: node?.runs?.[0]?.taskId, runRecordId: node?.runs?.[0]?.id, error: node?.error, versions: node?.history?.length ?? 0 }
  }, id)
}

function runOf(projectRoot, runRecordId) {
  return readProductionRuns(projectRoot).find(run => run.runId === `canvas-${runRecordId}`) ?? null
}

function storedTaskId(projectRoot, id) {
  const record = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8'))
  return record.payload?.generationCanvas?.nodes?.find(node => node.id === id)?.runs?.[0]?.taskId
}

/**
 * 断网：把这几家的地址重定向到不通的本机端口（产品自带测试网闸 electron/testNetworkGuard.ts）。App 关着时调，下次启动生效。
 * 真付费和它的演练共用这一个故障。不改模型目录：改目录可能让模型解不出来，测到的就不是断网了。
 */
export function blockVendorOrigins(origins) {
  process.env.NOMI_TEST_NETWORK_REDIRECTS = JSON.stringify(origins.map(from => ({ from, to: 'http://127.0.0.1:9' })))
}

export function unblockVendorOrigins() {
  delete process.env.NOMI_TEST_NETWORK_REDIRECTS
}

/** 等观察者第一次查询失败、把这一笔停成待取回（读盘上的 Run）。关窗路径要在窗口回来之前等到它。 */
export async function waitStoppedForRetrieval(projectRoot, runRecordId) {
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: stationTimeout({ operations: 6 }) }).toBe('needs_attention')
  expect(runOf(projectRoot, runRecordId).jobs.at(-1).errorCode).toBe('output_retrieval_failed')
}

/** 建一个节点、点生成，等到它带着任务号落盘：用户关窗时这一笔已经在项目里。 */
async function submitShot({ page, posts, projectRoot, node: spec, position, title = 'Retrieve me' }) {
  const postsBefore = posts()
  const id = await page.evaluate(({ spec, position, title }) => {
    const store = window.__nomiCanvasStore.getState()
    const node = store.addNode({ kind: spec.kind, categoryId: 'shots', title, prompt: spec.prompt, position, exactPosition: true,
      size: { width: 480, height: 320 }, meta: { modelVendor: spec.vendor, modelKey: spec.modelKey, previewHeight: 320 } })
    store.selectNode(node.id)
    return node.id
  }, { spec, position, title })
  // 用产品自己的节点对焦（保留底栏与时间轴余量），避免单节点 fitView 放大后把生成框顶到时间轴条下。
  await page.evaluate(nodeId => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId, select: true } })), id)
  await waitForVisualQuiescence(page)
  await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').first().click()
  await expect.poll(async () => (await nodeFact(page, id)).taskId, { timeout: stationTimeout({ operations: 4 }) }).toBeTruthy()
  await expect.poll(posts, { timeout: stationTimeout({ operations: 2 }) }).toBe(postsBefore + 1)
  const { runRecordId } = await nodeFact(page, id)
  await page.evaluate(() => window.__nomiCanvasStore.getState().clearSelection())
  await expect.poll(() => storedTaskId(projectRoot, id), { timeout: stationTimeout({ operations: 2 }) }).toBeTruthy()
  return { id, runRecordId, postsBefore }
}

/** 点一次「重新取回」，等这一次真的走完：面板先让位给「正在拉取」，又回来才算完（不然读到的是点之前那张）。 */
async function retrieveAndWait(page, id, retrieve) {
  const left = page.evaluate(id => new Promise(resolve => {
    const store = window.__nomiCanvasStore
    const stop = store.subscribe(state => { if (state.nodes.find(node => node.id === id)?.status !== 'recoverable') { stop(); resolve() } })
  }), id)
  await retrieve().click()
  await left
  await expect(retrieve()).toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
}

/**
 * 确认点击前守卫：核对已记账笔数、HTTP 入口已发起笔数与在途挂起 POST 均为预期值，
 * 防止「确认前已发起 HTTP POST 但尚未读完 body」逃过 `posts()` 取样。
 */
export function assertNoPostBeforeConfirm({ posts, postInitiatedAt, inFlightPosts, expectedBefore, stage = 'before confirm' }) {
  if (typeof postInitiatedAt !== 'function' || typeof inFlightPosts !== 'function') {
    throw new Error(`${stage}: postInitiatedAt 与 inFlightPosts 必填，才能证明确认前没有已发起或在途 POST`)
  }
  const initiated = postInitiatedAt()
  expect(posts(), `${stage}: recorded POST count`).toBe(expectedBefore)
  expect(initiated.length, `${stage}: initiated POST count at HTTP entry`).toBe(expectedBefore)
  expect(inFlightPosts(), `${stage}: no in-flight POST reading body`).toBe(0)
}

/**
 * 确认点击后守卫：证明第 N 笔 POST 的 HTTP 入口到达时刻严格 ≥ 确认点击前时刻 `confirmClickedAt`。
 */
export function assertPostInitiatedAfterConfirm({ posts, postInitiatedAt, inFlightPosts, expectedCount, confirmClickedAt, stage = 'after confirm' }) {
  if (typeof postInitiatedAt !== 'function' || typeof inFlightPosts !== 'function') {
    throw new Error(`${stage}: postInitiatedAt 与 inFlightPosts 必填，才能证明确认后发起时序`)
  }
  if (typeof confirmClickedAt !== 'number' || !Number.isFinite(confirmClickedAt)) {
    throw new Error(`${stage}: confirmClickedAt 必须是有限单调时间戳`)
  }
  const initiated = postInitiatedAt()
  expect(posts(), `${stage}: recorded POST count`).toBe(expectedCount)
  expect(initiated.length, `${stage}: initiated POST count at HTTP entry`).toBe(expectedCount)
  expect(inFlightPosts(), `${stage}: no lingering in-flight POST`).toBe(0)
  const newestInitiatedAt = initiated[expectedCount - 1]
  expect(typeof newestInitiatedAt === 'number' && Number.isFinite(newestInitiatedAt), `${stage}: POST #${expectedCount} timestamp missing`).toBe(true)
  expect(
    newestInitiatedAt,
    `${stage}: POST #${expectedCount} arrived at ${newestInitiatedAt} before confirm click (${confirmClickedAt})`,
  ).toBeGreaterThanOrEqual(confirmClickedAt)
  return newestInitiatedAt
}

export async function recoveryJourney(ctx) {
  const { locale, page: firstPage, interrupt, faultOff, posts, gets, shot, projectRoot, scenario } = ctx
  const labels = labelsFor(locale)
  const report = { scenario }
  let page = firstPage
  const { id, runRecordId, postsBefore } = await submitShot({ ...ctx, page })

  // 中断 + 取回出故障：观察者接手，第一次查询就失败。这一笔只差取回，不是死了。
  page = await interrupt(page, runRecordId)
  await waitStoppedForRetrieval(projectRoot, runRecordId)
  const card = () => page.locator(`.react-flow__node[data-id="${id}"]`)
  const retrieve = () => card().getByRole('button', { name: labels.retrieve, exact: true })
  // 鼠标挪开：刚点完的位置正好压在错误卡主按钮上，截到的是悬停样子。
  const settledShot = async (name) => { await page.mouse.move(2, 2); await waitForVisualQuiescence(page); await shot(name, card()) }
  await expect(retrieve()).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await settledShot(`${scenario}-1-panel`)

  // 故障还在时点一下：真去查了，没成，回到可找回，不下新单。
  const getsAtFirstClick = gets?.()
  await retrieve().click()
  if (gets) await expect.poll(gets, { timeout: stationTimeout({ operations: 2 }) }).toBeGreaterThan(getsAtFirstClick)
  await expect(retrieve()).toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: stationTimeout({ operations: 2 }) }).toBe('needs_attention')
  expect(posts()).toBe(postsBefore + 1)
  if (gets) report.getsWhileBroken = gets() - getsAtFirstClick

  // 老项目里已经存着的错误卡：主按钮是去重新取回，不是重试。
  await page.evaluate(({ id, sentence }) => window.__nomiCanvasStore.getState().setNodeStatus(id, 'error', sentence), { id, sentence: OLD_STORED_SENTENCE })
  const goRetrieve = card().getByRole('button', { name: labels.goRetrieve, exact: true })
  const proof = await proveProbe(goRetrieve, 'error card main button is observable')
  await expectAbsent(card().getByRole('button', { name: labels.retry, exact: true }), { provenBy: proof, message: 'an error card for a paid task never offers Retry as its button' })
  await settledShot(`${scenario}-2-error-card`)
  await goRetrieve.click()
  await expect(retrieve()).toBeVisible({ timeout: stationTimeout() })

  // 故障好了：再点一次，真查、落地，还是只下过一单。
  page = (await faultOff()) ?? page
  await expect(retrieve()).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  const getsAtLastClick = gets?.()
  await retrieve().click()
  await expect.poll(async () => (await nodeFact(page, id)).status, { timeout: stationTimeout({ operations: 8 }) }).toBe('success')
  if (gets) expect(gets()).toBeGreaterThan(getsAtLastClick)
  expect(posts()).toBe(postsBefore + 1)
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: stationTimeout({ operations: 2 }) }).toBe('ready')
  await expect.poll(() => runOf(projectRoot, runRecordId)?.status, { timeout: stationTimeout({ operations: 2 }) }).toBe('completed')
  await settledShot(`${scenario}-3-landed`)
  report.posts = posts() - postsBefore
  if (gets) report.gets = gets()
  return { report, page }
}

/**
 * 本机查不了：模型被关，Nomi 连问都问不了。全程不发查询、不下新单。
 * 关窗 / 重启后节点上还没有这条错误，第一眼是超时那句（已知限制），点一次才变成真实原因；窗口一直开着（不给 interrupt），第一眼就是真实原因。
 */
export async function unavailableJourney(ctx) {
  const { locale, page: firstPage, interrupt, modelOff, modelOn, posts, gets, shot, projectRoot, scenario } = ctx
  const labels = labelsFor(locale)
  const report = { scenario }
  let page = firstPage
  const { id, runRecordId, postsBefore } = await submitShot({ ...ctx, page })
  await modelOff(page)
  const card = () => page.locator(`.react-flow__node[data-id="${id}"]`)
  const retrieve = () => card().getByRole('button', { name: labels.retrieve, exact: true })
  const reason = () => card().getByText(labels.unavailable, { exact: true })
  const settledShot = async (name) => { await page.mouse.move(2, 2); await waitForVisualQuiescence(page); await shot(name, card()) }

  if (interrupt) {
    page = await interrupt(page, runRecordId)
    await waitStoppedForRetrieval(projectRoot, runRecordId)
    await expect(retrieve()).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await expectVisibleText(card(), labels.timedOut, { message: 'recoverable card shows timeout title visibly' })
    await settledShot(`${scenario}-1-first-look`)
    const getsBefore = gets()
    await retrieveAndWait(page, id, retrieve)
    expect(gets()).toBe(getsBefore)
  }
  // 窗口一直开着：查询连着失败，等够宽限落可找回。
  await expect(reason()).toBeVisible({ timeout: stationTimeout({ operations: 8 }) })
  await expect(retrieve()).toBeVisible()
  await expect(card().getByRole('button', { name: labels.markFailed, exact: true })).toBeVisible()
  const proof = await proveProbe(reason(), 'the real reason is on the card')
  await expectAbsent(card().getByRole('button', { name: labels.retry, exact: true }), { provenBy: proof, message: 'a card that cannot ask the provider never offers Retry' })
  await settledShot(`${scenario}-2-unavailable`)

  // 还没恢复就点：一个请求都发不出去，不下单，卡还在。
  const getsWhileOff = gets()
  await retrieveAndWait(page, id, retrieve)
  await expect(reason()).toBeVisible()
  expect(gets()).toBe(getsWhileOff)
  expect(posts()).toBe(postsBefore + 1)
  report.getsWhileOff = gets() - getsWhileOff

  // 开回来再点：真查、落地，还是只下过一单。
  await modelOn(page)
  await retrieve().click()
  await expect.poll(async () => (await nodeFact(page, id)).status, { timeout: stationTimeout({ operations: 8 }) }).toBe('success')
  expect(gets()).toBeGreaterThan(getsWhileOff)
  expect(posts()).toBe(postsBefore + 1)
  await expect.poll(() => runOf(projectRoot, runRecordId)?.status, { timeout: stationTimeout({ operations: 2 }) }).toBe('completed')
  await settledShot(`${scenario}-3-landed`)
  report.posts = posts() - postsBefore
  return { report, page }
}

/**
 * 窗口一直开着、供应商还在跑（图片模型渲染层等 2 分钟）：节点落可找回，观察者接着查。三个节点一起等，只等一次：
 * - a：标记失败再点重试，弹「上一次还没结束」确认卡（3797fde0c），不露错误码、取消前 0 新单；取消后观察者收完照常落回镜头。
 * - b：单跑完了，观察者写进项目并经 canvas.run-settled 自动按号落回镜头（c05ac86b4），不额外下单。
 * - c：单还在跑时标记失败并确认再发，这才发第二单；观察者收完第一单后原单产物仍在项目与素材抽屉里。
 */
export async function windowOpenJourney(ctx) {
  const { locale, page, imageNode, finishJobs, posts, postInitiatedAt, inFlightPosts, now = () => performance.now(), gets, shot, projectRoot, scenario } = ctx
  const labels = labelsFor(locale)
  const report = { scenario }
  const postsAtStart = posts()
  const submit = (position, title) => submitShot({ ...ctx, node: imageNode, position, title })
  const a = await submit({ x: 40, y: 40 })
  const b = await submit({ x: 620, y: 40 })
  const c = await submit({ x: 1200, y: 40 }, 'Retrieve c')
  const status = async node => (await nodeFact(page, node.id)).status
  const card = node => page.locator(`.react-flow__node[data-id="${node.id}"]`)
  const button = (node, name) => card(node).getByRole('button', { name, exact: true })
  // 产品自己的对焦（只跳不选）：三个节点一起看太小，要点哪一个、拍哪一个，先把它拉到跟前。
  const focus = async (node) => {
    await page.evaluate(nodeId => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId, select: false } })), node.id)
    await page.mouse.move(2, 2)
    await waitForVisualQuiescence(page)
  }
  const settledShot = async (name, locator) => { await page.mouse.move(2, 2); await waitForVisualQuiescence(page); await shot(name, locator) }

  for (const node of [a, b, c]) await expect.poll(() => status(node), { timeout: stationTimeout({ operations: 12 }) }).toBe('recoverable')
  assertNoPostBeforeConfirm({ posts, postInitiatedAt, inFlightPosts, expectedBefore: postsAtStart + 3, stage: 'after initial 3 submissions' })
  // 三个节点都不轮询了，查询还在长：是观察者接手了。
  const getsWhenRendererStopped = gets()
  await expect.poll(gets, { timeout: stationTimeout({ operations: 4 }) }).toBeGreaterThan(getsWhenRendererStopped)

  const resendDialog = page.getByRole('dialog').filter({ has: page.locator('[data-spend-confirm-action="confirm"]') })
  await focus(a)
  await button(a, labels.markFailed).click()
  await expect(button(a, labels.retry)).toBeVisible({ timeout: stationTimeout() })
  await button(a, labels.retry).click()
  await expect(resendDialog).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await expectVisibleText(resendDialog, labels.stillRunningTitle, { message: 'resend dialog title is visible for a' })
  await expectVisibleText(resendDialog, labels.stillRunning, { message: 'resend dialog still-running notice is visible for a' })
  await expectVisibleText(resendDialog, labels.mightChargeAgain, { message: 'resend dialog double-charge warning is visible for a' })
  const proof = await proveProbe(resendDialog, 'the resend dialog warns this task is still running')
  await expectAbsent(page.getByText('node_generation_in_flight'), { provenBy: proof, message: 'the raw error code never reaches the UI' })
  assertNoPostBeforeConfirm({ posts, postInitiatedAt, inFlightPosts, expectedBefore: postsAtStart + 3, stage: 'before canceling resend for a' })
  await settledShot(`${scenario}-1-still-running`, resendDialog)
  await resendDialog.locator('[data-spend-confirm-action="cancel"]').click()
  await expect(resendDialog).toHaveCount(0, { timeout: stationTimeout() })
  assertNoPostBeforeConfirm({ posts, postInitiatedAt, inFlightPosts, expectedBefore: postsAtStart + 3, stage: 'after canceling resend for a' })

  // c：人在确认卡上明确选再发才发第二单；第一单仍由主进程观察者盯到收尾，产物不丢。
  await focus(c)
  await button(c, labels.markFailed).click()
  await expect(button(c, labels.retry)).toBeVisible({ timeout: stationTimeout() })
  await settledShot(`${scenario}-4-finished-marked-failed`, card(c))
  await button(c, labels.retry).click()
  await expect(resendDialog).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await expectVisibleText(resendDialog, labels.stillRunningTitle, { message: 'resend dialog title is visible for c' })
  await expectVisibleText(resendDialog, labels.stillRunning, { message: 'resend dialog still-running notice is visible for c' })
  await expectVisibleText(resendDialog, labels.mightChargeAgain, { message: 'resend dialog double-charge warning is visible for c' })
  assertNoPostBeforeConfirm({ posts, postInitiatedAt, inFlightPosts, expectedBefore: postsAtStart + 3, stage: 'before confirming resend for c' })
  const confirmClickedAt = now()
  await resendDialog.locator('[data-spend-confirm-action="confirm"]').click()
  await expect.poll(posts, { timeout: stationTimeout({ operations: 2 }) }).toBe(postsAtStart + 4)
  assertPostInitiatedAfterConfirm({
    posts,
    postInitiatedAt,
    inFlightPosts,
    expectedCount: postsAtStart + 4,
    confirmClickedAt,
    stage: 'after confirming resend for c',
  })
  await expect.poll(async () => (await nodeFact(page, c.id)).runRecordId, { timeout: stationTimeout({ operations: 2 }) }).not.toBe(c.runRecordId)
  const secondRunRecordId = (await nodeFact(page, c.id)).runRecordId
  expect(secondRunRecordId).toBeTruthy()

  finishJobs()
  for (const node of [a, b, c]) await expect.poll(() => runOf(projectRoot, node.runRecordId)?.status, { timeout: stationTimeout({ operations: 8 }) }).toBe('completed')
  await expect.poll(() => runOf(projectRoot, secondRunRecordId)?.status, { timeout: stationTimeout({ operations: 8 }) }).toBe('completed')
  for (const node of [a, b, c]) await expect.poll(() => status(node), { timeout: stationTimeout({ operations: 8 }) }).toBe('success')
  expect(posts()).toBe(postsAtStart + 4)

  // b：观察者收完后经 canvas.run-settled 自动落回镜头，仍是 1 版，没有第二单。
  await focus(b)
  expect((await nodeFact(page, b.id)).versions).toBe(1)
  await settledShot(`${scenario}-3-landed`, card(b))

  // c：确认再发后的第二单与观察者盯完的第一单都按各自 runNumber 落回 c（共 2 版），项目素材抽屉里按各自产物身份核对两张都可见。
  await expect.poll(async () => (await nodeFact(page, c.id)).versions, { timeout: stationTimeout({ operations: 4 }) }).toBe(2)
  const firstArtifact = runOf(projectRoot, c.runRecordId).artifacts.find(item => item.status === 'ready')
  const secondArtifact = runOf(projectRoot, secondRunRecordId).artifacts.find(item => item.status === 'ready')
  expect(firstArtifact?.projectRelativePath).toBeTruthy()
  expect(secondArtifact?.projectRelativePath).toBeTruthy()
  expect(firstArtifact.projectRelativePath).not.toBe(secondArtifact.projectRelativePath)
  const assets = await openRailDrawer(page, 'assets', 'open the assets drawer after confirmed resend')
  await page.locator('[role="tab"]', { hasText: labels.projectAssets }).first().click()
  for (const runArtifact of [firstArtifact, secondArtifact]) {
    expect(fs.existsSync(path.join(projectRoot, runArtifact.projectRelativePath))).toBe(true)
    const fileName = path.basename(runArtifact.projectRelativePath)
    const assetCard = assets.locator('[role="button"][aria-label="Retrieve c"]').filter({ has: page.locator(`img[src*="${fileName}"]`) })
    await expect(assetCard, `asset card for ${fileName} is visible in drawer`).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  }
  await expect(assets.locator('[role="button"][aria-label="Retrieve c"]')).toHaveCount(2, { timeout: stationTimeout({ operations: 2 }) })
  await settledShot(`${scenario}-5-in-assets`, assets)
  await closeRailDrawer(page, 'assets', 'close the assets drawer')
  report.posts = posts() - postsAtStart
  return { report, page }
}

/** 这单不要了：点「标记失败」，错误卡才给重试。这是用户知情的新下单。 */
export async function giveUpJourney(ctx) {
  const { locale, page, modelOff, modelOn, finishJobs, posts, shot, scenario } = ctx
  const labels = labelsFor(locale)
  const { id, postsBefore } = await submitShot(ctx)
  await modelOff(page)
  const card = page.locator(`.react-flow__node[data-id="${id}"]`)
  await expect(card.getByText(labels.unavailable, { exact: true })).toBeVisible({ timeout: stationTimeout({ operations: 8 }) })
  expect(posts()).toBe(postsBefore + 1)
  await card.getByRole('button', { name: labels.markFailed, exact: true }).click()
  const retry = card.getByRole('button', { name: labels.retry, exact: true })
  await expect(retry).toBeVisible({ timeout: stationTimeout() })
  await page.mouse.move(2, 2)
  await waitForVisualQuiescence(page)
  await shot(`${scenario}-1-marked-failed`, card)
  expect(posts()).toBe(postsBefore + 1)
  await modelOn(page)
  await retry.click()
  await expect.poll(posts, { timeout: stationTimeout({ operations: 2 }) }).toBe(postsBefore + 2)
  finishJobs()
  await expect.poll(async () => (await nodeFact(page, id)).status, { timeout: stationTimeout({ operations: 8 }) }).toBe('success')
  return { report: { scenario, posts: posts() - postsBefore }, page }
}
