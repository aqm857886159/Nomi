// 「钱花了、任务号还在的单子只取回」零费用走查和真付费走查共用的一段步骤：
// 提交 → 中断（关窗或重启）+ 取回出故障 → 重开，观察者第一次查询失败 → 点重新取回又失败 → 老项目的错误卡 → 故障好了 → 重新取回落地。
// 全程只下过一单。差别只在 ctx 给的几个零件：怎么中断、怎么造故障、怎么数请求。
import fs from 'node:fs'
import path from 'node:path'
import { expect, expectAbsent, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { readProductionRuns } from './_paidRun.mjs'
import { canvasFitView } from './_shell.mjs'

/** 修复后才会原样进产物的字面量（electron/productionRun/singleShotRunLifecycle.ts）。 */
export const RECOVERY_BUILD_MARKER = 'Nomi could not check this accepted task this time'
const OLD_STORED_SENTENCE = '生成结果未能安全落入项目，请查看任务并处理'
const LABELS = {
  'zh-CN': { retrieve: '重新取回', goRetrieve: '去重新取回', retry: '重试' },
  en: { retrieve: 'Retrieve again', goRetrieve: 'Retrieve again', retry: 'Retry' },
}

function nodeFact(page, id) {
  return page.evaluate(id => {
    const node = window.__nomiCanvasStore.getState().nodes.find(item => item.id === id)
    return { status: node?.status, taskId: node?.runs?.[0]?.taskId, runRecordId: node?.runs?.[0]?.id, error: node?.error }
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
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: 90_000 }).toBe('needs_attention')
  expect(runOf(projectRoot, runRecordId).jobs.at(-1).errorCode).toBe('output_retrieval_failed')
}

export async function recoveryJourney(ctx) {
  const { locale, page: firstPage, interrupt, faultOff, posts, gets, shot, projectRoot, node: spec, scenario, position } = ctx
  const labels = LABELS[locale]
  const report = { scenario }
  let page = firstPage
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
  await expect.poll(async () => (await nodeFact(page, id)).taskId, { timeout: 60_000 }).toBeTruthy()
  await expect.poll(posts, { timeout: 30_000 }).toBe(postsBefore + 1)
  const { runRecordId } = await nodeFact(page, id)
  await page.evaluate(() => window.__nomiCanvasStore.getState().clearSelection())
  // 节点带着任务号落盘之后再中断：用户关窗时这一笔已经在项目里。
  await expect.poll(() => storedTaskId(projectRoot, id), { timeout: 30_000 }).toBeTruthy()

  // 中断 + 取回出故障：观察者接手，第一次查询就失败。这一笔只差取回，不是死了。
  page = await interrupt(page, runRecordId)
  await waitStoppedForRetrieval(projectRoot, runRecordId)
  const card = () => page.locator(`.react-flow__node[data-id="${id}"]`)
  const retrieve = () => card().getByRole('button', { name: labels.retrieve, exact: true })
  // 鼠标挪开：刚点完的位置正好压在错误卡主按钮上，截到的是悬停样子。
  const settledShot = async (name) => { await page.mouse.move(2, 2); await waitForVisualQuiescence(page); await shot(name, card()) }
  await expect(retrieve()).toBeVisible({ timeout: 30_000 })
  await settledShot(`${scenario}-1-panel`)

  // 故障还在时点一下：真去查了，没成，回到可找回，不下新单。
  const getsAtFirstClick = gets?.()
  await retrieve().click()
  if (gets) await expect.poll(gets, { timeout: 30_000 }).toBeGreaterThan(getsAtFirstClick)
  await expect(retrieve()).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: 30_000 }).toBe('needs_attention')
  expect(posts()).toBe(postsBefore + 1)
  if (gets) report.getsWhileBroken = gets() - getsAtFirstClick

  // 老项目里已经存着的错误卡：主按钮是去重新取回，不是重试。
  await page.evaluate(({ id, sentence }) => window.__nomiCanvasStore.getState().setNodeStatus(id, 'error', sentence), { id, sentence: OLD_STORED_SENTENCE })
  const goRetrieve = card().getByRole('button', { name: labels.goRetrieve, exact: true })
  const proof = await proveProbe(goRetrieve, 'error card main button is observable')
  await expectAbsent(card().getByRole('button', { name: labels.retry, exact: true }), { provenBy: proof, message: 'an error card for a paid task never offers Retry as its button' })
  await settledShot(`${scenario}-2-error-card`)
  await goRetrieve.click()
  await expect(retrieve()).toBeVisible({ timeout: 10_000 })

  // 故障好了：再点一次，真查、落地，还是只下过一单。
  page = (await faultOff()) ?? page
  await expect(retrieve()).toBeVisible({ timeout: 30_000 })
  const getsAtLastClick = gets?.()
  await retrieve().click()
  await expect.poll(async () => (await nodeFact(page, id)).status, { timeout: 120_000 }).toBe('success')
  if (gets) expect(gets()).toBeGreaterThan(getsAtLastClick)
  expect(posts()).toBe(postsBefore + 1)
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: 30_000 }).toBe('ready')
  await expect.poll(() => runOf(projectRoot, runRecordId)?.status, { timeout: 30_000 }).toBe('completed')
  await settledShot(`${scenario}-3-landed`)
  report.posts = posts() - postsBefore
  if (gets) report.gets = gets()
  return { report, page }
}
