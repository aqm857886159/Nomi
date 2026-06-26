// 超时找回 R13 走查 —— Playwright _electron 驱动真 app（隔离 userData + NOMI_PROJECTS_DIR 绕锁/不污染）。
// 验证：磁盘里 status=running+taskId 的「卡住」视频节点，被真实加载路径 normalizeStoreSnapshot 收敛成
// recoverable → 渲染真 NodeRecoverableReport（生产 CSS，人眼判断：中性纸底非红色、品牌图标、按钮可点）。
// 用法: node tests/ux/timeout-recover.walk.mjs
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/recover')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-recover-userdata')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-recover-projects')
fs.mkdirSync(userData, { recursive: true })
fs.rmSync(projectsDir, { recursive: true, force: true })

// —— 物化一个「上次退出时正在生成」的项目：单个 video 节点，status=running + runs[0].taskId ——
const now = Date.now()
const stuckNode = {
  id: 'shot-stuck-1', kind: 'video', title: '镜头 03 · 林夏回头',
  position: { x: 120, y: 120 }, size: { width: 360, height: 300 },
  prompt: '林夏在咖啡馆回头，暖光，电影感',
  status: 'running',
  progress: { phase: 'still-generating', message: '仍在生成 · 已超常规时长', updatedAt: now, taskId: 'upstream-live-xyz' },
  runs: [{ id: 'run-stuck-1', status: 'running', taskId: 'upstream-live-xyz', startedAt: now - 1300000, updatedAt: now }],
  meta: { modelKey: 'seedance-2', vendor: 'apimart', modelVendor: 'apimart' },
  categoryId: 'shots',
}
const record = {
  id: 'project-recover-fixture-0001', name: 'ZZ 超时找回 fixture',
  version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: '',
  payload: {
    workbenchDocument: { version: 1, title: '', contentJson: { type: 'doc', content: [] } },
    generationCanvas: { nodes: [stuckNode], edges: [], selectedNodeIds: [], groups: [] },
    timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
      { id: 'videoTrack', type: 'video', label: '视频轨', clips: [] },
    ] },
  },
}
const rootPath = path.join(projectsDir, 'ZZ-recover-fixture')
fs.mkdirSync(path.join(rootPath, '.nomi'), { recursive: true })
fs.writeFileSync(path.join(rootPath, '.nomi', 'project.json'), JSON.stringify({ ...record, lastKnownRootPath: rootPath }, null, 1))

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${userData}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_PROJECTS_DIR: projectsDir },
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
})
await win.waitForTimeout(1800)

let n = 0
async function snap(name) {
  n += 1
  await win.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

try {
  await snap('library')
  // 打开 fixture 项目（库卡片按名字点）。
  await win.locator('[role="button"], button, .group', { hasText: 'ZZ 超时找回' }).first().click({ timeout: 8000 }).catch(() => {})
  await win.waitForTimeout(2500)
  await snap('after-open')

  // 真实加载路径应已把卡住节点收敛成 recoverable → 面板出现。
  const node = win.locator('.generation-canvas-v2-node').first()
  await node.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  const probe = await win.evaluate(() => {
    const panel = document.querySelector('[role="status"][aria-label*="重新拉取"]')
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /重新拉取结果/.test(b.textContent || ''))
    const cs = panel ? getComputedStyle(panel) : null
    const bcs = btn ? getComputedStyle(btn) : null
    return {
      recoverablePanelPresent: Boolean(panel),
      recoverButtonPresent: Boolean(btn),
      panelBg: cs?.backgroundColor || null,
      panelBorder: cs?.borderColor || null,
      buttonBg: bcs?.backgroundColor || null,
      buttonColor: bcs?.color || null,
    }
  })
  console.log('RECOVERABLE PROBE:', JSON.stringify(probe, null, 2))
  await snap('recoverable-panel')

  // 点「重新拉取结果」→ 应翻成 running（品牌 logo 转圈），无 vendor 会回退，但能截到 pending/转圈瞬间。
  const btn = win.locator('button', { hasText: '重新拉取结果' }).first()
  if (await btn.count()) {
    await btn.click().catch(() => {})
    await win.waitForTimeout(500)
    await snap('after-refetch-click')
  }
} catch (error) {
  console.error(`RECOVER WALK ERROR: ${error?.message || error}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
