// Real Electron + native lane + loopback SSE: reasoning is never status metadata.
import assert from 'node:assert/strict'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { FIXTURE_TEXT_MODEL_LABEL } from './agent-runtime-fixture.mjs'
import { CANVAS_PANEL, THINKING_LINE, TOOL_RECEIPT, ASSISTANT_MESSAGE, V4_FLOW,
  chooseAssistantModel, createRuntimeWalk, hasToolResult, openCanvas, recorded, sendCanvas,
  waitForV4TurnIdle } from './agent-runtime-walk-support.mjs'

// Measure painted text as well as row boxes: a fixed-height row can have disjoint boxes
// while its overflowing text paints over every neighbouring message (the original bug).
export async function flowOverlaps(flow) {
  return flow.evaluate((root) => {
    const rows = [...root.children]
    const visible = (node) => node.checkVisibility({ checkVisibilityCSS: true })
    const boxes = rows.map((row) => {
      const rects = [row.getBoundingClientRect()]
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent.trim() || !visible(text.parentElement)) continue
        const range = document.createRange()
        range.selectNodeContents(text)
        rects.push(...range.getClientRects())
      }
      return rects.filter((r) => r.width > 0 && r.height > 0)
    })
    const collisions = []
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].some((a) => boxes[j].some((b) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5))) {
        collisions.push([i, j])
      }
    }
    return collisions
  })
}

const reasoning = 'I should inspect the canvas, verify the existing nodes, and only then explain the result. '.repeat(12)
const reply = '已读取画布和时间轴，检查已经完成。\n\n画布目前没有镜头节点，可以先从文稿中整理分镜，再继续制作。'
const walk = await createRuntimeWalk('thinking-overlap')
let failure
try {
  let { win } = await walk.start({ first: true })
  await walk.resizeWindow(1440, 900)
  walk.report.viewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.equal(walk.report.viewport.width, 1440)
  const project = await walk.newProject()
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await openCanvas(win)
  const panel = win.locator(CANVAS_PANEL)
  const flow = panel.locator(V4_FLOW)
  const thinking = walk.fixture.expectText({ label: 'long reasoning held before canvas read',
    match: () => true, reply: { type: 'hold', reasoning } })
  const second = walk.fixture.expectText({ label: 'second read after actual canvas result',
    match: (body) => hasToolResult(body, 'overlap-read'),
    reply: { type: 'tool', id: 'overlap-project', name: 'read_timeline', args: {}, reasoning } })
  const final = walk.fixture.expectText({ label: 'body held after both receipts',
    match: (body) => hasToolResult(body, 'overlap-project'), reply: { type: 'hold', text: reply } })
  await sendCanvas(win, '检查当前画布和时间轴，再告诉我下一步怎么做。')
  await recorded(thinking.received, 'actual thinking request')
  await expect(panel.locator(THINKING_LINE)).toContainText('正在想')
  await expect.poll(() => panel.locator(THINKING_LINE).textContent()).toContain(reasoning.slice(0, 80))
  await expect(panel.locator(THINKING_LINE)).toHaveCount(1)
  await expect(panel.locator(THINKING_LINE).locator('summary')).toContainText(/[1-9]\d*s/)
  const streamingProof = await proveProbe(panel.locator(`${THINKING_LINE}[data-streaming="true"]`), 'real reasoning stream is visible')
  const early = await flowOverlaps(flow)
  await walk.snap('reasoning-before-tools')
  thinking.release({ type: 'tool', id: 'overlap-read', name: 'look_at_canvas', args: {} })
  await recorded(second.received, 'second actual read')
  await recorded(final.received, 'actual body stream')
  await expect(panel.locator(TOOL_RECEIPT)).toHaveCount(2)
  await expect(panel.locator(ASSISTANT_MESSAGE)).toContainText('检查已经完成')
  const streaming = await flowOverlaps(flow)
  await flow.evaluate((node) => { node.scrollTop = 0 })
  await walk.snap('generating')
  final.release({ type: 'text', text: '\n检查结束。' })
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).last() })
  await expectAbsent(panel.locator(`${THINKING_LINE}[data-streaming="true"]`), { provenBy: streamingProof, message: 'settled reasoning cannot still report thinking' })
  const complete = await flowOverlaps(flow)
  await flow.evaluate((node) => { node.scrollTop = 0 })
  await walk.snap('complete')
  walk.report.overlaps = { early, streaming, complete }
  assert.deepEqual({ early, streaming, complete }, { early: [], streaming: [], complete: [] }, 'message layers must not overlap')
  // Prove the same detector rejects an injected row collision, then restore exactly.
  const user = flow.locator(':scope > *').first()
  const originalStyle = await user.getAttribute('style')
  await user.evaluate((node) => { node.style.transform = 'translateY(40px)' })
  walk.report.injectedOverlap = await flowOverlaps(flow)
  assert.ok(walk.report.injectedOverlap.length > 0, 'injected overlap must fail the detector')
  await user.evaluate((node, style) => style === null ? node.removeAttribute('style') : node.setAttribute('style', style), originalStyle)
  await expect(panel.locator(`${THINKING_LINE} details`)).toHaveCount(2)
  for (const detail of await panel.locator(`${THINKING_LINE} details`).all()) {
    await expect(detail).not.toHaveAttribute('open', '')
    await detail.locator('summary').click()
    await expect(detail.locator('[data-v4-thinking-body]')).toBeVisible()
    assert.deepEqual(await flowOverlaps(flow), [], 'expanded reasoning must grow its row')
    await detail.locator('summary').click()
    await expect(detail.locator('[data-v4-thinking-body]')).toBeHidden()
    assert.deepEqual(await flowOverlaps(flow), [], 'collapsed reasoning must not paint outside its row')
  }
  const results = readLaneTranscripts(walk.report.projectRoot).flatMap(laneMessages).filter((m) => m.role === 'toolResult')
  assert.equal(results.length, 2)
  assert.ok(results.every((result) => result.isError === false), 'both read tools must actually succeed')
  // Restore the same isolated native JSONL through a second actual Electron process.
  await walk.stopApp()
  ;({ win } = await walk.start())
  await walk.resizeWindow(1440, 900)
  const card = win.locator('[data-project-card="true"]').filter({ hasText: project.name }).first()
  await expect(card).toBeVisible()
  await card.hover()
  await card.getByRole('button', { name: /继续创作/ }).click()
  const restored = win.locator(CANVAS_PANEL)
  await expect(restored.locator(`${THINKING_LINE} details`)).toHaveCount(2)
  await expect(restored.locator(ASSISTANT_MESSAGE)).toContainText('检查结束')
  walk.report.restoredOverlaps = await flowOverlaps(restored.locator(V4_FLOW))
  assert.deepEqual(walk.report.restoredOverlaps, [])
  for (const body of await restored.locator('[data-v4-thinking-body]').all()) await expect(body).toBeHidden()
  await walk.snap('cold-restored')
  walk.fixture.assertClean()
} catch (error) { failure = error; process.exitCode = 1 }
finally { await walk.finish(failure) }
