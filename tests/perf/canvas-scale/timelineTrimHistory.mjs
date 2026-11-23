// The sample counts only the two-second trim. Real Undo and Escape verify that
// the measured pointer events actually produced one reversible content edit.
export async function timelineTrimHistory(page, ctx) {
  const preview = page.locator('.workbench-preview')
  const clips = preview.locator('[data-clip-id]')
  const clip = clips.first()
  const clipCount = await clips.count()
  if (clipCount !== ctx.fixture.summary.clips) throw Error(`Expected ${ctx.fixture.summary.clips} clips, found ${clipCount}`)
  const clipId = await clip.getAttribute('data-clip-id')
  const original = ctx.fixture.record.payload.timeline.tracks.flatMap(track => track.clips).find(item => item.id === clipId)
  if (!original) throw Error('Visible clip is missing from the project fixture')
  const zoomIn = preview.getByRole('button', { name: /放大时间轴$/ }).first()
  for (let i = 0; i < 24 && (await clip.boundingBox()).width < 100; i++) await zoomIn.click()
  const handle = clip.locator('.workbench-timeline-clip__handle--right')
  await clip.click()
  await handle.scrollIntoViewIfNeeded()
  // Adjacent clips have a transition button over the middle of their shared edge.
  await handle.hover({ position: { x: 3, y: 3 } })
  const box = await handle.boundingBox()
  const width = (await clip.boundingBox()).width
  const x = box.x + 3
  const y = box.y + 3
  const sourceEnd = () => clip.evaluate((el, fullLength) => Number(el.querySelector('[data-source-end-frame]')?.getAttribute('data-source-end-frame') ?? fullLength), original.frameCount)
  const before = await sourceEnd()
  const startDrag = async () => {
    await page.mouse.move(x, y)
    await page.mouse.down()
  }

  await startDrag()
  await ctx.startWindow(page)
  const started = performance.now()
  let progress = 0
  while (progress < 1) {
    progress = Math.min(1, (performance.now() - started) / 2000)
    await page.mouse.move(x - width * 0.4 * progress, y)
  }
  await page.mouse.up()
  const raw = await ctx.stopWindow(page)
  const trimEndFrame = await sourceEnd()
  if (trimEndFrame >= before) throw Error(`Continuous trim did not shorten the source window (${before} → ${trimEndFrame}, width ${width}, handle ${x},${y}, clip ${await clip.getAttribute('title')})`)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  if (await sourceEnd() !== before) throw Error('One undo did not restore the complete trim')
  await startDrag()
  await page.mouse.move(x - width * 0.3, y, { steps: 8 })
  if (await sourceEnd() >= before) throw Error('Escape control did not start a second trim')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  if (await sourceEnd() !== before) throw Error('Escape did not restore the source window')
  return { raw, trimEndFrame, clipCount, path: 'timeline trim, undo and cancel' }
}
