import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { expect, expectVisible, expectAbsent, proveProbe } from './_assert.mjs'
import { assertLabPortOwnership, labOriginFor } from './design-lab/labServer.mjs'
import { readLabStates } from './design-lab/labStates.mjs'

async function advance(page, stage) {
  await page.evaluate(async (next) => {
    const { advanceProcessFeedback } = await import('/src/devlab/designLab/processFeedback/processFeedbackLabKit.tsx')
    advanceProcessFeedback(next)
  }, stage)
}

const evidence = path.resolve('docs/plan/process-feedback-evidence/neighbor-placement/lab')
await fs.mkdir(evidence, { recursive: true })
assertLabPortOwnership('visual')
const origin = labOriginFor('visual')
const browser = await chromium.launch()
const receipt = []
const fixedTime = new Date('2026-09-08T12:00:00Z')
const messageSelectors = ['[data-node-id] [data-generation-message]', '[data-process-task] [data-generation-message]', '[data-process-timeline] [data-generation-message]']
async function open(state, reduced = false) {
  const context = await browser.newContext({ viewport: { width: 900, height: 650 }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  page.on('pageerror', (error) => receipt.push({ pageError: String(error), state }))
  await page.clock.install({ time: fixedTime })
  await page.goto(`${origin}/design-lab.html?screen=process-feedback&frame=1&state=${state}`)
  await expectVisible(page.locator('[data-process-lab-ready]'), '真实宿主三处已挂载')
  await page.clock.runFor(1000)
  return { context, page }
}
async function freezeAnimations(page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getTiming().iterations === Infinity) { animation.pause(); animation.currentTime = 1200 }
    }
  })
}
async function texts(page) { return Promise.all(messageSelectors.map((selector) => page.locator(selector).innerText())) }
async function noInventedNumbers(page) {
  for (const text of await texts(page)) { expect(text).not.toContain('%'); expect(text).not.toMatch(/前面\s*\d+\s*个/) }
  expect(await page.locator('[data-generation-status]').innerText()).not.toContain('%')
}
async function mutation(name, check) {
  let rejected = false
  try { await check() } catch (error) { rejected = true; receipt.push({ mutation: name, result: 'red', reason: String(error).slice(0, 600) }) }
  expect(rejected, `${name} 必须抓到变异`).toBe(true)
}
async function geometry(page) {
  return page.evaluate(() => ['[data-node-id]', '[data-process-timeline] > div'].map((selector) => {
    const box = document.querySelector(selector).getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }))
}
async function reducedMotion(page) {
  const motion = await page.evaluate(() => {
    const dot = document.querySelector('[data-process-dot]')
    const sheen = document.querySelector('[data-process-static-grid], [data-process-audio-waiting]')
    return { opacity: getComputedStyle(dot).opacity, transform: getComputedStyle(sheen).transform,
      active: [...dot.getAnimations(), ...sheen.getAnimations()].filter((item) => item.playState === 'running').length }
  })
  expect(motion).toEqual({ opacity: '1', transform: 'none', active: 0 })
}
async function readable(page) {
  const size = await page.locator('[data-node-id] [data-generation-message]').evaluate((element) => {
    let scale = 1
    for (let parent = element; parent; parent = parent.parentElement) {
      const matrix = new DOMMatrix(getComputedStyle(parent).transform)
      scale *= Math.hypot(matrix.a, matrix.b)
    }
    return parseFloat(getComputedStyle(element).fontSize) * scale
  })
  expect(size).toBeGreaterThanOrEqual(12)
}
try {
  // Actual production markup across all three media, five phases and factual special states.
  for (const state of readLabStates('process-feedback').filter(state => !state.id.startsWith('pf-fx-'))) {
    const { context, page } = await open(state.id)
    if (!state.id.includes('failed')) {
      await expectVisible(page.locator('[data-node-id] [data-generation-status]'), '状态条在真实节点上可见')
    } else {
      await expectVisible(page.locator('[data-node-id] [role=alert]').getByRole('button', { name: '检查模型', exact: true }), '失败态有真实下一步')
    }
    if (!state.id.includes('preview')) await noInventedNumbers(page)
    else await expectVisible(page.locator('[data-process-preview-scrim]'), '真预览有明确遮罩与标签')
    await freezeAnimations(page)
    await page.locator('[data-process-lab-ready]').screenshot({ path: path.join(evidence, `${state.id}.png`) })
    receipt.push({ state: state.id, result: 'green', messages: await texts(page) })
    await context.close()
  }
  {
    const { context, page } = await open('pf-image-queued')
    await page.locator('[data-generation-status]').evaluate((element) => element.append(' 0%'))
    await mutation('no-fake-percent', () => noInventedNumbers(page))
    await page.locator('[data-generation-status]').evaluate((element) => element.lastChild.remove())
    await page.locator(messageSelectors[0]).evaluate((element) => element.textContent += ' · 前面 2 个')
    await mutation('no-fake-position', () => noInventedNumbers(page))
    await page.locator(messageSelectors[0]).evaluate((element) => element.textContent = '排队中')
    await noInventedNumbers(page)
    const initial = await geometry(page)
    await page.locator('[data-node-id]').evaluate((element) => element.style.height = `${element.getBoundingClientRect().height + 1}px`)
    await mutation('stable-geometry', async () => expect(await geometry(page)).toEqual(initial))
    await page.locator('[data-node-id]').evaluate((element) => element.style.height = '240px')
    const generationStatusProof = await proveProbe(page.locator('[data-node-id] [data-generation-status]'), '生成前状态条存在')
    for (const stage of ['queued', 'requesting', 'generating', 'finalizing']) {
      await advance(page, stage)
      await page.clock.runFor(200)
      const expectedPhase = { queued: '排队中', requesting: '提交中', generating: '生成中', finalizing: '正在存到你电脑上'}[stage]
      await expect(page.locator(messageSelectors[0])).toContainText(expectedPhase)
      expect(await geometry(page)).toEqual(initial)
      await page.locator('[data-process-lab-ready]').screenshot({ path: path.join(evidence, `journey-${stage}.png`) })
    }
    await expectAbsent(page.locator('[data-node-id] [data-generation-status]'), { provenBy: generationStatusProof })
    receipt.push({ criterion: 4, result: 'green', geometry: initial })
    await context.close()
  }
  {
    const { context, page } = await open('pf-audio-generating', true)
    await reducedMotion(page)
    await page.locator('[data-process-dot]').evaluate((element) => { element.style.opacity = '.5' })
    await mutation('reduced-motion', () => reducedMotion(page))
    await page.locator('[data-process-dot]').evaluate((element) => { element.style.opacity = '1' })
    await reducedMotion(page)
    await page.locator('[data-process-lab-ready]').screenshot({ path: path.join(evidence, 'reduced-motion.png') })
    await page.goto(`${origin}/design-lab.html?screen=process-feedback&frame=1&state=pf-image-generating`)
    await expectVisible(page.locator('[data-process-lab-ready]'), '减弱动态完成旅程')
    const generationStatusProof = await proveProbe(page.locator('[data-node-id] [data-generation-status]'), '减弱动态生成态状态条存在')
    await advance(page, 'saved')
    await expectAbsent(page.locator('[data-node-id] [data-generation-status]'), { provenBy: generationStatusProof })
    receipt.push({ criterion: 5, result: 'green' })
    await context.close()
  }
  {
    const { context, page } = await open('pf-zoom-60')
    await readable(page)
    await page.locator('[data-node-id] [data-generation-status]').evaluate((element) => element.parentElement.style.transform = 'scale(1)')
    await mutation('zoom-60-readable', () => readable(page))
    await page.locator('[data-node-id] [data-generation-status]').evaluate((element) => element.parentElement.style.transform = 'scale(1.6666666666666667)')
    await readable(page)
    await freezeAnimations(page)
    await page.locator('[data-process-lab-ready]').screenshot({ path: path.join(evidence, 'zoom-60.png') })
    receipt.push({ criterion: 6, result: 'green' })
    await context.close()
  }
  expect(receipt.filter((item) => item.pageError)).toEqual([])
} finally {
  await fs.writeFile(path.join(evidence, 'acceptance.json'), JSON.stringify(receipt, null, 2) + '\n')
  await browser.close()
}
console.log('Process feedback: component matrix and browser mutation controls (real three-surface acceptance lives in process-feedback-electron.e2e.mjs) passed.')
