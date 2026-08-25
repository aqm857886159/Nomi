// P5 E1 R13 走查（零额度）：产物 → 加入时间轴 → 预览有段 → 一步 Undo 复原。
// 只播种一个已有产物，不触发生成；四路隔离目录都显式设置，尤其是 NOMI_CAPABILITY_DIR。
// 用法：pnpm run build && node tests/ux/adoption-bridge.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/adoption-bridge')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-adoption-bridge-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'adoption-bridge-walk'
const projectRoot = path.join(projectsDir, `adoption-${projectId}`)
fs.mkdirSync(projectRoot, { recursive: true })
const swatch = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2f6f8f"/></svg>',
)
const nodes = [{
  id: 'adoption-shot-1', kind: 'image', title: '采纳桥镜头 1', categoryId: 'shots', shotIndex: 1,
  position: { x: 160, y: 120 }, result: { id: 'adoption-artifact-1', type: 'image', url: swatch, createdAt: 1 },
}]
const project = {
  id: projectId, name: 'P5 E1 采纳桥走查', version: 1, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: { version: 1, title: 'P5 E1 采纳桥走查', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
    timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))

let app
let failed
try {
  ({ app } = await launchNomiApp({
    name: 'adoption-bridge', userDataDir, settingsDir, projectsDir,
    env: { NOMI_CAPABILITY_DIR: capabilityDir },
    args: ['--disable-gpu'], timeout: 300000, settleMs: 1200,
  }))
  let win = app.windows().find((candidate) => !candidate.isClosed()) || app.firstWindow()
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => windowRef.setBounds(bounds), { x: 0, y: 0, width: 1440, height: 960 })
  await win.waitForTimeout(500)
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
    localStorage.setItem('nomi-color-scheme', 'dark')
  })
  await win.reload()
  const projectCard = win.getByText('P5 E1 采纳桥走查', { exact: false }).first()
  await expect(projectCard, '项目卡没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(win.getByRole('button', { name: /继续创作/ }).first(), '打开 P5 E1 采纳桥项目')
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  const previewTab = win.locator('nav.nomi-stepper [data-mode="preview"]').first()
  await clickOrFail(previewTab, '预览 tab')
  await expect(previewTab, '预览 tab 点击后没有切换 active').toHaveAttribute('aria-current', 'page', { timeout: DEFAULT_TIMEOUT_MS })
  await win.waitForFunction(() => new URL(location.href).searchParams.get('step') === 'preview', undefined, { timeout: DEFAULT_TIMEOUT_MS })

  const sourceButton = win.getByRole('button', { name: /采纳桥镜头 1.*点击加到片尾/ }).first()
  await expect(sourceButton, '生成产物来源按钮没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await proveProbe(sourceButton, '预览区确实渲染了产物来源按钮')
  await clickOrFail(sourceButton, '加入时间轴（点击贴尾）')

  const timelineClip = win.locator('.workbench-preview [data-testid="timeline-clip"]').first()
  await expect(timelineClip, '加入时间轴后预览没有出现片段').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await win.screenshot({ path: path.join(shotsDir, '01-dark-applied.png') })
  const clipProof = await proveProbe(timelineClip, '加入时间轴后片段确实可见')

  const undo = win.getByRole('button', { name: /撤销时间轴编辑/ }).first()
  await clickOrFail(undo, '一步撤销采纳')
  await expectAbsent(timelineClip, { provenBy: clipProof, message: '一步 Undo 后片段应从时间轴复原' })
  await win.screenshot({ path: path.join(shotsDir, '02-dark-undone.png') })

  // 同一真实入口再取一张光色证据，确保采纳桥回执在两套 token 下都不依赖颜色才能理解。
  await win.evaluate(() => localStorage.setItem('nomi-color-scheme', 'light'))
  await win.reload()
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  if (await win.locator('nav.nomi-stepper [data-mode="preview"][aria-current="page"]').count() === 0) {
    await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), '光色重开后切回预览 tab')
  }
  await win.screenshot({ path: path.join(shotsDir, '03-light-restored.png') })
  // sourceProof 是正向探针的阳性对照，避免「光色截图」其实拍到错误页面。
  await expect(sourceButton, '光色重开后产物来源探针失效').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  console.log(`✅ P5 E1 采纳桥走查通过；光/暗截图见 ${shotsDir}`)
} catch (error) {
  failed = error
} finally {
  await app?.close().catch(() => {})
}
if (failed) {
  console.error(`❌ ${failed.message}`)
  process.exit(1)
}
