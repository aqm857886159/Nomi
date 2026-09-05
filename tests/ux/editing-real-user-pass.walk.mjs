#!/usr/bin/env node
// 收官 A · R13/R16 走查：一个人要做一支 15 秒短片，全程只用剪辑面**手工**剪。
//
// 这条走查跟已有几条的分工（别互相重复）：
//  · editing-panel-system.walk.mjs —— 面板系统的几何与四态（拖/收/预设）
//  · agent-timeline-ops.walk.mjs   —— 让 Nomi 改时间轴的 propose→apply→undo 闭环
//  · 本条                          —— 人自己动手的那一段：拼片 → 转场 → 属性 → 右键 →
//                                     字幕 → 配乐 → 快捷键 → 导出，最后用 ffprobe/ffmpeg
//                                     验成片（尺寸、时长、音轨、接缝真的混合了）。
//
// 零额度：素材是本机 ffmpeg 现造的纯色片与正弦音，画布节点按「已出片」预置，全程不触发生成。
// 隔离 profile（docs/lessons/walkthrough-default-profile-is-isolated.md）。
// Run: pnpm run build && node tests/ux/editing-real-user-pass.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, expectVisible, proveProbe, expectAbsent, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'

const require = createRequire(import.meta.url)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const ffprobePath = require('@ffprobe-installer/ffprobe').path

const shotsDir = path.join(repoRoot, 'tests/ux/shots/editing-real-user-pass')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-editing-real-user-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'editing-real-user-pass'
const projectName = '收官 A · 十五秒短片'
const projectRoot = path.join(projectsDir, projectId)
const importedDir = path.join(projectRoot, 'assets', 'imported')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(importedDir, { recursive: true })

// ── 素材：三段纯色片（颜色差得越开，接缝混合帧越好判）+ 一段正弦音当配乐 ──────────────
const SHOTS = [
  { file: 'shot-1.mp4', label: '推门远景', color: '0xE03A2F', rgb: [224, 58, 47] },
  { file: 'shot-2.mp4', label: '推门近景', color: '0x1B6BCF', rgb: [27, 107, 207] },
  { file: 'shot-3.mp4', label: '眼神反应', color: '0x14A06A', rgb: [20, 160, 106] },
]
const CLIP_SECONDS = 5
for (const shot of SHOTS) {
  execFileSync(ffmpegPath, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${shot.color}:s=640x360:r=30`,
    '-t', String(CLIP_SECONDS), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(importedDir, shot.file),
  ], { timeout: 120_000 })
}
const MUSIC_FILE = 'bgm.mp3'
execFileSync(ffmpegPath, [
  '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
  '-t', '15', '-q:a', '4', path.join(importedDir, MUSIC_FILE),
], { timeout: 120_000 })

const assetUrl = (file) => `nomi-local://asset/${encodeURIComponent(projectId)}/assets/imported/${encodeURIComponent(file)}`
const STORYBOARD_DESIGN_ID = 'design-closing-a'

const nodes = SHOTS.map((shot, index) => ({
  id: `shot-node-${index + 1}`,
  kind: 'video',
  categoryId: 'shots',
  title: shot.label,
  prompt: shot.label,
  shotIndex: index + 1,
  position: { x: 120 + index * 320, y: 120 },
  status: 'success',
  meta: { storyboardDesignId: STORYBOARD_DESIGN_ID },
  result: { id: `shot-result-${index + 1}`, type: 'video', url: assetUrl(shot.file), createdAt: 1, durationSeconds: CLIP_SECONDS },
}))

const timeline = {
  version: 1,
  fps: 30,
  scale: 1.5,
  playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    { id: 'videoTrack', type: 'video', label: '视频轨', clips: [] },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [],
  transitions: [],
}
const workbenchDocument = { version: 1, title: projectName, updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const generationCanvas = { nodes, edges: [], selectedNodeIds: [], groups: [] }
const payload = { workbenchDocument, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId, name: projectName, version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot, workbenchDocument, timeline, generationCanvas, payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

// ── 判据与情绪摩擦日志 ────────────────────────────────────────────────────────────
const verdicts = []
const friction = []
const check = (name, ok, detail = '') => {
  verdicts.push([name, ok, detail])
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
/** 情绪摩擦：不是断言，是「这一步舒不舒服」的人话记录，最后连同截图一起交付。 */
const note = (step, feeling) => { friction.push([step, feeling]); console.log(`  · 「${step}」${feeling}`) }

const launched = await launchNomiApp({
  name: 'editing-real-user-pass', userDataDir, settingsDir, projectsDir, capabilityDir, timeout: 300_000,
  env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
  args: ['--no-proxy-server'],
})
const { app } = launched
let win = launched.win
win.setDefaultTimeout(30_000)
win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))

async function snap(name) {
  await screenshotSettled(win, { path: path.join(shotsDir, `${name}.png`) })
}
async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => { windowRef.setBounds({ x: 0, y: 0, ...bounds }); windowRef.center() }, { width, height })
  await win.waitForTimeout(400)
}
/** 盘上那份时间轴（不是内存投影）。所有「真的改了吗」都问它。 */
async function persisted() {
  const record = await win.evaluate((id) => window.nomiDesktop.projects.readAsync(id), projectId)
  return record?.payload?.timeline ?? record?.timeline ?? { tracks: [], textClips: [], transitions: [] }
}
const videoClips = (state) => state.tracks.find((track) => track.id === 'videoTrack')?.clips ?? []

let failure
try {
  await win.evaluate(() => {
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload({ waitUntil: 'domcontentloaded' })
  await resize(1680, 1000)

  // ══ 第 1 步：打开项目，进剪辑面 ════════════════════════════════════════════════
  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
  await expectVisible(projectCard, '项目卡没出现')
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }).first(), `打开${projectName}`)
  await expect.poll(() => app.windows().some((candidate) => /[?&]projectId=/.test(candidate.url())),
    { message: '项目窗口没打开', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  win = app.windows().find((candidate) => /[?&]projectId=/.test(candidate.url())) ?? win
  win.setDefaultTimeout(30_000)
  await win.waitForLoadState('domcontentloaded')
  await resize(1680, 1000)
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), '进入预览')
  const timelinePanel = win.locator('.workbench-preview .workbench-timeline').first()
  await expectVisible(timelinePanel, '剪辑面时间轴没出现')
  await win.waitForTimeout(600)
  await snap('01-opened-empty-timeline')
  note('第一眼', '时间轴是空的，四条轨都在，空轨收成窄条不占地方——但要不要「先干什么」全靠自己猜，没有一句引导。')

  // ══ 第 2 步：空音频轨时，整片属性里的「配乐音量」必须是禁用+说明，而不是拖得动却没用 ══
  const inspector = win.locator('[aria-label="属性面板"]')
  await expectVisible(inspector, '属性面板没出现')
  const musicSlider = inspector.locator('[data-inspector-music-volume="true"]')
  await expectVisible(musicSlider, '整片态没有「配乐音量」')
  check('空音频轨时「配乐音量」禁用并说明为什么（不再是拖得动却不生效的死滑杆）',
    await musicSlider.isDisabled() && /还没有配乐/.test(await musicSlider.getAttribute('title') ?? ''),
    `disabled=${await musicSlider.isDisabled()} title=${await musicSlider.getAttribute('title')}`)

  // ══ 第 3 步：AI 拼片 —— 三个镜头按镜序落轨 ═══════════════════════════════════════
  await clickOrFail(timelinePanel.getByRole('button', { name: 'AI 拼片', exact: true }).first(), 'AI 拼片')
  await expect.poll(async () => videoClips(await persisted()).length,
    { message: 'AI 拼片没把镜头排进时间轴', timeout: DEFAULT_TIMEOUT_MS }).toBe(3)
  const arranged = videoClips(await persisted()).slice().sort((a, b) => a.startFrame - b.startFrame)
  check('AI 拼片按镜序排进三镜（推门远景 → 推门近景 → 眼神反应）',
    arranged.map((clip) => clip.label).join(' / ') === SHOTS.map((shot) => shot.label).join(' / '),
    arranged.map((clip) => clip.label).join(' / '))
  check('三镜首尾相接、总长 15 秒（3 × 5s）', arranged[0].startFrame === 0 && arranged[2].endFrame === 450,
    `${arranged.map((clip) => `${clip.startFrame}-${clip.endFrame}`).join(' ')}`)
  await snap('02-ai-arranged')
  note('AI 拼片', '一下就铺满了，收据 toast 带撤销，心里有底；但按钮只有一个魔杖图标，第一次真的不知道它会做什么。')

  // ══ 第 4 步：接缝加转场 → 改成淡入淡出 → 改时长 ══════════════════════════════════
  const clipA = arranged[0].id
  const clipB = arranged[1].id
  const seam = timelinePanel.locator(`[aria-label="${'添加默认叠化（15 帧）'}"]`).first()
  await seam.scrollIntoViewIfNeeded()
  await clickOrFail(seam, '在第 1、2 镜之间点「+」加转场')
  await expect.poll(async () => (await persisted()).transitions?.length ?? 0,
    { message: '接缝「+」没落下默认转场', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const firstTransition = (await persisted()).transitions[0]
  check('接缝「+」一下就落默认叠化 15 帧（不弹表单）',
    firstTransition.type === 'dissolve' && firstTransition.durationFrames === 15, JSON.stringify(firstTransition))

  const marker = timelinePanel.locator(`[data-timeline-transition][data-transition-from="${clipA}"][data-transition-to="${clipB}"]`).first()
  await clickOrFail(marker, '点开转场选择器')
  const picker = win.getByRole('dialog', { name: '转场' })
  await expectVisible(picker, '转场选择器没打开')
  await clickOrFail(picker.getByRole('button', { name: '淡入淡出', exact: true }), '改成淡入淡出')
  await expect.poll(async () => (await persisted()).transitions[0].type,
    { message: '转场类型没改成 fade', timeout: DEFAULT_TIMEOUT_MS }).toBe('fade')
  for (let i = 0; i < 3; i += 1) await clickOrFail(picker.getByRole('button', { name: '转场调短一帧' }), '把转场调短一帧')
  await expect.poll(async () => (await persisted()).transitions[0].durationFrames,
    { message: '转场时长没改到 12 帧', timeout: DEFAULT_TIMEOUT_MS }).toBe(12)
  check('转场选择器能改类型与时长，改动直接落盘', true, JSON.stringify((await persisted()).transitions[0]))
  await snap('03-transition-picker')
  await clickOrFail(picker.getByRole('button', { name: '关闭转场选择器' }), '关闭转场选择器')
  note('加转场', '悬停接缝才冒出「+」，第一次容易找不到；但落下之后标记上直接写着「12f」，改起来很直观。')

  // ══ 第 5 步：选中第 2 镜 → 属性面板改音量 / 淡出 / 画面 ════════════════════════════
  const clipTwo = timelinePanel.locator(`[data-clip-id="${clipB}"]`).first()
  await clickOrFail(clipTwo, '选中第 2 镜')
  await expect(inspector.locator('[data-testid="preview-inspector-object"]')).toHaveAttribute('data-object-type', 'video')
  const volumeInput = inspector.getByLabel('音量数值')
  const volumeInputCount = await volumeInput.count()
  const gainControl = volumeInputCount ? volumeInput : inspector.locator('input[type="number"]').first()
  await gainControl.fill('-6')
  await gainControl.blur()
  const fadeOut = inspector.locator('input[type="number"]').nth(volumeInputCount ? 2 : 2)
  await fadeOut.fill('0.50')
  await fadeOut.blur()
  await clickOrFail(inspector.getByRole('button', { name: '填充', exact: true }), '画面改成「填充」')
  await expect.poll(async () => {
    const clip = videoClips(await persisted()).find((item) => item.id === clipB)
    return JSON.stringify({ gainDb: clip?.audio?.gainDb ?? null, fadeOutFrames: clip?.audio?.fadeOutFrames ?? null, fit: clip?.framing?.fit ?? null })
  }, { message: '属性面板的音量 / 淡出 / 画面没有落盘', timeout: DEFAULT_TIMEOUT_MS })
    .toBe(JSON.stringify({ gainDb: -6, fadeOutFrames: 15, fit: 'cover' }))
  check('属性面板改音量 -6dB / 淡出 0.5s / 画面填充，三项都落盘', true)
  await snap('04-inspector-clip')
  note('改属性', '选中就出对应的组，不用去别处找；淡入淡出用秒不用帧，读得懂。')

  // ══ 第 6 步：属性面板的「转场 · 入 / 出」是真入口（原来是死按钮）═══════════════════
  const transitionIn = inspector.locator('[data-inspector-transition="in"]')
  const transitionOut = inspector.locator('[data-inspector-transition="out"]')
  check('属性面板「入场」显示这条接缝**现在**是什么转场，不再是死的「选择」',
    (await transitionIn.getAttribute('data-inspector-transition-state')) === 'connected'
      && /淡入淡出/.test((await transitionIn.innerText()).trim()), (await transitionIn.innerText()).trim())
  check('属性面板「出场」在还没有转场时是「加转场」而不是死按钮',
    (await transitionOut.getAttribute('data-inspector-transition-state')) === 'empty', await transitionOut.innerText())
  await clickOrFail(transitionOut, '从属性面板给第 2、3 镜之间加转场')
  await expect.poll(async () => (await persisted()).transitions?.length ?? 0,
    { message: '属性面板的「出场」按钮没有真的加上转场', timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
  check('从属性面板点「出场」真的在第 2、3 镜之间落了转场', true)
  note('属性面板转场', '两颗按钮上直接写着现在是什么转场，不用再回时间轴上找那个小标记。')

  // ══ 第 7 步：输入框 chip 说人话 ═══════════════════════════════════════════════════
  const chip = win.locator('[data-agent-timeline-selection="true"]').first()
  await expectVisible(chip, '选中片段后输入框没有出现 chip')
  const chipText = (await chip.innerText()).replace(/\s+/g, ' ').trim()
  check('输入框 chip 写「片段名 · 时码」，不再是 clipId / 轨道 id / 帧号 / revision 一串',
    chipText.includes('推门近景') && /\d:\d\d–\d:\d\d/.test(chipText) && !chipText.includes(clipB) && !chipText.includes('videoTrack'),
    chipText)
  check('工程串仍在 tooltip 与 data-* 上（排查不丢证据）',
    (await chip.getAttribute('title') ?? '').includes(clipB) && (await chip.getAttribute('data-track-id')) === 'videoTrack',
    `title=${await chip.getAttribute('title')}`)
  check('在别处改东西不会把这条没被碰过的选中片段误标成「已变更」',
    (await chip.getAttribute('data-stale')) === null, `data-stale=${await chip.getAttribute('data-stale')}`)
  await snap('05-selection-chip')
  note('跟 Nomi 说话', 'chip 一眼能认出指的是哪一段，之前那串 id 完全看不出来。')

  // ══ 第 8 步：快捷键面板说的键位，按下去要真的是那件事 ═════════════════════════════
  await clickOrFail(timelinePanel.getByRole('button', { name: '快捷键（?）' }).first(), '打开快捷键面板')
  const shortcuts = win.getByRole('dialog', { name: '快捷键' })
  await expectVisible(shortcuts, '快捷键面板没打开')
  const shortcutText = (await shortcuts.innerText()).replace(/\s+/g, ' ')
  check('快捷键面板列出吸附 N / 缩放 −＋0 / 收起 Nomi ⌘\\',
    /切换吸附 N/.test(shortcutText) && /− \/ ＋ \/ 0/.test(shortcutText) && /收起 \/ 展开 Nomi ⌘\\/.test(shortcutText), shortcutText)
  await snap('06-shortcuts')
  await win.keyboard.press('Escape')

  const snapButton = timelinePanel.getByRole('button', { name: '吸附', exact: true }).first()
  const snapBefore = (await snapButton.getAttribute('class') ?? '').includes('accent-soft')
  await win.keyboard.press('n')
  await win.waitForTimeout(200)
  const snapAfter = (await snapButton.getAttribute('class') ?? '').includes('accent-soft')
  check('按 N 真的翻了吸附（面板上写的就是 N）', snapBefore !== snapAfter, `${snapBefore} → ${snapAfter}`)
  await win.keyboard.press('n')

  const scaleBefore = (await persisted()).scale
  await win.keyboard.press('=')
  await win.waitForTimeout(250)
  const zoomed = await win.evaluate(() => document.querySelector('.workbench-timeline')?.style.getPropertyValue('--workbench-timeline-content-width') ?? '')
  await win.keyboard.press('0')
  await win.waitForTimeout(250)
  check('缩放键 ＋ / 0 真的绑上了（tooltip 上写了十几天的键位不再是假的）', zoomed.length > 0, `scaleBefore=${scaleBefore} width=${zoomed}`)

  // ⌘\ 归 Nomi：按一次面板收起、图标条出现，而吸附**不该**跟着一起翻
  const snapBeforeMeta = (await snapButton.getAttribute('class') ?? '').includes('accent-soft')
  await win.keyboard.press('Meta+\\')
  await win.waitForTimeout(500)
  const rail = win.locator('[data-testid="editing-surface-assistant"] .workbench-panel-rail')
  await expectVisible(rail, '⌘\\ 没有把 Nomi 收成图标条')
  check('⌘\\ 收起 Nomi 时不再顺手把吸附也翻掉（两个功能不再抢同一个键）',
    ((await snapButton.getAttribute('class') ?? '').includes('accent-soft')) === snapBeforeMeta)
  check('收起后叫回 Nomi 的入口只有右侧图标条一个，且带运行状态点',
    (await rail.count()) === 1 && (await rail.locator('[data-panel-rail-status="true"]').count()) === 1)
  const recallEntries = await win.evaluate(() => [...document.querySelectorAll('button, [role="button"]')]
    .filter((node) => node.getBoundingClientRect().width > 0)
    .map((node) => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''}`)
    .filter((name) => /展开 Nomi|叫回 Nomi/.test(name)).length)
  check('全屏上只有一个「叫回 Nomi」入口（旧的浮动胶囊已删）', recallEntries === 1, `count=${recallEntries}`)
  await snap('07-collapsed-single-entry')
  await win.keyboard.press('Meta+\\')
  await win.waitForTimeout(500)
  note('快捷键', '面板上写的键位现在按下去都真的是那件事了；之前 ⌘\\ 会同时翻吸附和收面板，完全不知道自己干了什么。')

  // ══ 第 9 步：右键菜单四件事（分割 / 涟漪删除 / 删左 / 删右）+ ⌘Z 还原 ═══════════════
  await clickOrFail(clipTwo, '重新选中第 2 镜')
  await clipTwo.click({ button: 'right' })
  const menu = win.locator('[role="menu"]').last()
  await expectVisible(menu, '片段右键菜单没打开')
  const menuText = (await menu.innerText()).replace(/\s+/g, ' ')
  check('片段右键 8 项全是动词，涟漪删除写 ⇧⌫', /涟漪删除 ⇧⌫/.test(menuText), menuText)
  await clickOrFail(menu.getByRole('menuitem', { name: /涟漪删除/ }), '涟漪删除第 2 镜')
  await expect.poll(async () => videoClips(await persisted()).length,
    { message: '涟漪删除没生效', timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
  const rippled = videoClips(await persisted()).slice().sort((a, b) => a.startFrame - b.startFrame)
  check('涟漪删除把后面的镜头前移补空（不是留个洞）', rippled[1].startFrame === rippled[0].endFrame,
    rippled.map((clip) => `${clip.startFrame}-${clip.endFrame}`).join(' '))
  await win.keyboard.press('Meta+z')
  await expect.poll(async () => videoClips(await persisted()).length,
    { message: '一次 ⌘Z 没把涟漪删除还原', timeout: DEFAULT_TIMEOUT_MS }).toBe(3)
  check('一次 ⌘Z 就把涟漪删除整个还原', true)

  // ⇧⌫ 现在必须**真的**是涟漪删除（以前它只是普通删除，留个洞）
  await clickOrFail(timelinePanel.locator(`[data-clip-id="${clipB}"]`).first(), '再选中第 2 镜')
  await win.keyboard.press('Shift+Backspace')
  await expect.poll(async () => videoClips(await persisted()).length,
    { message: '⇧⌫ 没删掉片段', timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
  const afterShiftDelete = videoClips(await persisted()).slice().sort((a, b) => a.startFrame - b.startFrame)
  check('⇧⌫ 真的是涟漪删除（菜单上写的那件事），不再只是普通删除留个洞',
    afterShiftDelete[1].startFrame === afterShiftDelete[0].endFrame,
    afterShiftDelete.map((clip) => `${clip.startFrame}-${clip.endFrame}`).join(' '))
  await win.keyboard.press('Meta+z')
  await expect.poll(async () => videoClips(await persisted()).length, { timeout: DEFAULT_TIMEOUT_MS }).toBe(3)
  await snap('08-context-menu-and-ripple')
  note('右键', '八项全是动词，读得懂；⇧⌫ 终于和菜单上写的一致了。')

  // ══ 第 10 步：空轨右键「从素材库添加…」要真的把左栏切到素材页 ═══════════════════════
  // 空的图片轨是真正的轨道行（带 data-track-id）；叠加层那条虚线不是轨道，右键它没有菜单。
  const emptyTrackLane = timelinePanel.locator('[data-track-type="image"]').first()
  await emptyTrackLane.click({ button: 'right', position: { x: 260, y: 12 } })
  const trackMenu = win.locator('[role="menu"]').last()
  await expectVisible(trackMenu, '空轨右键菜单没打开')
  await clickOrFail(trackMenu.getByRole('menuitem', { name: /从素材库添加/ }), '从素材库添加…')
  const assetsTab = win.locator('.workbench-preview-source [role="tab"]').nth(1)
  await expect.poll(async () => assetsTab.getAttribute('aria-selected'),
    { message: '「从素材库添加…」没有把左栏切到素材页', timeout: DEFAULT_TIMEOUT_MS }).toBe('true')
  check('空轨右键「从素材库添加…」真的把左栏切到素材页（原来点了没反应）', true)
  await snap('09-assets-tab')

  // ══ 第 11 步：配乐进音频轨 → 轨道头静音 → 配乐音量滑杆解禁并写盘 ══════════════════
  await clickOrFail(timelinePanel.getByRole('button', { name: '添加配乐' }).first(), '点「+ 配乐」')
  const musicPicker = win.locator('[data-testid="asset-picker"]')
  await expectVisible(musicPicker, '「+ 配乐」没有打开素材选择器')
  await clickOrFail(musicPicker.getByRole('button', { name: MUSIC_FILE }).first(), `选中配乐 ${MUSIC_FILE}`)
  check('「+ 配乐」的选择器只列音频，选一个就落到音频轨', true)
  await expect.poll(async () => ((await persisted()).tracks.find((track) => track.id === 'audioTrack')?.clips ?? []).length,
    { message: '配乐没有落到音频轨', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  // 第一段配乐必须铺在片头：落在播放头上会让 15 秒的片子导出成 22 秒，多出来的那一截是黑场。
  check('第一段配乐铺在片头（不是随手停在哪就从哪开始）',
    ((await persisted()).tracks.find((track) => track.id === 'audioTrack')?.clips ?? [])[0]?.startFrame === 0,
    `startFrame=${((await persisted()).tracks.find((track) => track.id === 'audioTrack')?.clips ?? [])[0]?.startFrame}`)

  const musicTrack = timelinePanel.locator('[data-track-type="audio"]').first()
  await clickOrFail(musicTrack.getByRole('button', { name: '静音轨道' }).first(), '把配乐轨静音')
  await expect.poll(async () => ((await persisted()).tracks.find((track) => track.id === 'audioTrack')?.clips ?? [])[0]?.audio?.muted ?? false,
    { message: '轨道头静音没写进 clip.audio', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  check('轨道头静音写进 clip.audio（导出据此走）', true)
  await clickOrFail(musicTrack.getByRole('button', { name: '取消轨道静音' }).first(), '取消配乐轨静音')

  await win.keyboard.press('Escape')
  // 点轨道区空白处取消选中，回到整片属性。选中过之后回不到整片属性，就等于画幅 / 导出分辨率
  // / 配乐音量这三样再也改不了——这条手势是它们唯一的回头路。
  await timelinePanel.locator('.workbench-timeline__tracks').first().click({ position: { x: 600, y: 6 } })
  await expect(inspector.locator('[data-testid="preview-inspector-object"]'),
    '点轨道空白处应当取消选中、回到整片属性').toHaveAttribute('data-object-type', 'film')
  check('点轨道空白处能取消选中、回到整片属性（原来选中后再也回不去）', true)
  check('有了配乐之后「配乐音量」不再禁用', !(await musicSlider.isDisabled()))
  await musicSlider.fill('-12')
  await expect.poll(async () => ((await persisted()).tracks.find((track) => track.id === 'audioTrack')?.clips ?? [])[0]?.audio?.gainDb ?? null,
    { message: '「配乐音量」滑杆没有写进 clip.audio', timeout: DEFAULT_TIMEOUT_MS }).toBe(-12)
  check('「配乐音量」滑杆真的改配乐音量（原来它连 onChange 都没有）', true)
  await snap('10-music-track')
  note('配乐', '拖进去就成了一条轨，静音钮在轨道头一眼看得到；空轨时那颗静音钮是灰的并写明原因，不用怀疑自己点错了。')

  // ══ 第 12 步：字幕 → 改字体 → 右键「对齐到所在镜头」 ═══════════════════════════════
  await clickOrFail(timelinePanel.getByRole('button', { name: '添加字幕' }).first(), '加一条字幕')
  await expect.poll(async () => (await persisted()).textClips.length,
    { message: '字幕没加上', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  await expect(inspector.locator('[data-testid="preview-inspector-object"]')).toHaveAttribute('data-object-type', 'text')
  // NomiSelect 是自绘 combobox（不是原生 <select>）：点开按钮再挑一条 option。
  await clickOrFail(inspector.getByLabel('字体'), '打开字体下拉')
  await clickOrFail(win.getByRole('option', { name: '宋体' }).first(), '把字幕字体改成宋体')
  await expect.poll(async () => (await persisted()).textClips[0]?.fontFamily ?? '',
    { message: '字体没写进字幕', timeout: DEFAULT_TIMEOUT_MS }).toBe('songti')
  check('字幕能改字体，改动落盘', true, (await persisted()).textClips[0]?.fontFamily)

  // 把字幕挪到第 2 镜身上，再用右键「对齐到所在镜头」把它对齐
  const textClipId = (await persisted()).textClips[0].id
  const textClipNode = timelinePanel.locator(`[data-text-clip-id="${textClipId}"]`).first()
  await textClipNode.click({ button: 'right' })
  const textMenu = win.locator('[role="menu"]').last()
  await expectVisible(textMenu, '字幕右键菜单没打开')
  await clickOrFail(textMenu.getByRole('menuitem', { name: '对齐到所在镜头' }), '对齐到所在镜头')
  await expect.poll(async () => {
    const state = await persisted()
    const caption = state.textClips[0]
    const shot = videoClips(state).find((clip) => clip.startFrame <= (caption.startFrame + caption.endFrame) / 2 && (caption.startFrame + caption.endFrame) / 2 < clip.endFrame)
      ?? videoClips(state)[0]
    return `${caption.startFrame}-${caption.endFrame} vs ${shot.startFrame}-${shot.endFrame}`
  }, { message: '「对齐到所在镜头」没有把字幕对到镜头上', timeout: DEFAULT_TIMEOUT_MS })
    .toMatch(/^(\d+)-(\d+) vs \1-\2$/)
  check('字幕右键「对齐到所在镜头」真的把起止对到那一镜（原来点了只是把菜单关掉）', true,
    JSON.stringify((await persisted()).textClips[0]))
  await snap('11-caption')
  note('字幕', '加完直接选中并跳到属性面板的文字组，不用再找它在哪；「对齐到所在镜头」省掉了手动拖两条边。')

  // ══ 第 13 步：导出 720p → ffprobe 验尺寸 / 时长 / 音轨 / 接缝混合帧 ══════════════════
  // `.partial.mp4` 是导出**进行中**的半成品，ffprobe 读它必然报 moov atom not found。
  // 只认最终产物，否则走查会把「还没写完」误判成「导出坏了」。
  const findExport = async (since) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await win.waitForTimeout(1500)
      const found = []
      const scan = (dir, depth = 0) => {
        if (depth > 5) return
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) scan(full, depth + 1)
          else if (entry.name.endsWith('.mp4') && !entry.name.includes('.partial.')
            && full.includes(`${path.sep}exports${path.sep}`) && fs.statSync(full).mtimeMs > since) found.push(full)
        }
      }
      scan(projectsDir)
      if (found.length) return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
    }
    return null
  }
  // 导出参数在整片态，先点空白处取消字幕的选中。
  await timelinePanel.locator('.workbench-timeline__tracks').first().click({ position: { x: 600, y: 6 } })
  await expect(inspector.locator('[data-testid="preview-inspector-object"]')).toHaveAttribute('data-object-type', 'film')
  await clickOrFail(inspector.getByLabel('导出分辨率'), '打开导出分辨率下拉')
  await clickOrFail(win.getByRole('option', { name: '720p' }).first(), '把导出分辨率选成 720p')
  const exportedBefore = Date.now()
  await clickOrFail(win.locator('.nomi-appbar [aria-label="导出 MP4"]').first(), '导出 MP4（720p）')
  const exported720 = await findExport(exportedBefore)
  check('导出真的产出了 MP4 文件', Boolean(exported720), exported720 ?? '未找到导出产物')
  if (exported720) {
    const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_entries', 'format=duration', '-of', 'json', exported720], { encoding: 'utf8' }))
    const video = probe.streams.find((stream) => stream.codec_type === 'video')
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio')
    check('属性面板选 720p，导出的片子就是 1280×720', video?.width === 1280 && video?.height === 720, `${video?.width}x${video?.height}`)
    check('导出时长 ≈ 15 秒（转场吃掉的那一点在容差内）', Math.abs(Number(probe.format.duration) - 15) < 1.2, `${probe.format.duration}s`)
    check('导出带音轨（配乐真的混进去了）', Boolean(audio), audio?.codec_name ?? 'none')

    // 接缝混合帧：第 1、2 镜的接缝在 5s，转场 12 帧（0.4 秒）。转场落在接缝哪一侧属于
    // 渲染细节，所以扫接缝前后半秒的若干帧，只要求**存在**一帧既不是纯第 1 镜色也不是纯
    // 第 2 镜色——那就证明导出真的把转场渲染进去了，而不是悄悄退回硬切。
    // 只钉死一个时刻的话，钉在过渡带外面就会得到「纯色 = 没渲染」的假红。
    const sampled = []
    for (const at of ['4.80', '4.90', '5.00', '5.10', '5.20', '5.30']) {
      const framePath = path.join(root, `seam-${at}.png`)
      execFileSync(ffmpegPath, ['-v', 'error', '-y', '-ss', at, '-i', exported720, '-frames:v', '1', framePath], { timeout: 60_000 })
      const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', framePath, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { timeout: 60_000 })
      sampled.push({ at, rgb: [raw[0], raw[1], raw[2]] })
    }
    const distance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
    const blended = sampled.filter(({ rgb }) => distance(rgb, SHOTS[0].rgb) > 40 && distance(rgb, SHOTS[1].rgb) > 40)
    const sampleText = sampled.map(({ at, rgb }) => `${at}s=rgb(${rgb.join(',')})`).join(' ')
    check('接缝附近存在混合帧，不是硬切（导出真的渲染了转场）', blended.length > 0, sampleText)
    // 这条转场是「淡入淡出」——中间必须**压暗**。它曾经在 YUV 里做 blend，把 U/V 拉向 0
    // 而不是 128 的中性值，于是接缝上闪出一帧亮绿（实测 rgb(0,138,0)）：一样满足「不是硬切」，
    // 但用户看到的是一道绿光。所以这里要额外钉死「暗」，不能只钉「变了」。
    const luma = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
    check('「淡入淡出」在接缝中间真的压到暗，不是闪一道绿光',
      sampled.some(({ rgb }) => luma(rgb) < 60), sampleText)
  }
  await snap('12-exported-720p')

  // 1080p 再导一次，验分辨率真的跟着属性面板走
  await timelinePanel.locator('.workbench-timeline__tracks').first().click({ position: { x: 600, y: 6 } })
  await clickOrFail(inspector.getByLabel('导出分辨率'), '打开导出分辨率下拉')
  await clickOrFail(win.getByRole('option', { name: '1080p' }).first(), '把导出分辨率改成 1080p')
  const exported1080Before = Date.now()
  await clickOrFail(win.locator('.nomi-appbar [aria-label="导出 MP4"]').first(), '导出 MP4（1080p）')
  const exported1080 = await findExport(exported1080Before)
  if (exported1080) {
    const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', exported1080], { encoding: 'utf8' }))
    const video = probe.streams.find((stream) => stream.codec_type === 'video')
    check('把导出分辨率改成 1080p，导出的片子真的变成 1080 高', video?.height === 1080, `${video?.width}x${video?.height}`)
  } else {
    check('把导出分辨率改成 1080p，导出的片子真的变成 1080 高', false, '未找到 1080p 导出产物')
  }
  await snap('13-exported-1080p')
  note('导出', '导出按钮固定在顶栏右上，找得到；参数在属性面板里，改完再导就生效了。')

  console.log('\n=== 判据 ===')
  for (const [name, ok, detail] of verdicts) console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log('\n=== 情绪摩擦日志 ===')
  for (const [step, feeling] of friction) console.log(`  · 「${step}」${feeling}`)
  console.log(`\n截图目录：${shotsDir}`)
  const failed = verdicts.filter(([, ok]) => !ok)
  if (failed.length) throw new Error(`剪辑面真实用户走查有 ${failed.length} 条不达合同：${failed.map(([name]) => name).join(' / ')}`)
  console.log('剪辑面真实用户走查通过')
} catch (error) {
  failure = error
  try { await win.screenshot({ path: path.join(shotsDir, 'FAIL.png') }) } catch { /* window already gone */ }
} finally {
  await app.close().catch(() => undefined)
}
if (failure) { console.error(failure); process.exit(1) }
