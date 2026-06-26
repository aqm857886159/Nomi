// R13 走查：① 连线进来的参考图出现在「@」候选里（Round 1 单源修复）② 裂图 → 可读「加载失败」占位。
// 用法: node tests/ux/at-mention-edge.walk.mjs
// 隔离 userData + 临时 NOMI_PROJECT_ROOT（构造一个含场景的项目，不碰用户真实数据）。
// 产出: tests/ux/shots/at-mention/*.png —— 人眼判断：@ 下拉里有那张连线图、broken 图显示「加载失败」。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/at-mention')
fs.mkdirSync(shotsDir, { recursive: true })

const base = '/tmp/nomi-atmention'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })

// —— 构造项目：working 图(data URL,能加载) 连线 → omni 视频节点；broken 图(坏 nomi-local url) 验占位 ——
const projectId = 'walk-atmention-0001'
const projDir = path.join(projectsDir, `at-mention-walk-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
// 真 1x1 png 落到项目 assets（同项目可达的 nomi-local，绕开内嵌 data URL 触发 manifest 媒体瘦身）。
const RED_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
fs.mkdirSync(path.join(projDir, 'assets', 'imported'), { recursive: true })
fs.writeFileSync(path.join(projDir, 'assets', 'imported', 'good.png'), Buffer.from(RED_PNG_B64, 'base64'))
const RED_DOT = `nomi-local://asset/${projectId}/assets/imported/good.png`
const imgGood = {
  id: 'gen-v2-image-good', kind: 'image', title: '角色图（连线来源）',
  position: { x: 120, y: 380 }, size: { width: 300, height: 240 }, prompt: '',
  references: [], history: [], status: 'success', categoryId: 'shots', shotIndex: 1, renderKind: 'shot-frame',
  result: { id: 'r-good', type: 'image', url: RED_DOT, createdAt: 1 },
  meta: { source: 'asset-upload' },
}
const imgBad = {
  id: 'gen-v2-image-bad', kind: 'image', title: '坏图（验占位）',
  position: { x: 120, y: 80 }, size: { width: 300, height: 240 }, prompt: '',
  references: [], history: [], status: 'success', categoryId: 'shots', shotIndex: 2, renderKind: 'shot-frame',
  result: { id: 'r-bad', type: 'image', url: `nomi-local://asset/${projectId}/assets/imported/nonexistent.png`, createdAt: 1 },
  meta: { source: 'asset-upload' },
}
const video = {
  id: 'gen-v2-video-omni', kind: 'video', title: '镜头（全能参考）',
  position: { x: 560, y: 200 }, size: { width: 360, height: 280 }, prompt: '',
  references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: 3, renderKind: 'shot-frame',
  meta: {
    modelKey: 'doubao-seedance-2.0', modelLabel: 'Seedance 2.0', modelVendor: 'apimart',
    archetype: { id: 'seedance-2-apimart', modeId: 'omni' },
    size: '16:9', resolution: '720p', duration: 5, generate_audio: true,
  },
}
const project = {
  id: projectId, name: '@候选连线图走查', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  payload: {
    workbenchDocument: null, timeline: null,
    generationCanvas: {
      nodes: [imgBad, imgGood, video],
      edges: [{ id: 'edge-good-to-video', source: imgGood.id, target: video.id }],
      selectedNodeIds: [], groups: [],
    },
    categories: [{ id: 'shots', label: '分镜' }],
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
// 顶层 project.json（legacy 发现入口，discoverLegacyProjectsOnce 扫它注册）+ .nomi/project.json（workspace）。
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

let n = 0
const snap = async (win, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${settingsDir}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_SETTINGS_DIR: settingsDir, NOMI_PROJECTS_DIR: projectsDir },
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
})
await win.reload()
await win.waitForTimeout(1500)
for (let i = 0; i < 6; i++) {
  const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(350)
}
await snap(win, 'library')

// 打开构造的项目：多策略（继续创作 / 双击卡 / 文件夹图标），进画布判据=DOM 出现「生成方式/全能参考/导出」。
const card = win.getByText('@候选连线图走查', { exact: false }).first()
console.log('  project card count:', await card.count())
const inCanvas = async () => win.evaluate(() => /生成方式|全能参考|导出|时间轴|预览/.test(document.body.innerText) && !/Nomi 项目库|新建空白项目/.test(document.body.innerText))
if (await card.count()) {
  await card.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(400)
  for (const [how, act] of [
    ['继续创作', async () => { const b = win.getByText('继续创作', { exact: false }).first(); if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {}) }],
    ['dblclick-card', async () => { await card.dblclick({ timeout: 3000 }).catch(() => {}) }],
  ]) {
    await act()
    await win.waitForTimeout(2500)
    if (await inCanvas()) { console.log(`  → 进画布 via ${how}`); break }
    console.log(`  ✗ 仍在库 after ${how}`)
  }
}
console.log('  body head:', (await win.evaluate(() => document.body.innerText.slice(0, 120))).replace(/\n/g, ' '))
await win.keyboard.press('Escape').catch(() => {})
await snap(win, 'canvas-with-broken-and-good')

// 验占位：DOM 里应出现「加载失败」（broken 图节点）
const hasFailedPlaceholder = await win.evaluate(() => document.body.innerText.includes('加载失败'))
console.log(`  → DOM 含「加载失败」占位 = ${hasFailedPlaceholder}`)

// 选中 omni 视频节点（按坐标点几处覆盖标题区），等 composer 出现
const vp = win.viewportSize() || { width: 1200, height: 800 }
let composerOpen = false
for (const [fx, fy, name] of [[0.46, 0.30, 'a'], [0.52, 0.30, 'b'], [0.49, 0.34, 'c'], [0.55, 0.40, 'd']]) {
  await win.mouse.click(Math.round(vp.width * fx), Math.round(vp.height * fy)).catch(() => {})
  await win.waitForTimeout(700)
  composerOpen = await win.evaluate(() => document.body.innerText.includes('全能参考') || document.body.innerText.includes('生成方式'))
  console.log(`  click ${name} → composer(含「全能参考/生成方式」)=${composerOpen}`)
  if (composerOpen) break
}
await snap(win, 'video-node-selected')

// 聚焦 prompt 编辑器，输入 @ 唤起候选
const editor = win.locator('[contenteditable="true"]').first()
console.log('  contenteditable count:', await editor.count())
if (await editor.count()) {
  await editor.click({ timeout: 3000 }).catch((e) => console.log('editor click err', e.message))
  await win.waitForTimeout(400)
  await win.keyboard.type('@', { delay: 60 })
  await win.waitForTimeout(900)
}
await snap(win, 'at-mention-dropdown')

// 候选下拉是否出现（AssetMentionSuggestionList 渲染到 body）
const dropdownInfo = await win.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll('body > div img, body > div [role="option"] img'))
  // 找渲染到 body 顶层的浮层（fixed, zIndex 60）
  const floats = Array.from(document.querySelectorAll('body > div')).filter((d) => {
    const s = getComputedStyle(d)
    return s.position === 'fixed' && Number(s.zIndex) >= 50
  })
  return { topLevelImgCount: imgs.length, floatCount: floats.length }
})
console.log('  → @ 浮层信息:', JSON.stringify(dropdownInfo))

await app.close()
console.log(`\n截图在 ${shotsDir}`)
