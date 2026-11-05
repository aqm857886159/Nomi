// macOS 开发构建；修前 NOMI_WALK_EXPECT=before，修后默认；中英均走真实保存确认与原生窗口。
// 安静仪表拦截 OS 焦点；这里只验证主窗可见与 focus 请求，Finder / Dock 原生点击另验。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { newProjectEntry, switchWorkspace } from './_shell.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const before = process.env.NOMI_WALK_EXPECT === 'before'
const output = path.resolve(process.env.NOMI_LIFECYCLE_EVIDENCE ?? path.join(root, 'tests/ux/shots/desktop-window-lifecycle', before ? 'before' : 'after'))
fs.mkdirSync(output, { recursive: true })
const require = createRequire(import.meta.url)
const mediaFile = path.join(output, 'source.webm')
const encoded = spawnSync(require('@ffmpeg-installer/ffmpeg').path, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:d=1:r=24', '-c:v', 'libvpx', mediaFile], { timeout: 30_000 })
if (encoded.status !== 0) throw new Error(`Local media encoding failed: ${encoded.stderr}`)
const mediaBytes = Array.from(fs.readFileSync(mediaFile))
const onlyCase = process.env.NOMI_LIFECYCLE_CASE
const locales = process.env.NOMI_WALK_LANG ? [process.env.NOMI_WALK_LANG === 'en' ? 'en' : 'zh-CN'] : ['zh-CN', 'en']
const results = []
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
async function start(locale, name) {
  const tempRoot = fs.mkdtempSync(path.join(output, `${locale}-${name}-`))
  const matchingProcesses = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(tempRoot))
  console.log('LIFECYCLE_PROFILE_PREFLIGHT', JSON.stringify({ tempRoot, fresh: fs.readdirSync(tempRoot).length === 0, matchingProcesses, lockFiles: fs.readdirSync(tempRoot).filter((file) => /Singleton|lock/i.test(file)) }))
  const launched = await launchNomiApp({ name: `desktop-lifecycle-${locale}-${name}`, settleMs: 0,
    tempRoot,
    mainRequire: [path.join(root, 'tests/ux/_desktopWindowLifecycle.cjs')],
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
  })
  return { ...launched, pid: launched.app.process().pid }
}
async function finish(launched) {
  if (alive(launched.pid)) await launched.app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy() })
  await launched.close()
}
async function closeMain(launched, page) {
  const native = await launched.app.browserWindow(page)
  await native.evaluate((window) => window.close())
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await screenshotSettled(page, { path: path.join(output, `${process.env.NOMI_WALK_LANG ?? "both"}-${onlyCase ?? "all"}-${results.length}-save-confirm.png`) })
  await dialog.getByRole('button', { name: /^(Close|关闭)$/ }).click()
}
try {
  for (const locale of locales) {
    if (!onlyCase || onlyCase === 'idle') {
    const idle = await start(locale, 'idle')
    try {
      await expect(newProjectEntry(idle.win)).toBeVisible()
      const pid = idle.pid
      await closeMain(idle, idle.win)
      if (before) {
        await expect.poll(() => idle.app.windows().length).toBe(0)
        expect(alive(pid)).toBe(true)
      } else await expect.poll(() => alive(pid), { timeout: stationTimeout() }).toBe(false)
      results.push({ locale, case: 'idle-close', pid, alive: alive(pid), expectedAlive: before })
    } finally { await finish(idle) }

    }
    if (onlyCase === 'idle') continue
    const recovery = await start(locale, 'reopen')
    try {
      await expect(newProjectEntry(recovery.win)).toBeVisible()
      const main = await recovery.app.browserWindow(recovery.win)
      const mainId = await main.evaluate((window) => window.id)
      const auxId = await recovery.app.evaluate(async ({ BrowserWindow }) => {
        const window = new BrowserWindow({ show: false, width: 300, height: 200 })
        await window.loadURL('about:blank')
        return window.id
      })
      if (onlyCase !== 'export') {
      await screenshotSettled(recovery.win, { path: path.join(output, `${locale}-before-hide.png`) })
      for (const entry of ['activate', 'second-instance']) {
        await main.evaluate((window) => window.hide())
        const focusBefore = await recovery.app.evaluate(() => globalThis.__nomiQuietWalk.events.filter((event) => event.type === 'window.focus').length)
        await recovery.app.evaluate(({ app }, event) => event === 'activate' ? app.emit('activate') : app.emit('second-instance', {}, [], ''), entry)
        const expectedVisible = !before
        await expect.poll(() => main.evaluate((window) => window.isVisible())).toBe(expectedVisible)
        const focusAfter = await recovery.app.evaluate(() => globalThis.__nomiQuietWalk.events.filter((event) => event.type === 'window.focus').length)
        if (expectedVisible) expect(focusAfter).toBeGreaterThan(focusBefore)
        const auxiliaryVisible = await recovery.app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), auxId)
        if (!before) expect(auxiliaryVisible).toBe(false)
        results.push({ locale, case: entry, pid: recovery.pid, mainId, auxId, auxiliaryVisible, visible: await main.evaluate((window) => window.isVisible()), focusRequested: focusAfter > focusBefore })
      }
      if (!before) await screenshotSettled(recovery.win, { path: path.join(output, `${locale}-recalled-main.png`) })
      if (onlyCase === 'reopen') continue
      await main.evaluate((window) => window.show())
      }
      // 用真实任务 owner 创建一个导出作业，保留待上传输入；不伪造 busy 数。
      await newProjectEntry(recovery.win).click()
      await recovery.win.waitForFunction(() => /projectId=/.test(location.href))
      await switchWorkspace(recovery.win, 'generation', 'generation workspace')
      await expect(recovery.win.locator('.generation-canvas-v2__stage')).toBeVisible()
      const job = await recovery.win.evaluate(async () => {
        const projectId = new URLSearchParams(location.search).get('projectId') ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('projectId')
        return window.nomiDesktop.exports.startJob({ projectId, outputName: 'lifecycle-proof.mp4', manifest: {
          version: 1, projectId, createdAt: new Date().toISOString(),
          timeline: { fps: 24, durationFrames: 24, range: { startFrame: 0, endFrame: 24 }, tracks: [] }, assets: {},
          profile: { preset: 'share', container: 'mp4', videoCodec: 'h264', audioCodec: 'none', audioMode: 'mute', width: 1280, height: 720, fps: 24, pixelFormat: 'yuv420p', quality: 'small' },
        } })
      })
      expect(job.jobId).toBeTruthy()
      await recovery.win.evaluate(async ({ jobId, bytes }) => window.nomiDesktop.exports.writeTempInput({ jobId, chunk: bytes }), { jobId: job.jobId, bytes: mediaBytes })
      const pid = recovery.pid
      await closeMain(recovery, recovery.win)
      await expect.poll(() => recovery.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
      expect(alive(pid)).toBe(true)
      await recovery.app.evaluate(({ app }) => app.emit('activate'))
      if (before) {
        expect(await recovery.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
        results.push({ locale, case: 'export-close-reopen', pid: recovery.pid, alive: true, reopened: false, jobId: job.jobId })
      } else {
        await expect.poll(() => recovery.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
        await expect.poll(() => recovery.app.windows().filter((page) => page !== recovery.win && page.url() !== 'about:blank').length).toBe(1)
        const page = recovery.app.windows().find((page) => page !== recovery.win && page.url() !== 'about:blank')
        expect(page).toBeTruthy()
        await page.waitForLoadState('domcontentloaded')
        const recalled = await recovery.app.browserWindow(page)
        const recalledState = await recalled.evaluate((window) => ({ id: window.id, visible: window.isVisible() }))
        expect(recalledState.visible).toBe(true)
        expect(recalledState.id).not.toBe(auxId)
        await screenshotSettled(page, { path: path.join(output, `${locale}-export-recalled-main.png`) })
        const cards = page.locator('[data-project-card="true"]')
        await expect(cards).toHaveCount(1)
        await cards.dblclick()
        await page.waitForFunction(() => /projectId=/.test(location.href))
        await switchWorkspace(page, 'generation', 'generation workspace after reopen')
        await expect(page.locator('.generation-canvas-v2__stage')).toBeVisible()
        const retained = await page.evaluate((jobId) => window.nomiDesktop.exports.status(jobId), job.jobId)
        expect(['planning', 'preparing']).toContain(retained.status)
        await page.evaluate((jobId) => window.nomiDesktop.exports.finishTempInput({ jobId }), job.jobId)
        const completed = await page.evaluate((jobId) => window.nomiDesktop.exports.status(jobId), job.jobId)
        expect(completed.status).toBe('succeeded')
        const artifact = path.join(output, `${locale}-export-proof.mp4`)
        fs.copyFileSync(completed.result.outputPath, artifact)
        const decoded = spawnSync(require('@ffmpeg-installer/ffmpeg').path, ['-v', 'error', '-i', artifact, '-f', 'null', '-'], { timeout: 30_000 })
        expect(decoded.status, `export decodes: ${decoded.stderr}`).toBe(0)
        results.push({ locale, case: 'export-close-reopen', pid: recovery.pid, alive: true, reopened: true, jobId: job.jobId, retained: retained.status, completed: completed.status, recalledState, artifact, decoded: true })
      }
    } finally { await finish(recovery) }
  }
} finally {
  fs.writeFileSync(path.join(output, `results-${onlyCase ?? 'all'}-${process.env.NOMI_WALK_LANG ?? 'both'}.json`), JSON.stringify(results, null, 2) + '\n')
}
console.log(JSON.stringify(results, null, 2))
console.log('DESKTOP_LIFECYCLE_WALK_COMPLETE')
