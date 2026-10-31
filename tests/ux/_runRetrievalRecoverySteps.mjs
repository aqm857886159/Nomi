// 「钱花了、任务号还在的单子只取回」零费用走查和真付费走查共用的一段步骤：
// 提交 → 关掉 App → 取回出故障 → 重开（观察者接手，第一次查询失败）→ 点重新取回又失败 → 老项目的错误卡 → 故障好了 → 重新取回落地。
// 全程只下过一单。差别只在 ctx 给的几个零件：怎么造故障、怎么数请求。
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { readProductionRuns } from './_paidRun.mjs'

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

export async function recoveryJourney(ctx) {
  const { locale, open, close, faultOn, faultOff, posts, gets, shot, projectRoot, node: spec } = ctx
  const labels = LABELS[locale]
  const report = {}
  let page = await open()

  const id = await page.evaluate(spec => {
    const store = window.__nomiCanvasStore.getState()
    const node = store.addNode({ kind: spec.kind, categoryId: 'shots', title: 'Retrieve me', prompt: spec.prompt, position: { x: 40, y: 40 }, exactPosition: true,
      size: { width: 480, height: 320 }, meta: { modelVendor: spec.vendor, modelKey: spec.modelKey, previewHeight: 320 } })
    store.selectNode(node.id)
    return node.id
  }, spec)
  await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').first().click()
  await expect.poll(async () => (await nodeFact(page, id)).taskId, { timeout: 60_000 }).toBeTruthy()
  await expect.poll(posts, { timeout: 30_000 }).toBe(1)
  const { runRecordId } = await nodeFact(page, id)
  await page.evaluate(() => window.__nomiCanvasStore.getState().clearSelection())

  // 关掉 App，取回出故障，重开：观察者接手，第一次查询就失败。这一笔只差取回，不是死了。
  await page.waitForTimeout(1_500)
  await close()
  await faultOn()
  page = await open()
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: 90_000 }).toBe('needs_attention')
  expect(runOf(projectRoot, runRecordId).jobs.at(-1).errorCode).toBe('output_retrieval_failed')
  const card = page.locator(`.react-flow__node[data-id="${id}"]`)
  const retrieve = card.getByRole('button', { name: labels.retrieve, exact: true })
  await expect(retrieve).toBeVisible({ timeout: 30_000 })
  await shot('1-panel-after-reopen', card)

  // 故障还在时点一下：真去查了，没成，回到可找回，不下新单。
  const getsAtFirstClick = gets?.()
  await retrieve.click()
  if (gets) await expect.poll(gets, { timeout: 30_000 }).toBeGreaterThan(getsAtFirstClick)
  await expect(retrieve).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: 30_000 }).toBe('needs_attention')
  expect(posts()).toBe(1)
  if (gets) report.getsWhileBroken = gets() - getsAtFirstClick

  // 老项目里已经存着的错误卡：主按钮是去重新取回，不是重试。
  await page.evaluate(({ id, sentence }) => window.__nomiCanvasStore.getState().setNodeStatus(id, 'error', sentence), { id, sentence: OLD_STORED_SENTENCE })
  const goRetrieve = card.getByRole('button', { name: labels.goRetrieve, exact: true })
  const proof = await proveProbe(goRetrieve, 'error card main button is observable')
  await expectAbsent(card.getByRole('button', { name: labels.retry, exact: true }), { provenBy: proof, message: 'an error card for a paid task never offers Retry as its button' })
  await shot('2-error-card', card)
  await goRetrieve.click()
  await expect(retrieve).toBeVisible({ timeout: 10_000 })

  // 故障好了：再点一次，真查、落地，还是只下过一单。
  page = (await faultOff()) ?? page
  const landingCard = page.locator(`.react-flow__node[data-id="${id}"]`)
  const landingRetrieve = landingCard.getByRole('button', { name: labels.retrieve, exact: true })
  await expect(landingRetrieve).toBeVisible({ timeout: 30_000 })
  const getsAtLastClick = gets?.()
  await landingRetrieve.click()
  await expect.poll(async () => (await nodeFact(page, id)).status, { timeout: 120_000 }).toBe('success')
  if (gets) expect(gets()).toBeGreaterThan(getsAtLastClick)
  expect(posts()).toBe(1)
  await expect.poll(() => runOf(projectRoot, runRecordId)?.jobs.at(-1)?.status, { timeout: 30_000 }).toBe('ready')
  await expect.poll(() => runOf(projectRoot, runRecordId)?.status, { timeout: 30_000 }).toBe('completed')
  await shot('3-landed', landingCard)
  report.posts = posts()
  if (gets) report.gets = gets()
  return report
}
