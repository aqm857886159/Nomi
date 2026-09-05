// R13/R16 走查：剪辑面板系统 C′（合同 docs/design/2026-09-05-editing-panel-design-contract.md §2.1–§2.3）。
//
// 真实用户任务：把一条已经拼好的粗剪拿到剪辑面上——挑镜头、看画面、调这一段的参数、导出。
// 这条走查验的是那张五块面板的表在真机上确实成立，而且是**上一版翻车的那几处**：
//   ① transport 贴预览列**底部**、紧挨时间轴上沿（上一版没给 section h-full，它浮在列顶）
//   ② 「布局」与「导出 MP4」在**应用顶栏**，不在 Nomi 面板头（合同 §2.2）
//   ③ 左栏宽 ≥240、两个 tab 文字完整、「收起」在底部（上一版按百分比算出 232px，tab 被裁成「素」）
//   ④ 属性面板四态：整片 / 视频片段 / 图片片段（无声音组）/ 字幕
//   ⑤ 面板可拖可收：收起属性 → 32px 图标条；预设「结果全屏」把三块一起收掉
// 零额度：只用本地 ffmpeg 造的色块图与落盘的 timeline 元数据，绝不触发任何生成。
// Run: pnpm run build && node tests/ux/editing-panel-system.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/editing-panel-system')
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-editing-panels-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'editing-panel-walk'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })

const clip = (id, type, label, startFrame, endFrame) => ({
  id,
  type,
  sourceNodeId: `node-${id}`,
  label,
  startFrame,
  endFrame,
  frameCount: endFrame - startFrame + 60,
  offsetStartFrame: 0,
  offsetEndFrame: 0,
})

const timeline = {
  version: 1,
  fps: 30,
  scale: 1.5,
  playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [clip('clip-img', 'image', '静帧一', 0, 90)] },
    {
      id: 'videoTrack',
      type: 'video',
      label: '视频轨',
      clips: [clip('clip-a', 'video', '开场远景', 0, 120), clip('clip-b', 'video', '推门近景', 120, 240)],
    },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [
    { id: 'text-1', text: '第 1 镜的字幕文字', startFrame: 0, endFrame: 90, style: 'caption' },
  ],
  transitions: [],
}

const workbenchDocument = { version: 1, title: '剪辑面板系统验收片', updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const payload = { workbenchDocument, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId,
  name: '剪辑面板系统验收片',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  workbenchDocument,
  timeline,
  generationCanvas,
  payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi/project.json'), JSON.stringify(project, null, 2))

const launched = await launchNomiApp({
  name: 'editing-panel-system',
  userDataDir,
  settingsDir,
  projectsDir,
  capabilityDir,
  timeout: 300_000,
})
const { app } = launched
let win = launched.win
win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))

const verdicts = []
const check = (name, ok, detail = '') => {
  verdicts.push([name, ok, detail])
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => { windowRef.setBounds({ x: 0, y: 0, ...bounds }); windowRef.center() }, { width, height })
  await win.waitForTimeout(400)
}

/** 一次性量出五块面板的真实几何 + transport 的位置。断言全靠它，不靠人眼看截图。 */
const readGeometry = () => win.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height), bottom: Math.round(rect.bottom), right: Math.round(rect.right) }
  }
  // v4 的 Panel 把 id 写进 data-testid / id，data-panel 只是个布尔标记（className 落在**内层** div，
  // 尺寸在外层），所以量几何要按 data-testid 取外层那个。
  const panel = (id) => box(`[data-panel][data-testid="${id}"]`)
  const column = box('.workbench-preview-player')
  const bar = box('.workbench-preview-player__control-bar')
  const timelinePanel = box('.workbench-preview .workbench-timeline')
  const sourceAside = document.querySelector('.workbench-preview-source')
  const tabs = [...(sourceAside?.querySelectorAll('[role="tab"]') || [])].map((tab) => {
    const span = tab.querySelector('span')
    return {
      text: tab.textContent?.trim() || '',
      // scrollWidth > clientWidth 就是被裁了（「素材」变「素」正是这样）
      truncated: span ? span.scrollWidth > span.clientWidth + 1 : false,
    }
  })
  const collapseButton = sourceAside ? [...sourceAside.querySelectorAll('button')].find((b) => /收起/.test(b.getAttribute('aria-label') || b.textContent || '')) : null
  const collapseRect = collapseButton?.getBoundingClientRect() || null
  const asideRect = sourceAside?.getBoundingClientRect() || null
  return {
    source: panel('editing-surface-source'),
    preview: panel('editing-surface-preview'),
    inspector: panel('editing-surface-inspector'),
    assistant: panel('editing-surface-assistant'),
    timelinePanelBox: panel('editing-surface-timeline'),
    stageRow: box('[data-panel][data-testid="editing-surface-stage"]'),
    column,
    bar,
    timelineTop: timelinePanel ? timelinePanel.y : null,
    tabs,
    // 「收起」应当贴在左栏底部，不是浮在中间
    collapseFromAsideBottom: collapseRect && asideRect ? Math.round(asideRect.bottom - collapseRect.bottom) : null,
    appBarExport: box('.nomi-appbar [aria-label="导出 MP4"]'),
    appBarLayout: box('.nomi-appbar [aria-label="布局"]'),
    // Nomi 面板头里不该再有这两个（合同：只留徽标 / 额度 / 历史 / 收起）
    exportInsideAssistant: Boolean(document.querySelector('[data-testid="editing-surface-assistant"] [aria-label="导出 MP4"]')),
    layoutInsideAssistant: Boolean(document.querySelector('[data-testid="editing-surface-assistant"] [aria-label="布局"]')),
    // 轨道名不该被截断
    trackNames: [...document.querySelectorAll('.workbench-timeline-track__name')].map((n) => ({
      text: n.textContent?.trim() || '',
      truncated: n.scrollWidth > n.clientWidth + 1,
    })),
  }
})

const readInspector = () => win.evaluate(() => {
  const panel = document.querySelector('[aria-label="属性面板"]')
  if (!panel) return null
  const row = panel.querySelector('[data-testid="preview-inspector-object"]')
  return {
    objectType: row?.getAttribute('data-object-type') || '',
    groups: [...panel.querySelectorAll('section > button')].map((b) => b.textContent?.trim().replace(/\s+/g, '') || ''),
  }
})

try {
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await resize(1680, 1000)

  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: '剪辑面板系统验收片' }).first()
  await expectVisible(projectCard, '夹具项目卡没出现')
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }).first(), '打开剪辑面板系统验收片')
  await expect
    .poll(() => app.windows().some((candidate) => /[?&]projectId=/.test(candidate.url())), { message: '项目窗口没打开', timeout: DEFAULT_TIMEOUT_MS })
    .toBe(true)
  win = app.windows().find((candidate) => /[?&]projectId=/.test(candidate.url())) ?? win
  await win.waitForLoadState('domcontentloaded')
  await resize(1680, 1000)
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), '进入预览')
  await expectVisible(win.locator('.workbench-preview .workbench-timeline').first(), '剪辑面时间轴没出现')
  await win.waitForTimeout(900)

  // ========== ① 五块面板的默认几何（合同 §2.1） ==========
  const geo = await readGeometry()
  console.log('  · 面板几何：', JSON.stringify({ source: geo.source?.w, preview: geo.preview?.w, inspector: geo.inspector?.w, assistant: geo.assistant?.w, timeline: geo.timelinePanelBox?.h }))
  check('左「镜头/素材」栏 ≥ 240（合同最小宽）', (geo.source?.w ?? 0) >= 240, `${geo.source?.w}px`)
  check('属性栏 ≥ 200', (geo.inspector?.w ?? 0) >= 200, `${geo.inspector?.w}px`)
  check('Nomi 栏 ≥ 320', (geo.assistant?.w ?? 0) >= 320, `${geo.assistant?.w}px`)
  check('时间轴高 ≥ 140', (geo.timelinePanelBox?.h ?? 0) >= 140, `${geo.timelinePanelBox?.h}px`)
  check('Nomi 栏整列通到底（比预览列高）', (geo.assistant?.h ?? 0) > (geo.preview?.h ?? 0), `${geo.assistant?.h} vs ${geo.preview?.h}`)

  // ========== ② transport 贴预览列底部、紧挨时间轴（合同 §2.2；上一版翻车处） ==========
  check('transport 高 40', geo.bar?.h === 40, `${geo.bar?.h}px`)
  check('transport 贴预览列**底部**（不是顶部）', Math.abs((geo.column?.bottom ?? 0) - (geo.bar?.bottom ?? 0)) <= 2,
    `距列底 ${(geo.column?.bottom ?? 0) - (geo.bar?.bottom ?? 0)}px / 距列顶 ${(geo.bar?.y ?? 0) - (geo.column?.y ?? 0)}px`)
  check('transport 紧挨时间轴上沿', (geo.timelineTop ?? 0) - (geo.bar?.bottom ?? 0) <= 8 && (geo.timelineTop ?? 0) - (geo.bar?.bottom ?? 0) >= -2,
    `间隙 ${(geo.timelineTop ?? 0) - (geo.bar?.bottom ?? 0)}px`)

  // ========== ③ 布局与导出在顶栏，不在 Nomi 面板头（合同 §2.2） ==========
  check('「导出 MP4」在应用顶栏', Boolean(geo.appBarExport), JSON.stringify(geo.appBarExport))
  check('「布局」菜单在应用顶栏', Boolean(geo.appBarLayout), JSON.stringify(geo.appBarLayout))
  check('Nomi 面板头里没有导出/布局', !geo.exportInsideAssistant && !geo.layoutInsideAssistant,
    `export=${geo.exportInsideAssistant} layout=${geo.layoutInsideAssistant}`)

  // ========== ④ 左栏 tab 完整、收起钮在底部 ==========
  check('左栏两个 tab 文字都不截断', geo.tabs.length === 2 && geo.tabs.every((tab) => !tab.truncated), JSON.stringify(geo.tabs))
  check('「收起」贴在左栏底部', (geo.collapseFromAsideBottom ?? 999) <= 2, `距底 ${geo.collapseFromAsideBottom}px`)
  check('轨道名不被截断（视频轨不再是「视…」）', geo.trackNames.length > 0 && geo.trackNames.every((n) => !n.truncated), JSON.stringify(geo.trackNames))

  await screenshotSettled(win, { path: path.join(shotsDir, '01-default-layout.png') })

  // ========== ⑤ 属性面板四态（合同 §2.3） ==========
  const filmState = await readInspector()
  check('无选中 = 整片态，组序 显示/导出/声音', filmState?.objectType === 'film' && filmState.groups.slice(0, 3).join('/') === '显示/导出/声音', JSON.stringify(filmState))

  const clips = win.locator('.workbench-preview [data-testid="timeline-clip"]:visible')
  const videoClip = win.locator('.workbench-preview [data-track-type="video"] [data-testid="timeline-clip"]:visible').first()
  await clickOrFail(videoClip, '选中一个视频片段')
  await win.waitForTimeout(500)
  const videoState = await readInspector()
  check('视频片段态出「显示/时间/声音/转场」四组', videoState?.objectType === 'video' && videoState.groups.join('/') === '显示/时间/声音/转场', JSON.stringify(videoState))

  const imageClip = win.locator('.workbench-preview [data-track-type="image"] [data-testid="timeline-clip"]:visible').first()
  await clickOrFail(imageClip, '选中图片片段')
  await win.waitForTimeout(500)
  const imageState = await readInspector()
  check('图片片段态**不出**「声音」组（clip_audio_unsupported，组不出现不画灰）',
    imageState?.objectType === 'image' && !imageState.groups.includes('声音'), JSON.stringify(imageState))

  // 文字片段没有 data-testid，认它自己的类名 + data-text-clip-id（见 TimelineTextTrack.tsx）。
  const textClip = win.locator('.workbench-preview .workbench-timeline-text-clip[data-text-clip-id]:visible').first()
  if (await textClip.count()) {
    await clickOrFail(textClip, '选中字幕')
    await win.waitForTimeout(500)
    const textState = await readInspector()
    check('字幕态出「文字/时间」两组', textState?.objectType === 'text' && textState.groups.join('/') === '文字/时间', JSON.stringify(textState))
  } else {
    check('字幕态出「文字/时间」两组', false, '时间轴上没找到可见字幕片段')
  }
  console.log(`  · 可见片段 ${await clips.count()} 个`)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-inspector-clip.png') })

  // ========== ⑥ 收起属性 → 32px 图标条；预设「结果全屏」一次收掉三块 ==========
  await clickOrFail(win.locator('[aria-label="收起属性"]').first(), '收起属性面板')
  await win.waitForTimeout(600)
  const collapsed = await readGeometry()
  check('属性收起成图标条（≈32px）', (collapsed.inspector?.w ?? 999) <= 40, `${collapsed.inspector?.w}px`)
  await expectVisible(win.locator('[aria-label="展开属性"]').first(), '收起后没出现展开图标条')
  await screenshotSettled(win, { path: path.join(shotsDir, '03-inspector-collapsed.png') })

  await clickOrFail(win.locator('.nomi-appbar [aria-label="布局"]').first(), '打开布局菜单')
  await win.waitForTimeout(300)
  await screenshotSettled(win, { path: path.join(shotsDir, '04-layout-menu.png') })
  await clickOrFail(win.getByRole('menuitemradio', { name: '结果全屏' }).first(), '切到「结果全屏」预设')
  await win.waitForTimeout(700)
  const focused = await readGeometry()
  check('「结果全屏」把左栏/属性/Nomi 一起收成图标条',
    (focused.source?.w ?? 999) <= 40 && (focused.inspector?.w ?? 999) <= 40 && (focused.assistant?.w ?? 999) <= 40,
    `source=${focused.source?.w} inspector=${focused.inspector?.w} assistant=${focused.assistant?.w}`)
  check('结果全屏下预览列变宽（画面真的拿到空间）', (focused.preview?.w ?? 0) > (geo.preview?.w ?? 0), `${geo.preview?.w} → ${focused.preview?.w}`)
  await screenshotSettled(win, { path: path.join(shotsDir, '05-preset-result.png') })

  // 恢复默认，证明预设可逆
  await clickOrFail(win.locator('.nomi-appbar [aria-label="布局"]').first(), '再次打开布局菜单')
  await win.waitForTimeout(300)
  await clickOrFail(win.getByRole('menuitem', { name: '恢复默认' }).first(), '恢复默认布局')
  await win.waitForTimeout(700)
  const restored = await readGeometry()
  console.log('  · 恢复后几何：', JSON.stringify({ source: restored.source?.w, preview: restored.preview?.w, inspector: restored.inspector?.w, assistant: restored.assistant?.w, stageRow: restored.stageRow?.w }))
  check('「恢复默认」回到合同默认宽（300 / 240 / 390，±4px）',
    Math.abs((restored.source?.w ?? 0) - 300) <= 4 && Math.abs((restored.inspector?.w ?? 0) - 240) <= 4 && Math.abs((restored.assistant?.w ?? 0) - 390) <= 4,
    `source=${restored.source?.w} inspector=${restored.inspector?.w} assistant=${restored.assistant?.w}`)
  await screenshotSettled(win, { path: path.join(shotsDir, '06-restored.png') })

  // ========== ⑦ 窗口变窄：面板不塌、不违反合同下限（最小窗口下 composer 还得能用） ==========
  await resize(1280, 860)
  await win.waitForTimeout(700)
  const narrow = await readGeometry()
  console.log('  · 窄窗几何：', JSON.stringify({ source: narrow.source?.w, preview: narrow.preview?.w, inspector: narrow.inspector?.w, assistant: narrow.assistant?.w }))
  // ±1px：面板宽度是 flexGrow 算出来的分数像素，边界上会四舍五入掉 1px。
  check('窄窗下各面板仍不低于合同下限', (narrow.source?.w ?? 0) >= 239 && (narrow.inspector?.w ?? 0) >= 199 && (narrow.assistant?.w ?? 0) >= 319,
    `source=${narrow.source?.w} inspector=${narrow.inspector?.w} assistant=${narrow.assistant?.w}`)
  check('窄窗下 transport 仍贴预览列底部', Math.abs((narrow.column?.bottom ?? 0) - (narrow.bar?.bottom ?? 0)) <= 2,
    `距列底 ${(narrow.column?.bottom ?? 0) - (narrow.bar?.bottom ?? 0)}px`)
  await screenshotSettled(win, { path: path.join(shotsDir, '07-narrow.png') })

  console.log('\n=== 判据 ===')
  const failed = verdicts.filter(([, ok]) => !ok)
  for (const [name, ok, detail] of verdicts) console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`\n截图目录：${shotsDir}`)
  if (failed.length > 0) throw new Error(`剪辑面板系统走查有 ${failed.length} 条不达合同：${failed.map(([name]) => name).join(' / ')}`)
  console.log('剪辑面板系统走查通过')
} finally {
  await app.close().catch(() => undefined)
}
