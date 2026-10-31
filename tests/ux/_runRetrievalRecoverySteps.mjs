// 「钱花了、任务号还在的单子只取回」零费用走查和真付费走查共用的一段步骤：
// 提交 → 中断（关窗或重启）+ 取回出故障 → 重开，观察者第一次查询失败 → 点重新取回又失败 → 老项目的错误卡 → 故障好了 → 重新取回落地。
// 全程只下过一单。差别只在 ctx 给的几个零件：怎么中断、怎么造故障、怎么数请求。
// 另外三段只给零费用演练：本机查不了（模型被关）时卡上写真实原因；这单不要了就标记失败，这时才给重试；
// 窗口一直开着、单还在跑时渲染层放手给观察者（windowOpenJourney）。
import fs from 'node:fs'
import path from 'node:path'
import { expect, expectAbsent, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { readProductionRuns } from './_paidRun.mjs'
import { canvasFitView, closeRailDrawer, openRailDrawer } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

/** 修复后才会原样进产物的字面量（electron/productionRun/singleShotRunLifecycle.ts、electron/shared/nomiErrorCodes.ts）。 */
export const RECOVERY_BUILD_MARKERS = ['Nomi could not check this accepted task this time', 'Nomi cannot ask the provider about this accepted task right now']
const OLD_STORED_SENTENCE = '生成结果未能安全落入项目，请查看任务并处理'
/** 界面上的说法都从词典取，不在走查里另抄一份。 */
function labelsFor(locale) {
  const text = key => uiText(locale, key)
  return {
    retrieve: text('generationCommon.production.runAction.retry-retrieval'),
    goRetrieve: text('generationCommon.observability.action.openRecoverable.main'),
    retry: text('generationCommon.observability.action.retry.main'),
    markFailed: text('generationCommon.recoverable.dismiss'),
    timedOut: text('generationCommon.recoverable.title'),
    unavailable: text('generationCommon.recoverable.unavailableTitle'),
    stillRunning: text('generationCommon.observability.error.nodeInFlight.hint'),
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
async function submitShot({ page, posts, projectRoot, node: spec, position }) {
  const postsBefore = posts()
  const id = await page.evaluate(({ spec, position }) => {
    const store = window.__nomiCanvasStore.getState()
    const node = store.addNode({ kind: spec.kind, categoryId: 'shots', title: 'Retrieve me', prompt: spec.prompt, position, exactPosition: true,
      size: { width: 480, height: 320 }, meta: { modelVendor: spec.vendor, modelKey: spec.modelKey, previewHeight: 320 } })
    store.selectNode(node.id)
    return node.id
  }, { spec, position })
  // 窗口重开时画布已经缩放适配了上一个节点，新节点可能在屏幕外、根本没渲染：像人一样先看全。
  await canvasFitView(page)
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
    await expect(card()).toContainText(labels.timedOut)
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
 * - a：标记失败再重试被挡，卡上说这一单还在跑，不露错误码。跑完才放行，这时算第二单。
 * - b：单跑完了，结果先落进项目，节点还是可找回；点一下重新取回即现，这一下没有 GET、没有 POST。
 * - c：单跑完了，没点重新取回而是标记失败：产物还在素材里；重试算第二单。
 */
export async function windowOpenJourney(ctx) {
  const { locale, page, imageNode, finishJobs, posts, gets, shot, projectRoot, scenario } = ctx
  const labels = labelsFor(locale)
  const report = { scenario }
  const postsAtStart = posts()
  const submit = position => submitShot({ ...ctx, node: imageNode, position })
  const a = await submit({ x: 40, y: 40 })
  const b = await submit({ x: 620, y: 40 })
  const c = await submit({ x: 1200, y: 40 })
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
  expect(posts()).toBe(postsAtStart + 3)
  // 三个节点都不轮询了，查询还在长：是观察者接手了。
  const getsWhenRendererStopped = gets()
  await expect.poll(gets, { timeout: stationTimeout({ operations: 4 }) }).toBeGreaterThan(getsWhenRendererStopped)

  await focus(a)
  await button(a, labels.markFailed).click()
  await expect(button(a, labels.retry)).toBeVisible({ timeout: stationTimeout() })
  await button(a, labels.retry).click()
  const stillRunning = card(a).getByText(labels.stillRunning)
  await expect(stillRunning).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  const proof = await proveProbe(stillRunning, 'the card says this task is still running')
  await expectAbsent(card(a).getByText('node_generation_in_flight'), { provenBy: proof, message: 'the raw error code never reaches the card' })
  expect(posts()).toBe(postsAtStart + 3)
  await settledShot(`${scenario}-1-still-running`, card(a))

  finishJobs()
  for (const node of [a, b, c]) await expect.poll(() => runOf(projectRoot, node.runRecordId)?.status, { timeout: stationTimeout({ operations: 8 }) }).toBe('completed')
  expect(posts()).toBe(postsAtStart + 3)

  // b：结果已经在项目里，节点没变；点一下即现，这一下不联网。
  await focus(b)
  await expect(button(b, labels.retrieve)).toBeVisible()
  expect(await status(b)).toBe('recoverable')
  await settledShot(`${scenario}-2-finished-still-recoverable`, card(b))
  const getsAtClick = gets()
  const clickedAt = Date.now()
  await button(b, labels.retrieve).click()
  await expect.poll(() => status(b), { timeout: stationTimeout({ operations: 2 }) }).toBe('success')
  report.clickToLandedMs = Date.now() - clickedAt
  report.getsOnClick = gets() - getsAtClick
  expect(gets()).toBe(getsAtClick)
  expect(posts()).toBe(postsAtStart + 3)
  expect((await nodeFact(page, b.id)).versions).toBe(1)
  await settledShot(`${scenario}-3-landed`, card(b))

  // c：跑完了，用户选了标记失败：产物不丢，素材里找得到。
  await focus(c)
  await button(c, labels.markFailed).click()
  await expect(button(c, labels.retry)).toBeVisible({ timeout: stationTimeout() })
  await settledShot(`${scenario}-4-finished-marked-failed`, card(c))
  const artifact = runOf(projectRoot, c.runRecordId).artifacts.find(item => item.status === 'ready')
  const assets = await openRailDrawer(page, 'assets', 'open the assets drawer after marking failed')
  await page.locator('[role="tab"]', { hasText: labels.projectAssets }).first().click()
  await expect(page.locator(`[role="button"][aria-label="${path.basename(artifact.projectRelativePath)}"]`).first()).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
  await settledShot(`${scenario}-5-in-assets`, assets)
  await closeRailDrawer(page, 'assets', 'close the assets drawer')

  // 重试才算第二单，这是用户明确选的。
  const retryLands = async (node) => {
    const before = posts()
    await focus(node)
    await button(node, labels.retry).click()
    await expect.poll(posts, { timeout: stationTimeout({ operations: 2 }) }).toBe(before + 1)
    finishJobs()
    await expect.poll(() => status(node), { timeout: stationTimeout({ operations: 8 }) }).toBe('success')
  }
  await retryLands(c)
  await retryLands(a)
  expect(fs.existsSync(path.join(projectRoot, artifact.projectRelativePath))).toBe(true)
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
