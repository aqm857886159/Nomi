// R13 走查（零额度）：空态「一键拼成初稿」提示行。
// 种一个「画布已有 3 个已出图镜头 + 空时间轴」的项目，开预览区 → 空时间轴应浮出提示行
// 「有 3 个镜头可拼成初稿 [一键拼成初稿]」；点它 → 镜头排进时间轴、提示行随即隐去（纯增益空态）。
// 不生成、不连模型 → 零额度。每步 screenshot 供人眼复核（眼见链）。
// 用法：pnpm run build && node tests/ux/arrange-draft-cta.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/arrange-cta')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-arrangecta-'))
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

// 3 个「已出图」的图片镜头（result.url 非空即算可拼；用 data-URI 彩块让缩略图也能真渲）。
const swatch = (c) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="${c}"/></svg>`)
const COLORS = ['#4a7fe0', '#00a886', '#c56b3c']
const nodes = COLORS.map((c, i) => ({
  id: `shot-${i + 1}`,
  kind: 'image',
  title: `镜头 ${i + 1}`,
  position: { x: 40 + i * 240, y: 80 },
  categoryId: 'shots',
  shotIndex: i + 1,
  result: { id: `shot-${i + 1}-r`, type: 'image', url: swatch(c) },
}))

const projectId = 'arrangecta-0001'
const projDir = path.join(projectsDir, `arrangecta-${projectId}`)
fs.mkdirSync(projDir, { recursive: true })
// 只写顶层 project.json（不写 .nomi/ → 走 legacy 目录发现被正确迁移+列出；写了无效 .nomi
// 反而会让发现直接 skip，无回退——首跑踩过）。启动时 listProjects 扫 NOMI_PROJECTS_DIR 找到它。
const project = {
  id: projectId, name: '拼成初稿·空态提示', version: 1,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  payload: {
    workbenchDocument: { version: 1, title: '拼成初稿·空态提示', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
    timeline: null, // 空时间轴 → 提示行应出现
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))

let n = 0
const snap = async (win, name) => {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) }).catch((e) => console.log(`  (snap ${tag} failed: ${e.message})`))
  console.log(`  · shot ${tag}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { app, win } = await launchNomiApp({
  name: 'arrange-draft-cta',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--disable-gpu', '--disable-software-rasterizer'],
  env: { NOMI_CAPABILITY_DIR: path.join(settingsDir, 'capability-core') },
  timeout: 300000,
})

let exitCode = 0
try {
  win.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)))
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await sleep(1500)
  for (let i = 0; i < 6; i++) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1000 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await sleep(300)
  }
  await snap(win, 'library')

  // 打开项目：hover 卡片 → 点「继续创作」按钮（悬停才露出；直接点卡片会命中标题进重命名态）
  const inProject = async () => win.evaluate(() => !/Nomi 项目库|新建空白项目/.test(document.body.innerText))
  const card = win.getByText('拼成初稿·空态提示', { exact: false }).first()
  if (await card.count()) {
    await card.hover().catch(() => {})
    await sleep(600)
    const continueBtn = win.locator('button,[role="button"]', { hasText: /继续创作/ }).first()
    if (await continueBtn.count()) { await continueBtn.click({ timeout: 3000 }).catch(() => {}); await sleep(2500) }
    if (!(await inProject())) { await card.dblclick({ force: true, timeout: 3000 }).catch(() => {}); await sleep(2500) }
  }
  if (!(await inProject())) { await snap(win, 'cannot-open'); throw new Error('打不开项目') }

  // 切到预览区（空时间轴 + 工具条 + 左侧素材面板）
  const previewTab = win.locator('button,[role="button"]', { hasText: /^预览$/ }).first()
  if (await previewTab.count()) { await previewTab.click({ timeout: 3000 }).catch(() => {}); await sleep(2500) }
  await snap(win, 'preview-empty-with-cta')

  const readCta = () => win.evaluate(() => {
    const el = document.querySelector('[data-testid="timeline-arrange-cta"]')
    if (!el) return { present: false }
    const btn = el.querySelector('button')
    return { present: true, text: el.innerText.replace(/\s+/g, ' ').trim(), btnText: (btn?.innerText || '').trim() }
  })

  const cta1 = await readCta()
  console.log('  预览空态 CTA：', JSON.stringify(cta1))
  if (!cta1.present) throw new Error('空时间轴没出现「拼成初稿」提示行（看 preview-empty-with-cta 截图）')
  if (!/有\s*3\s*个镜头可拼成初稿/.test(cta1.text)) throw new Error(`CTA 文案/数量不对：${cta1.text}`)

  // 点「一键拼成初稿」→ 镜头排进时间轴、CTA 随即隐去
  const arrangeBtn = win.locator('[data-testid="timeline-arrange-cta"] button').first()
  console.log('  CTA 按钮 count:', await arrangeBtn.count())
  await arrangeBtn.click({ timeout: 3000 }).catch(() => {})
  await sleep(3000)
  await snap(win, 'after-arrange-cta-gone')

  const cta2 = await readCta()
  console.log('  排片后 CTA：', JSON.stringify(cta2))
  const clipCount = await win.evaluate(() => document.querySelectorAll('.workbench-timeline [data-testid="timeline-clip"], .workbench-timeline .workbench-timeline-clip').length)
  const trackCounts = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.workbench-timeline-track__count')).map((e) => e.textContent?.trim()))
  console.log('  时间轴片段数(DOM):', clipCount, ' 轨道计数:', JSON.stringify(trackCounts))

  const ctaGone = cta2.present === false
  const hasClips = clipCount > 0 || trackCounts.some((c) => c && c !== '0')
  console.log(`\n═══ ARRANGE-CTA：空态提示行=${cta1.present ? '✓' : '✗'}(${cta1.text}) · 点击后隐去=${ctaGone ? '✓' : '✗'} · 镜头进轨=${hasClips ? '✓' : '✗'} ═══`)
  console.log(`  截图 → ${shotsDir}（人眼复核）`)
  if (!ctaGone || !hasClips) exitCode = 1
} catch (err) {
  console.log(`✗ ${err?.message || err}`)
  exitCode = 1
} finally {
  await app.close().catch(() => undefined)
  process.exit(exitCode)
}
