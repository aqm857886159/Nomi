// Real Electron decoding + actual complete StoryboardShotRow host, fixed renderer props.
// No production generation request; all profile/project/media writes are isolated.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shot-nodes-media-'))
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'shot-nodes-media'
const projectDir = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectDir, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectDir, 'assets/imported'), { recursive: true })
fs.copyFileSync(path.join(repoRoot, 'tests/ux/fixtures/real-shot-640x360.mp4'), path.join(projectDir, 'assets/imported/shot.mp4'))
const project = { id: projectId, name: '分镜媒体验证', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectDir, payload: { workbenchDocument: null, timeline: null, generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] } } }
for (const file of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectDir, file), JSON.stringify(project))
const output = path.join(repoRoot, 'docs/plan/shot-nodes-evidence')
fs.mkdirSync(output, { recursive: true })
const base = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5199'
const { app, win } = await launchNomiApp({ name: 'shot-nodes-media', tempRoot, projectsDir, settleMs: 0, env: { VITE_DEV_SERVER_URL: base, NOMI_E2E_SMOKE: '1' } })
try {
  await win.setViewportSize({ width: 1100, height: 400 })
  // Project discovery populates the normal local-protocol project registry.
  await win.evaluate(() => window.nomiDesktop.projects.list())
  for (const theme of ['light', 'dark']) {
    await win.evaluate(theme => { localStorage.setItem('nomi-color-scheme', theme); localStorage.setItem('nomi:locale:v1', 'zh-CN') }, theme)
    await win.goto(`${base}/tests/ux/fixtures/shot-nodes-media/index.html?media=${encodeURIComponent(`nomi-local://asset/${projectId}/assets/imported/shot.mp4`)}`)
    const video = win.locator('[data-storyboard-frame="done"] video')
    await expect(video).toBeVisible()
    await win.waitForFunction(() => {
      const media = document.querySelector('[data-storyboard-frame="done"] video')
      return media instanceof HTMLVideoElement && media.videoWidth > 0 && media.readyState >= 2
    })
    const evidence = await video.evaluate(media => ({ src: media.currentSrc, width: media.videoWidth, height: media.videoHeight, readyState: media.readyState, error: media.error?.code ?? null }))
    expect(evidence.width, 'decoded fixture width').toBe(640)
    expect(evidence.height, 'decoded fixture height').toBe(360)
    expect(evidence.error, 'native media decode succeeded').toBeNull()
    await expect(win.locator('[data-storyboard-frame="done"] img, [data-storyboard-frame="done"] video')).toHaveCount(1)
    await expect(win.locator('[data-node-media-state]')).toHaveAttribute('data-node-media-state', 'ready')
    await screenshotSettled(win, { path: path.join(output, `after-storyboard-video-${theme}.png`) })
    console.log(JSON.stringify({ theme, ...evidence }))
    for (const phase of ['queued', 'running', 'error']) {
      await win.goto(`${base}/tests/ux/fixtures/shot-nodes-media/index.html?phase=${phase}`)
      const message = win.locator('[data-generation-message]')
      if (phase === 'queued') {
        await expect(message).toContainText(/排队.*1/)
      } else if (phase === 'running') {
        await expect(message).toContainText(/生成中.*秒/)
        const first = await message.innerText()
        await expect(message).not.toHaveText(first)
        await expect(message).not.toContainText('%')
      } else {
        await expect(message).toContainText('镜头服务暂时不可用')
        const retry = win.locator('[data-storyboard-actbar]').getByRole('button', { name: /重新生成这一镜/ })
        await expect(retry).toBeVisible()
        await retry.click()
        expect(await win.evaluate(() => window.__shotRowFixture.retryCalls)).toEqual(['media-node'])
      }
      await screenshotSettled(win, { path: path.join(output, `after-storyboard-${phase}-${theme}.png`) })
      console.log(JSON.stringify({ theme, phase, message: await message.innerText() }))
    }
  }
} finally {
  await app.close()
}
