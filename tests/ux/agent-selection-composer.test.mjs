import { expect, test } from 'vitest'
import { chromium } from 'playwright'
import { useBrowserFixture } from './_browserFixture.mjs'

const entry = 'tests/ux/fixtures/agent-selection-composer.html'
// 原 PR 还没有新组合点；只在修前重放时改接旧 Data 的现役 liveChips，原 Composer/Actions/store 保持原样。
const plugins = process.env.NOMI_SELECTION_ORIGINAL === '1' ? [{ name: 'original-selection-composition', enforce: 'pre', transform(code, id) {
  if (!id.endsWith('/fixtures/agent-selection-composer.tsx')) return
  return code.replace("import { useResidentComposerContext } from '../../../src/workbench/ai/resident/ResidentComposerContext'",
    "import { useAgentPanelV4Data } from '../../../src/workbench/ai/v4/useAgentPanelV4Data'; const useResidentComposerContext = () => useAgentPanelV4Data('preview').liveChips")
} }] : []
const fixture = useBrowserFixture({ entries: [entry], browserType: chromium, plugins, ready: '[data-selection-ready]' })
const readChips = page => page.locator('[data-v4-chip="clip"]').evaluateAll(elements => elements.map(el => ({
  id: el.getAttribute('data-v4-chip-id'), title: el.querySelector(':scope > span:last-of-type')?.textContent,
})))
const lastMembers = page => page.evaluate(() => {
  const input = [...window.__selectionFixture.commands].reverse().find(command => command.kind === 'prompt')
  return input?.context?.contextSnapshot?.handles.filter(handle => handle.kind === 'timelineClip')
    .map(handle => ({ id: handle.targetId, title: handle.display.title }))
})
async function send(page) {
  const count = await page.evaluate(() => window.__selectionFixture.commands.filter(command => command.kind === 'prompt').length)
  await page.locator('[data-v4-control="input"]').fill('Shorten this')
  await page.locator('[data-v4-control="send"]').click()
  await expect.poll(() => page.evaluate(() => window.__selectionFixture.commands.filter(command => command.kind === 'prompt').length)).toBe(count + 1)
  return lastMembers(page)
}
// 目标量具：真实 DOM + 真 store + 生产 Actions/laneClient + 假传输。文稿等非 timelineClip 句柄不参与比较。
for (const kind of ['videos', 'same-name', 'caption']) test(`display equals the final new input before and after ×: ${kind}`, async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(entry))
    await page.evaluate(kind => window.__selectionFixture.seed(kind, true), kind)
    await expect.poll(() => readChips(page)).toHaveLength(kind === 'caption' ? 1 : 2)
    const before = await readChips(page)
    const original = kind === 'caption' ? [{ id: 'caption', title: 'Original caption' }]
      : ['b', 'a'].map(id => ({ id, title: kind === 'same-name' ? 'Same name' : `Original ${id}` }))
    expect(await page.evaluate(() => window.__selectionFixture.canary)).toBe(true)
    const sentBefore = await send(page)
    expect(await page.locator('[data-v4-chip="clip"]').first().getByRole('button').count()).toBe(1)
    await page.locator('[data-v4-chip="clip"]').first().getByRole('button').click()
    const expected = original.slice(1)
    await expect.poll(() => readChips(page)).toEqual(expected)
    expect(before).toEqual(original)
    expect(sentBefore).toEqual(original)
    expect(await send(page)).toEqual(expected)
    const state = await page.evaluate(() => window.__selectionFixture.state())
    expect(state.media).toEqual(expected.map(item => item.id))
    expect(state.text).toBe('')
    expect(state.timeline.tracks.flatMap(track => track.clips).map(clip => clip.id)).toEqual(['a', 'b'])
    expect(state.timeline.textClips).toHaveLength(1)
  } finally { await page.close() }
})
for (const change of ['switchSession', 'switchProject']) test(`stale × cannot change the next owner: ${change}`, async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(entry))
    await page.locator('[data-v4-chip="clip"]').first().waitFor()
    await page.evaluate(() => window.__selectionFixture.save())
    await page.evaluate(change => window.__selectionFixture[change](), change)
    await page.evaluate(() => window.__selectionFixture.removeSaved(0))
    expect((await page.evaluate(() => window.__selectionFixture.state())).media).toEqual(['b', 'a'])
  } finally { await page.close() }
})

for (const kind of ['file', 'skill', 'prompt']) test(`keeps the original owner removal for ${kind}`, async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(entry))
    await page.evaluate(kind => window.__selectionFixture.seedReference(kind), kind)
    const chips = page.locator('[data-v4-chip]')
    await expect.poll(() => chips.count()).toBe(kind === 'file' ? 2 : 1)
    const before = await chips.evaluateAll(elements => elements.map(el => el.getAttribute('data-v4-chip-id')))
    await chips.first().getByRole('button').click()
    await expect.poll(() => chips.evaluateAll(elements => elements.map(el => el.getAttribute('data-v4-chip-id')))).toEqual(before.slice(1))
  } finally { await page.close() }
})

for (const kind of ['videos', 'caption', 'file', 'skill', 'prompt']) test(`local removal works without a lane connection: ${kind}`, async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(entry))
    await page.evaluate(kind => {
      if (['videos', 'caption'].includes(kind)) window.__selectionFixture.seed(kind)
      else window.__selectionFixture.seedReference(kind)
      window.__selectionFixture.disconnect()
    }, kind)
    await page.locator('[data-selection-owner="disconnected"]').waitFor()
    const chips = page.locator('[data-v4-chip]')
    await expect.poll(() => chips.count()).toBe(['videos', 'file'].includes(kind) ? 2 : 1)
    const ids = await chips.evaluateAll(elements => elements.map(el => el.getAttribute('data-v4-chip-id')))
    await chips.first().getByRole('button').click()
    await expect.poll(() => chips.evaluateAll(elements => elements.map(el => el.getAttribute('data-v4-chip-id')))).toEqual(ids.slice(1))
  } finally { await page.close() }
})

test('an unmounted composer cannot cancel a new local selection while disconnected', async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(entry))
    await page.evaluate(() => window.__selectionFixture.disconnect())
    await page.locator('[data-selection-owner="disconnected"]').waitFor()
    await page.evaluate(() => { window.__selectionFixture.save(); window.__selectionFixture.unmount(); window.__selectionFixture.seed('videos'); window.__selectionFixture.removeSaved(0) })
    expect((await page.evaluate(() => window.__selectionFixture.state())).media).toEqual(['b', 'a'])
  } finally { await page.close() }
})
