// R13 走查：素材库跨项目视频封面 + 全部素材预览 + 预览页点击入轨。
//
// 复现条件必须是两个项目：旧实现会拿「当前项目 id」解析另一个项目的视频，
// 主进程因此拒绝路径，所有跨项目视频卡最终都只剩同一块空底色。
// 本走查用本地 ffmpeg 造两支肉眼可区分的真 MP4，全程零生成额度。
//
// 用法：pnpm run build && node tests/ux/asset-video-preview.walk.mjs
// 产出：tests/ux/shots/asset-video-preview/*.png
import { launchNomiApp } from './_launchApp.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-asset-video-preview-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const shotsDir = path.join(repoRoot, 'tests', 'ux', 'shots', 'asset-video-preview')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
function encodeVideo(output, color, accent) {
  const filter = [
    `color=c=${color}:s=640x360:d=2:r=24`,
    `drawbox=x=54:y=54:w=230:h=252:color=white:t=fill`,
    `drawbox=x=326:y=88:w=260:h=86:color=${accent}:t=fill`,
    'drawbox=x=326:y=208:w=178:h=72:color=black@0.62:t=fill',
  ].join(',')
  const run = spawnSync(ffmpegPath, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', filter,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
  ], { timeout: 120_000 })
  if (run.status !== 0) throw new Error(`视频夹具编码失败: ${run.stderr?.toString().slice(-500)}`)
}

function seedProject({ id, name, folder, videoName, color, accent, updatedAt }) {
  const projectRoot = path.join(projectsDir, folder)
  const importedDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(importedDir, { recursive: true })
  encodeVideo(path.join(importedDir, videoName), color, accent)

  const generationCanvas = {
    nodes: [], edges: [], selectedNodeIds: [], groups: [],
    canvasZoom: 1, canvasPan: { x: 0, y: 0 },
  }
  const payload = {
    workbenchDocument: null,
    timeline: null,
    generationCanvas,
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  }
  const project = {
    id, name, version: 2,
    createdAt: updatedAt, updatedAt, savedAt: updatedAt, revision: 1,
    lastKnownRootPath: projectRoot,
    workbenchDocument: null, timeline: null, generationCanvas, payload,
  }
  fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))
  return projectRoot
}

const foreignVideoName = '跨项目-绿白.mp4'
const currentVideoName = '当前项目-蓝黄.mp4'
const foreignRoot = seedProject({
  id: 'asset-video-foreign',
  name: '素材视频来源项目',
  folder: 'asset-video-foreign',
  videoName: foreignVideoName,
  color: '0x2E6E6B',
  accent: '0xF0C75E',
  updatedAt: 1,
})
seedProject({
  id: 'asset-video-current',
  name: '素材视频验收项目',
  folder: 'asset-video-current',
  videoName: currentVideoName,
  color: '0x315A9A',
  accent: '0xF6D55C',
  updatedAt: 2,
})

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

let app
try {
  let win
  ;({ app, win } = await launchNomiApp({
    name: 'asset-video-preview',
    userDataDir: settingsDir,
    settingsDir,
    projectsDir,
    args: ['--no-proxy-server'],
    settleMs: 1800,
  }))
  const getWin = () => {
    const live = app.windows().filter((page) => !page.isClosed())
    win = live.find((page) => /projectId=/.test(page.url())) || live[live.length - 1] || win
    return win
  }
  const screenshot = async (name) => {
    await screenshotSettled(getWin(), { path: path.join(shotsDir, name) })
    console.log(`  · 截图 ${name}`)
  }
  const findAssetCard = (name) => getWin().getByRole('button', { name, exact: true }).first()
  const waitForRealCover = async (card) => {
    await card.waitFor({ state: 'visible', timeout: 20_000 })
    await card.evaluate((element) => new Promise((resolve, reject) => {
      const deadline = Date.now() + 30_000
      const poll = () => {
        const cover = [...element.querySelectorAll('div')].find((node) => getComputedStyle(node).backgroundImage !== 'none')
        if (cover) return resolve(true)
        if (Date.now() >= deadline) return reject(new Error('30 秒内未生成视频封面'))
        setTimeout(poll, 200)
      }
      poll()
    }))
    return card.evaluate((element) => {
      const cover = [...element.querySelectorAll('div')].find((node) => getComputedStyle(node).backgroundImage !== 'none')
      if (!cover) return null
      const style = getComputedStyle(cover)
      return { image: style.backgroundImage, size: style.backgroundSize, width: cover.clientWidth, height: cover.clientHeight }
    })
  }

  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(1800)

  const currentProjectCard = win.locator('[data-project-card="true"]', { hasText: '素材视频验收项目' }).first()
  await currentProjectCard.waitFor({ state: 'visible', timeout: 20_000 })
  await currentProjectCard.dblclick({ timeout: 5000 })
  await win.waitForTimeout(2600)
  const continueButton = getWin().getByRole('button', { name: /继续创作/ }).first()
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click()
    await getWin().waitForTimeout(1800)
  }
  check('进入第二个项目作为当前项目', /projectId=asset-video-current/.test(getWin().url()), getWin().url())

  // ① 生成页素材库：跨项目视频必须有真实封面；全部素材单击必须能打开视频预览。
  await getWin().getByRole('button', { name: /生成/ }).first().click({ timeout: 5000 })
  await getWin().waitForTimeout(900)
  await getWin().evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-files-panel')))
  await getWin().waitForTimeout(1000)
  const allAssetsTab = getWin().getByRole('tab', { name: /全部素材/ }).first()
  if (await allAssetsTab.isVisible().catch(() => false)) await allAssetsTab.click()

  const foreignCard = findAssetCard(foreignVideoName)
  const currentCard = findAssetCard(currentVideoName)
  const foreignCover = await waitForRealCover(foreignCard)
  const currentCover = await waitForRealCover(currentCard)
  check('跨项目视频卡出现真实胶片封面', Boolean(foreignCover?.image?.includes('nomi-local')), JSON.stringify(foreignCover))
  check('当前项目视频卡也出现真实胶片封面', Boolean(currentCover?.image?.includes('nomi-local')), JSON.stringify(currentCover))
  check(
    '胶片缓存写回视频所属项目（没有误写当前项目）',
    fs.existsSync(path.join(foreignRoot, '.nomi', 'cache', 'filmstrip')),
  )
  await screenshot('01-all-assets-video-covers.png')

  await foreignCard.click()
  const preview = getWin().getByRole('dialog', { name: new RegExp(foreignVideoName.replace('.', '\\.')) }).first()
  await preview.waitFor({ state: 'visible', timeout: 5000 })
  const previewVideo = preview.locator('video').first()
  await getWin().waitForFunction((name) => {
    const video = document.querySelector(`video[aria-label="${name}"]`)
    return Boolean(video && video.readyState >= 2 && video.videoWidth > 0)
  }, foreignVideoName, { timeout: 20_000 })
  const previewState = await previewVideo.evaluate((video) => ({
    readyState: video.readyState,
    width: video.videoWidth,
    src: video.currentSrc,
  }))
  check('全部素材单击打开可播放视频预览', previewState.readyState >= 2 && previewState.width > 0, JSON.stringify(previewState))
  await screenshot('02-all-assets-click-preview.png')
  await getWin().keyboard.press('Escape')
  await getWin().keyboard.press('Escape')
  await getWin().waitForTimeout(700)

  // ② 预览页素材栏：单击同一素材直接加到匹配轨道，不再是无效果的“选中”。
  await getWin().getByRole('button', { name: /预览/ }).first().click({ timeout: 5000 })
  await getWin().waitForTimeout(1800)
  const assetsSourceTab = getWin().getByRole('tab', { name: /^素材$/ }).first()
  await assetsSourceTab.click({ timeout: 5000 })
  await getWin().waitForTimeout(1000)
  const previewForeignCard = findAssetCard(foreignVideoName)
  await waitForRealCover(previewForeignCard)
  const beforeClips = await getWin().locator('[data-testid="timeline-clip"]').count()
  await previewForeignCard.click()
  await getWin().waitForTimeout(1300)
  const afterClips = await getWin().locator('[data-testid="timeline-clip"]').count()
  check('预览页单击视频素材后时间轴新增片段', afterClips > beforeClips, `${beforeClips} → ${afterClips}`)
  await screenshot('03-preview-click-adds-video-to-timeline.png')

  const failed = results.filter((result) => !result.ok)
  fs.writeFileSync(path.join(shotsDir, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`\n== 素材视频验收：${results.length - failed.length}/${results.length} PASS ==`)
  if (failed.length > 0) process.exitCode = 1
} catch (error) {
  console.error('走查失败:', error)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => {})
}
