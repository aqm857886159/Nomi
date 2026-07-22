// R13 验收走查（素材面二次收敛 · 方案一重执行 2026-07-22）：
// 预埋「旧版素材盒 localStorage 私账」（提示词卡+文件夹+软删标记）+ 落盘捕捞素材 → 冷启动，验：
//   ① 唯一门：顶栏/库页无「素材盒」按钮（宿主A 已亡；工具条素材盒只活在浏览器域）
//   ② 迁移·提示词：旧提示词卡出现在主提示词库「我的库」（侧栏提示词 tab）
//   ③ 迁移·文件夹：旧文件夹「主角参考」以瓦片现身素材库「项目素材」tab，可点入/返回
//   ④ 托盘瘦身：浏览器伴生素材盒=单一捕捞收件箱（无提示词库 tab/无文件夹/无上传按钮），捕捞素材可见
//   ⑤ 软删解散：旧「软删」素材在素材库照常可见（文件本就没删，属预期）
// 用法: pnpm build && node tests/ux/asset-surface-convergence.walk.mjs
// 判据=断言 + 截图（tests/ux/shots/asset-surface-convergence/）人眼过。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/asset-surface-convergence')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-asset-convergence'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })

const projectId = 'walk-assetconv-0001'
const projDir = path.join(projectsDir, `asset-convergence-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const project = {
  id: projectId, name: '素材面收敛验收', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  workbenchDocument: null, timeline: null, generationCanvas,
  payload: { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const importedDir = path.join(projDir, 'assets', 'imported', '2026-07-22')
fs.mkdirSync(importedDir, { recursive: true })
for (const name of ['捕捞样例一.png', '捕捞样例二.png', '曾被软删.png']) {
  fs.writeFileSync(path.join(importedDir, name), PNG)
}

// 旧版私账桶（迁移器的输入）：提示词卡 + 文件夹 + 软删标记（旧口径 url: 键）。
const legacyBucket = JSON.stringify({
  version: 1,
  folders: [{ id: 'folder-legacy-1', type: 'folder', source: 'my', title: '主角参考', parentFolderId: null }],
  promptCards: [{
    id: 'prompt-legacy-1', type: 'prompt', source: 'transcript', title: '赛博城市雨夜提示词',
    promptCard: {
      referenceImages: [], prompt: 'cyberpunk city, rainy night, neon reflections, cinematic', promptType: 'image',
      savedAt: '2026-07-01T00:00:00.000Z',
    },
  }],
  promptCategories: [],
  folderAssignments: {},
  deletedAssetKeys: ['url:legacy-soft-deleted-key'],
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`)
}
async function snap(page, name) {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) }).catch((e) => console.log(`  [snap-fail] ${name}: ${e.message}`))
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
  }, { bucketKey: `nomi.browser.asset-library.v1:${projectId}`, bucketValue: legacyBucket })
  await win.reload()
  await win.waitForTimeout(1500)
  for (let i = 0; i < 6; i++) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(350)
  }

  // —— ① 唯一门（库页）——
  check('库页无素材盒按钮', (await win.locator('button[aria-label="打开素材盒"]').count()) === 0)
  await snap(win, '01-library-page-no-assetbox')

  // —— 进项目（studio 挂载触发迁移器）——
  const card = win.getByText('素材面收敛验收', { exact: false }).first()
  if (await card.count()) {
    await card.click({ timeout: 4000 }).catch(() => {})
    await win.waitForTimeout(400)
    const cont = win.getByText('继续创作', { exact: false }).first()
    if (await cont.count()) await cont.click({ timeout: 3000 }).catch(() => {})
    await card.dblclick({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(2500)
  }
  check('进入项目', /projectId=/.test(win.url()), win.url().slice(-32))

  // —— ① 唯一门（studio 顶栏）——
  check('顶栏无素材盒按钮', (await win.locator('button[aria-label="打开素材盒"]').count()) === 0)
  await snap(win, '02-studio-topbar-no-assetbox')

  // 迁移器启动即跑（IPC 往返），稍候
  await win.waitForTimeout(1500)

  // —— ③ 迁移·文件夹：素材库「项目素材」tab 出现「主角参考」瓦片 ——
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-files-panel')))
  await win.waitForTimeout(900)
  const projectTab = win.locator('section[aria-label="素材库"] [role="tab"]', { hasText: '项目素材' }).first()
  if (await projectTab.count()) await projectTab.click({ timeout: 2000 }).catch(() => {})
  await win.waitForTimeout(900)
  const folderTile = win.locator('section[aria-label="素材库"] [aria-label="打开文件夹 主角参考"]').first()
  check('素材库出现迁移文件夹「主角参考」', (await folderTile.count()) > 0)
  await snap(win, '03-asset-library-folder-tile')
  if (await folderTile.count()) {
    await folderTile.click({ timeout: 2000 }).catch(() => {})
    await win.waitForTimeout(600)
    const backChip = win.locator('button[aria-label="返回全部项目素材"]').first()
    check('点入文件夹出现面包屑返回', (await backChip.count()) > 0)
    await snap(win, '04-inside-folder-breadcrumb')
    await backChip.click({ timeout: 2000 }).catch(() => {})
    await win.waitForTimeout(400)
  }

  // —— ⑤ 软删解散：全部素材 tab「曾被软删」照常可见 ——
  const allTab = win.locator('section[aria-label="素材库"] [role="tab"]', { hasText: '全部素材' }).first()
  if (await allTab.count()) await allTab.click({ timeout: 2000 }).catch(() => {})
  await win.waitForTimeout(900)
  // compact 侧栏格子不渲染文件名（tooltip 才有）,数瓦片：3 张落盘图（含「曾被软删.png」）全在=软删层解散。
  const allTileCount = await win.locator('section[aria-label="素材库"] [aria-selected]').count()
  check('三张落盘素材全部可见（含曾软删,软删层解散预期）', allTileCount >= 3, `tiles=${allTileCount}`)
  await snap(win, '05-asset-library-all-assets')

  // —— ② 迁移·提示词：侧栏提示词库出现旧卡 ——
  const promptRail = win.locator('button[aria-label="提示词库"]').first()
  if (await promptRail.count()) {
    await promptRail.click({ timeout: 2000 }).catch(() => {})
    await win.waitForTimeout(900)
    let cardVisible = (await win.getByText('赛博城市雨夜提示词', { exact: false }).count()) > 0
    if (!cardVisible) {
      const mineTab = win.locator('button,[role="tab"]', { hasText: '我的' }).first()
      if (await mineTab.count()) {
        await mineTab.click({ timeout: 2000 }).catch(() => {})
        await win.waitForTimeout(700)
        cardVisible = (await win.getByText('赛博城市雨夜提示词', { exact: false }).count()) > 0
      }
    }
    check('旧提示词卡迁入主提示词库可见', cardVisible)
    await snap(win, '06-prompt-library-migrated-card')
  } else {
    check('旧提示词卡迁入主提示词库可见', false, '未找到侧栏提示词库入口')
  }

  // —— ④ 托盘瘦身：浏览器伴生素材盒=捕捞收件箱 ——
  const browserButton = win.locator('button[aria-label="打开浏览器"]').first()
  await browserButton.click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(2200)
  const trayButton = win.locator('button[aria-label*="素材盒"]').last()
  check('浏览器工具条素材盒按钮在（唯一入口）', (await trayButton.count()) > 0)
  if (await trayButton.count()) await trayButton.click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(1800)
  const overlayWin = app.windows().find((p) => p.url().includes('nomiOverlay=browserAsset'))
  check('托盘 overlay 独立窗在', Boolean(overlayWin))
  if (overlayWin) {
    await overlayWin.waitForLoadState('domcontentloaded').catch(() => {})
    await overlayWin.waitForTimeout(900)
    check('托盘无「提示词库」tab', (await overlayWin.getByText('提示词库', { exact: true }).count()) === 0)
    check('托盘无「上传」按钮', (await overlayWin.locator('button[aria-label*="上传"]').count()) === 0)
    check('托盘无文件夹瓦片', (await overlayWin.getByText('主角参考', { exact: false }).count()) === 0)
    check('托盘标注「捕捞收件箱」', (await overlayWin.getByText('捕捞收件箱', { exact: false }).count()) > 0)
    check('托盘可见捕捞素材', (await overlayWin.getByText('捕捞样例一', { exact: false }).count()) > 0)
    await snap(overlayWin, '07-tray-capture-inbox')
  }
  await snap(win, '08-studio-with-browser')

  const failed = results.filter((item) => !item.ok)
  console.log(`\n== 素材面收敛验收: ${results.length - failed.length}/${results.length} PASS ==`)
  fs.writeFileSync(path.join(shotsDir, 'results.json'), JSON.stringify(results, null, 2))
  if (failed.length) process.exitCode = 1
} finally {
  if (app) {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]).catch(() => {})
    process.exit(process.exitCode ?? 0)
  }
}
