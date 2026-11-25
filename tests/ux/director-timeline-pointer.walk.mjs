// 导演时间轴生产组件、真实指针事件与 store。Vite 在本机为隔离 Electron 提供夹具页。
import path from 'node:path'
import { createServer } from 'vite'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'

const output = makeTempDir('nomi-director-timeline-pointer-')
process.env.EVIDENCE_DIR ??= path.join(output, 'feel')
const fixturePath = '/director-timeline-pointer.html'
const fixture = `<!doctype html><html><head><link rel="stylesheet" href="/tailwind.generated.css"></head><body><div id="app" data-shortcut-surface="canvas"></div><script type="module">
import '/src/styles/index.css';
import '/src/i18n/index.ts';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DirectorStoreContext } from '/src/workbench/generationCanvas/nodes/director/DirectorEditorContext.ts';
import { createDirectorStore } from '/src/workbench/generationCanvas/nodes/director/model/directorStore.ts';
import { buildTimelineTracks } from '/src/workbench/generationCanvas/nodes/director/model/timelineTracks.ts';
import { buildTimelineRows } from '/src/workbench/generationCanvas/nodes/director/timeline/timelineRows.ts';
import { workspaceInputAttributes } from '/src/workbench/shortcutSurface.ts';
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
const host = document.getElementById('app');
for (const [key, value] of Object.entries(workspaceInputAttributes(true))) host.setAttribute(key, value);
createRoot(host).render(React.createElement(DirectorStoreContext.Provider, {value:store}, React.createElement(TrackLanes, { rows:buildTimelineRows(tracks), viewport, totalDuration:60, renderRowMenu:(_row, lane) => lane, onReject:noop, onAppendTrajectory:noop })));
</script></body></html>`

const server = await createServer({
  cacheDir: path.join(output, 'vite'),
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{
    name: 'director-timeline-pointer-fixture',
    configureServer(vite) {
      vite.middlewares.use(fixturePath, async (_request, response, next) => {
        try {
          const html = await vite.transformIndexHtml(fixturePath, fixture)
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end(html)
        } catch (error) {
          next(error)
        }
      })
    },
  }],
})
await server.listen()
const url = new URL(fixturePath, server.resolvedUrls.local[0]).href
let app
let page
const errors = []
let failures = 0
async function run(name, check) {
  await page.goto(url)
  await expect(page.getByTestId('director-timeline-lanes').locator('[data-clip-id]'), errors.join('\n')).toBeVisible()
  try { await check(); console.log(`PASS ${name}`) }
  catch (error) { failures++; console.log(`FAIL ${name}: ${error.message}`) }
}
try {
  ;({ app, win: page } = await launchNomiApp({
    name: 'director-timeline-pointer',
    env: { NOMI_RENDERER_URL: url },
    viewportSize: { width: 1100, height: 700 },
    settleMs: 0,
  }))
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message) })
  await run('cancel does not commit', async () => {
    const clip = page.locator('[data-clip-id]')
    const box = await clip.boundingBox()
    await page.mouse.move(box.x + 100, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + 200, box.y + 10, { steps: 8 })
    await expect.poll(async () => (await clip.boundingBox()).x).toBeGreaterThan(box.x + 50)
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })))
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.fixture.store.getState().findObject(window.fixture.id).trajectoryClips[0].startTime)).toBe(0)
  })
  await run('empty row seeks', async () => {
    const lanes = await page.getByTestId('director-timeline-lanes').boundingBox()
    await page.mouse.click(lanes.x + 600, lanes.y + 14)
    await expect.poll(() => page.evaluate(() => window.fixture.store.getState().timeline.currentTime)).toBe(6)
  })
  await run('range selects keys', async () => {
    const lanes = await page.getByTestId('director-timeline-lanes').boundingBox()
    await page.mouse.move(lanes.x + 50, lanes.y + 42)
    await page.mouse.down()
    await page.mouse.move(lanes.x + 250, lanes.y + 42, { steps: 3 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => {
      const state = window.fixture.store.getState()
      return state.findObject(window.fixture.id).motionTrajectory.filter(key => state.selection.selectedWaypointIds.includes(key.id)).map(key => key.time)
    })).toEqual([1, 2])
  })
  await screenshotSettled(page, { path: path.join(output, 'shots', 'range-selected.png') })
  if (errors.length) throw new Error(errors.join('\n'))
  if (failures) throw new Error(`${failures} pointer interaction failures`)
} finally {
  await app?.close()
  await server.close()
}
