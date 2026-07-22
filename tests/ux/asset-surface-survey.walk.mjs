// 勘察走查（素材面二次收敛前的真实 UI 采样 · 2026-07-22，样张打底用，不做断言闸）：
// ① 主窗侧栏素材库（默认 tab）② 素材库右侧抽屉 ③ 顶栏素材盒浮窗（宿主A）
// ④ 浮窗「提示词库」tab（预埋项目桶提示词卡后，验证 global 桶恒空推演）
// ⑤ 应用内浏览器 + 吸附素材盒托盘（独立 overlay 窗，走 app.windows() 拿其 page）
// ⑥ 托盘「提示词库」tab（同一预埋卡应可见 → 与 ④ 对照即两桶分裂实证）
// 用法: pnpm build && node tests/ux/asset-surface-survey.walk.mjs
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/asset-surface-survey')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-asset-survey'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })

const projectId = 'walk-assetsurvey-0001'
const projDir = path.join(projectsDir, `asset-survey-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const project = {
  id: projectId, name: '素材面勘察', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  workbenchDocument: null, timeline: null, generationCanvas,
  payload: { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

// 预埋 3 张落盘图（无 sidecar → 按扩展名判 image，进 imported 桶列表）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const importedDir = path.join(projDir, 'assets', 'imported', '2026-07-22')
fs.mkdirSync(importedDir, { recursive: true })
for (const name of ['捕捞样例一.png', '捕捞样例二.png', '捕捞样例三.png']) {
  fs.writeFileSync(path.join(importedDir, name), PNG)
}

const seededBucket = JSON.stringify({
  version: 1,
  folders: [{ id: 'folder-demo-1', type: 'folder', source: 'my', title: '主角参考', parentFolderId: null }],
  promptCards: [{
    id: 'prompt-demo-1', type: 'prompt', source: 'transcript', title: '赛博城市雨夜提示词',
    promptCard: {
      referenceImages: [], prompt: 'cyberpunk city, rainy night, neon reflections, cinematic', promptType: 'image',
      savedAt: '2026-07-22T08:00:00.000Z',
    },
  }],
  promptCategories: [],
  folderAssignments: {},
  deletedAssetKeys: [],
})

const findings = []
const note = (line) => { findings.push(line); console.log('  ' + line) }
async function snap(page, name) {
  const file = path.join(shotsDir, `${name}.png`)
  await page.screenshot({ path: file }).catch((e) => console.log(`  [snap-fail] ${name}: ${e.message}`))
  console.log(`  [shot] ${name}`)
}

let app
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${path.join(base, 'udata')}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      NOMI_E2E: '1',
      NOMI_E2E_SMOKE: '1',
      NOMI_PROJECTS_DIR: projectsDir,
      NOMI_SETTINGS_DIR: settingsDir,
    },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await win.evaluate(({ bucketKey, bucketValue }) => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
    window.localStorage.setItem('__nomiE2E', '1')
    window.localStorage.setItem(bucketKey, bucketValue)
  }, { bucketKey: `nomi.browser.asset-library.v1:${projectId}`, bucketValue: seededBucket })
  await win.reload()
  await win.waitForTimeout(1500)
  for (let i = 0; i < 6; i++) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(350)
  }
  await snap(win, '01-project-library-page')

  // —— 进项目 ——
  const card = win.getByText('素材面勘察', { exact: false }).first()
  if (await card.count()) {
    await card.click({ timeout: 4000 }).catch(() => {})
    await win.waitForTimeout(400)
    const cont = win.getByText('继续创作', { exact: false }).first()
    if (await cont.count()) await cont.click({ timeout: 3000 }).catch(() => {})
    await card.dblclick({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(2500)
  }
  await snap(win, '02-studio-sidebar-asset-library')

  // —— 素材库右侧抽屉 ——
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-files-panel')))
  await win.waitForTimeout(900)
  await snap(win, '03-asset-library-drawer')
  note(`素材库抽屉可见=${(await win.locator('[role="dialog"][aria-label="素材库"]').count()) > 0}`)
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(500)

  // —— 顶栏素材盒浮窗（宿主A）——
  const boxButton = win.locator('button[aria-label="打开素材盒"]').first()
  note(`顶栏素材盒按钮存在=${(await boxButton.count()) > 0}`)
  if (await boxButton.count()) {
    await boxButton.click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(1200)
    await snap(win, '04-global-assetbox-popover')
    const promptTab = win.getByText('提示词库', { exact: true }).first()
    if (await promptTab.count()) {
      await promptTab.click({ timeout: 3000 }).catch(() => {})
      await win.waitForTimeout(900)
      await snap(win, '05-global-assetbox-prompt-tab')
      const cardVisible = (await win.getByText('赛博城市雨夜提示词', { exact: false }).count()) > 0
      note(`宿主A提示词库tab能看到项目桶提示词卡=${cardVisible}（推演预期 false）`)
    } else {
      note('宿主A未找到「提示词库」tab')
    }
    await boxButton.click({ timeout: 2000 }).catch(() => {})
    await win.waitForTimeout(500)
  }

  // —— 应用内浏览器 + 吸附托盘（独立 overlay 窗）——
  const browserButton = win.locator('button[aria-label="打开浏览器"]').first()
  if (await browserButton.count()) {
    await browserButton.click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(2200)
    await snap(win, '06-in-app-browser')
    const trayButton = win.locator('button[aria-label*="素材盒"]').last()
    if (await trayButton.count()) {
      await trayButton.click({ timeout: 3000 }).catch(() => {})
      await win.waitForTimeout(1800)
    }
    const overlayWin = app.windows().find((p) => p.url().includes('nomiOverlay=browserAsset'))
    note(`托盘 overlay 独立窗存在=${Boolean(overlayWin)}`)
    if (overlayWin) {
      await overlayWin.waitForLoadState('domcontentloaded').catch(() => {})
      await overlayWin.waitForTimeout(900)
      await snap(overlayWin, '07-browser-tray-overlay')
      const trayPromptTab = overlayWin.getByText('提示词库', { exact: true }).first()
      if (await trayPromptTab.count()) {
        await trayPromptTab.click({ timeout: 3000 }).catch(() => {})
        await overlayWin.waitForTimeout(900)
        await snap(overlayWin, '08-browser-tray-prompt-tab')
        const cardVisible = (await overlayWin.getByText('赛博城市雨夜提示词', { exact: false }).count()) > 0
        note(`托盘提示词库tab能看到同一张卡=${cardVisible}（推演预期 true）`)
      } else {
        note('托盘未找到「提示词库」tab')
      }
      const folderVisible = (await overlayWin.getByText('主角参考', { exact: false }).count()) > 0
      note(`托盘可见预埋文件夹「主角参考」=${folderVisible}`)
    }
    await snap(win, '09-main-window-with-browser')
  }

  fs.writeFileSync(path.join(shotsDir, 'findings.txt'), findings.join('\n') + '\n')
  console.log('SURVEY DONE')
} finally {
  if (app) {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]).catch(() => {})
    process.exit(0)
  }
}
