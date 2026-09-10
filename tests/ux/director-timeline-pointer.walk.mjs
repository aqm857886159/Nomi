// Real timeline component, DOM pointer events and production store; no 3D scene or model downloads.
import fs from 'node:fs'
import { chromium } from 'playwright'
import { expect } from './_assert.mjs'

const fixture = '.tmp/director-full-audit-20260907/timeline-pointer.html'
fs.mkdirSync('.tmp/director-full-audit-20260907', { recursive: true })
fs.writeFileSync(fixture, `<html><head><link rel="stylesheet" href="/tailwind.generated.css"></head><body><div id="app"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DirectorStoreContext } from '/src/workbench/generationCanvas/nodes/director/DirectorEditorContext.ts';
import { createDirectorStore } from '/src/workbench/generationCanvas/nodes/director/model/directorStore.ts';
import { buildTimelineTracks } from '/src/workbench/generationCanvas/nodes/director/model/timelineTracks.ts';
import { buildTimelineRows } from '/src/workbench/generationCanvas/nodes/director/timeline/timelineRows.ts';
import { TrackLanes } from '/src/workbench/generationCanvas/nodes/director/timeline/TrackLanes.tsx';
const store = createDirectorStore({ defaultSceneName: 'S' });
const api = store.getState();
const id = api.addObject({ name: 'A', type: 'character', position: {x:0,y:0,z:0}, rotation: {x:0,y:0,z:0}, scale: {x:1,y:1,z:1}, visible:true, locked:false });
const clip = api.addTrajectoryClip(id, 0, 4);
for (const time of [1,2,3]) api.insertWaypoint(id, time, { x: time }, clip.id);
api.setSnapEnabled(false);
window.fixture = { store, id, clipId: clip.id };
const noop = () => {};
const viewport = { containerRef:{current:null}, pxPerSecond:100, visibleWidth:1000, laneWidth:6000, leftPad:0, timeToPx:t=>t*100, pxToTime:px=>px/100, zoomIn:noop, zoomOut:noop, fit:noop };
const tracks = buildTimelineTracks(api.activeScene(), { trajectory:()=> 'path', action:()=> 'pose', closeup:()=> 'closeup', lookat:()=> 'lookat' });
createRoot(document.getElementById('app')).render(React.createElement(DirectorStoreContext.Provider, {value:store}, React.createElement(TrackLanes, { rows:buildTimelineRows(tracks), viewport, totalDuration:60, onContextMenu:noop, onReject:noop, onAppendTrajectory:noop })));
</script></body></html>`)

const browser = await chromium.launch({ headless: true, channel: process.env.NOMI_BROWSER_CHANNEL ?? 'chrome' })
const page = await browser.newPage({ viewport: { width: 1100, height: 300 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const url = `${process.env.NOMI_DIRECTOR_URL ?? 'http://127.0.0.1:5175'}/${fixture}`
let failures = 0
async function run(name, check) {
  await page.goto(url)
  await expect(page.locator('[data-clip-id]')).toBeVisible()
  try { await check(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.log(`FAIL ${name}: ${error.message}`) }
}
try {
  await run('cancel does not commit', async () => {
    const clip = page.locator('[data-clip-id]')
    const box = await clip.boundingBox()
    await page.mouse.move(box.x + 100, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + 200, box.y + 10)
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })))
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.fixture.store.getState().findObject(window.fixture.id).trajectoryClips[0].startTime)).toBe(0)
  })
  await run('empty row seeks', async () => {
    await page.mouse.click(600, 14)
    await expect.poll(() => page.evaluate(() => window.fixture.store.getState().timeline.currentTime)).toBe(6)
  })
  await run('range selects keys', async () => {
    await page.mouse.move(50, 42)
    await page.mouse.down()
    await page.mouse.move(250, 42, { steps: 3 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => {
      const state = window.fixture.store.getState()
      return state.findObject(window.fixture.id).motionTrajectory.filter(key => state.selection.selectedWaypointIds.includes(key.id)).map(key => key.time)
    })).toEqual([1, 2])
  })
  if (errors.length) throw new Error(errors.join('\n'))
  if (failures) throw new Error(`${failures} pointer interaction failures`)
} finally { await browser.close() }
