// R13 走查：① 视频节点可按名称 @ 并建立真实 video_ref 边 ② 裂图 → 可读「加载失败」占位。
// 用法: node tests/ux/at-mention-edge.walk.mjs
// 隔离 userData + 临时 NOMI_PROJECT_ROOT（构造一个含场景的项目，不碰用户真实数据）。
// 产出: tests/ux/shots/at-mention/*.png —— 人眼判断：视频候选/视频1 chip、broken 图「加载失败」。
import { launchNomiApp } from './_launchApp.mjs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

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
const videoFileName = 'drone-reference.mp4'
const videoFilePath = path.join(projDir, 'assets', 'imported', videoFileName)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const encodedVideo = spawnSync(ffmpegPath, [
  '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x180:rate=12',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoFilePath,
], { timeout: 120_000 })
if (encodedVideo.status !== 0) throw new Error(`视频夹具编码失败: ${encodedVideo.stderr?.toString().slice(-500)}`)
const VIDEO_URL = `nomi-local://asset/${projectId}/assets/imported/${videoFileName}`
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
const videoSource = {
  id: 'gen-v2-video-source', kind: 'video', title: 'drone reference',
  position: { x: 120, y: 680 }, size: { width: 300, height: 240 }, prompt: '',
  references: [], history: [], status: 'success', categoryId: 'shots', shotIndex: 3, renderKind: 'shot-frame',
  result: { id: 'r-video-source', type: 'video', url: VIDEO_URL, createdAt: 1 },
  meta: { source: 'asset-upload', fileName: videoFileName },
}
const videoTarget = {
  id: 'gen-v2-video-omni', kind: 'video', title: '镜头（全能参考）',
  position: { x: 560, y: 200 }, size: { width: 360, height: 280 }, prompt: '',
  references: [], history: [], status: 'idle', categoryId: 'shots', shotIndex: 4, renderKind: 'shot-frame',
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
      nodes: [imgBad, imgGood, videoSource, videoTarget],
      edges: [{ id: 'edge-good-to-video', source: imgGood.id, target: videoTarget.id }],
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
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const snap = async (win, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

const { app, win } = await launchNomiApp({
  name: 'at-mention-edge',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
})
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
})
await win.reload()
await win.locator('[data-project-card="true"]').first().waitFor({ state: 'visible', timeout: 15_000 })
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
const inCanvas = async () => win.locator('.generation-canvas-v2__stage').first().isVisible().catch(() => false)
if (await card.count()) {
  // 项目名区域单击按设计只用于改名；从卡片 hover 层点「继续创作」才是稳定打开入口。
  const projectCard = win.locator('[data-project-card="true"]', { hasText: '@候选连线图走查' }).first()
  await projectCard.hover({ timeout: 4000 }).catch(() => {})
  const continueButton = projectCard.getByRole('button', { name: /继续创作/ }).first()
  if (await continueButton.count()) await continueButton.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(2500)
  console.log(`  → 进画布 via 继续创作: ${await inCanvas()}`)
}
console.log('  current url:', win.url())
await win.keyboard.press('Escape').catch(() => {})
await snap(win, 'canvas-with-broken-and-good')

// 验占位：DOM 里应出现「加载失败」（broken 图节点）
const hasFailedPlaceholder = await win.getByText('加载失败', { exact: false }).first().isVisible().catch(() => false)
check('坏图显示「加载失败」占位', hasFailedPlaceholder)

// 选中 omni 视频节点（按坐标点几处覆盖标题区），等 composer 出现
const vp = win.viewportSize() || { width: 1200, height: 800 }
let composerOpen = false
for (const [fx, fy, name] of [[0.46, 0.30, 'a'], [0.52, 0.30, 'b'], [0.49, 0.34, 'c'], [0.55, 0.40, 'd']]) {
  await win.mouse.click(Math.round(vp.width * fx), Math.round(vp.height * fy)).catch(() => {})
  await win.waitForTimeout(700)
  composerOpen = await win.getByText(/全能参考|生成方式/).first().isVisible().catch(() => false)
  console.log(`  click ${name} → composer(含「全能参考/生成方式」)=${composerOpen}`)
  if (composerOpen) break
}
await snap(win, 'video-node-selected')

// 聚焦 prompt 编辑器，输入视频名片段 @dr 唤起并过滤候选。
const editor = win.locator('[contenteditable="true"]').first()
console.log('  contenteditable count:', await editor.count())
if (await editor.count()) {
  await editor.click({ timeout: 3000 }).catch((e) => console.log('editor click err', e.message))
  await win.waitForTimeout(400)
  await win.keyboard.type('@dr', { delay: 60 })
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
  const mentionItems = Array.from(document.querySelectorAll('[data-mention-item]')).map((el) => ({
    label: el.getAttribute('aria-label'),
    kind: el.getAttribute('data-mention-kind'),
  }))
  return { topLevelImgCount: imgs.length, floatCount: floats.length, mentionItems }
})
console.log('  → @ 浮层信息:', JSON.stringify(dropdownInfo))
const videoMention = dropdownInfo.mentionItems.find((item) => item.kind === 'video')
check('可按视频节点标题过滤出视频候选', videoMention?.label === 'drone reference', JSON.stringify(videoMention))

// 选择候选后必须建立真实 video_ref 边，并插入 1-based 的「视频1」chip。
const edgesBefore = await win.locator('.generation-canvas-v2__edge-path').count()
const videoOption = win.locator('[data-mention-item][data-mention-kind="video"]', { hasText: 'drone reference' }).first()
if (await videoOption.count()) await videoOption.click({ timeout: 5000 }).catch(() => {})
await win.waitForTimeout(1800)
const selectedState = await win.evaluate(() => ({
  edgeCount: document.querySelectorAll('.generation-canvas-v2__edge-path').length,
  chips: Array.from(document.querySelectorAll('[data-asset-mention]')).map((el) => ({
    text: el.textContent?.trim() ?? '',
    label: el.getAttribute('aria-label'),
  })),
}))
console.log('  → 选择视频后:', JSON.stringify(selectedState))
check('选择视频候选后新增真实参考边', selectedState.edgeCount === edgesBefore + 1, `${edgesBefore} → ${selectedState.edgeCount}`)
check('首个视频引用 chip 显示「视频1」', selectedState.chips.some((chip) => chip.text === '视频1' && chip.label === '视频1'), JSON.stringify(selectedState.chips))
await snap(win, 'video-mention-selected')

await app.close()
console.log(`\n截图在 ${shotsDir}`)
if (failures.length) {
  console.error(`\n❌ ${failures.length} 条不达标:\n - ${failures.join('\n - ')}`)
  process.exit(1)
}
console.log('\n✅ 全部达标')
