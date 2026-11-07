#!/usr/bin/env node
// 真实用户任务（窄窗拍板 WindowNarrow 的页面半边，2026-11-07 用户「可以，开做」）：
//
// 创作者把 Nomi 开在 1100 宽的窗口里，Nomi 停靠在右边（外壳在 1100 把它钳到 340），在创作页写稿；
// 写完去生成页让 Nomi 起草三镜、摆上付费确认卡（本机夹具，零额度），再去预览页、把窗口调到 720 高（MacBook 常见）。
// F2 的触发条件 = 预览页开着时窗口变矮（900 → 720）：Nomi 栏里那张付费卡的「生成」掉到窗外；直接以 720 高打开不出这个问题
// （修前构建两条路都量过）。
//   · board:WindowNarrow/creation.editor-grid —— 正文不被裁：编辑区宽 = 主区，正文宽 min(680, 主区) 居中，不出横向滚动。
//   · board:WindowNarrow/creation.toolbar-overflow —— 工具条放不下的按钮从右往左收进「⋯」，撤销 / 重做钉在右端；
//     拉宽到放得下时「⋯」消失、按钮全回来（只有「量出来放不下」一个阈值）。
//   · board:WindowNarrow/creation.toolbar-more-menu —— 「⋯」菜单：图标 + 名字，按原分组分隔，右边对齐「⋯」；
//     点菜单里的「项目符号」真的把这一段变成列表，撤销真的撤回；Markdown 输入规则（「- 」起列表）照常。
//   · board:WindowNarrow/preview.grid-rows —— 两条路都量：① 直接以 1100×720 打开预览页（协调 11-08 定的验收条件）；
//     ② 预览页开着、窗口从 900 高缩到 720（调研当时的路径）。整页跟窗口一样高，Nomi 栏里付费卡的「生成」「取消」
//     和底部输入框都在窗内，整页不出竖向滚动。
//   · board:WindowNarrow/preview.side-strips —— 素材 / 属性收成的条照常画、宽 32、有名字；播放键和时间轴在窗内。
//   · board:WindowNarrow/preview.min-player-comment —— panelLayout.ts 注释写的那笔账：Nomi 停靠时（1100）主区 684，
//     播放器 ≥ 底线 400，点开的那一栏放得下。700–约 740 宽点不开是已知限制（用户 11-08「A 记为已知限制」），这里不量。
// 中文 · 浅色一轮，英文 · 暗色一轮（截图两轨）。隔离资料 + 本机夹具供应商，一笔都不花（最后在卡上点「取消」）。
//
// NOMI_WALK_PHASE=before：在修复前的构建上跑，只量、只截图、不判（报告里记「改前」的数）；默认 after，全部断言。
// NOMI_WALK_SHOT_DIR：截图另存一份到这个目录（给验收线和报告用）。
import fs from 'node:fs'
import path from 'node:path'
import { applyColorSchemeForShot, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { AGENT_PANEL, setAppLanguage, switchWorkspace } from './_shell.mjs'
import { createPresenter } from './_spendCardWalk.mjs'
import { APPROVAL_CARD, closeSpendCard, COMPOSER, createRuntimeWalk, expandResidentPanel, INTERVENTION_CONFIRM, INTERVENTION_REJECT, openCanvas, PREVIEW_PANEL, recorded } from './agent-runtime-walk-support.mjs'

const PHASE = process.env.NOMI_WALK_PHASE === 'before' ? 'before' : 'after'
const AFTER = PHASE === 'after'
const A = {
  grid: 'board:WindowNarrow/creation.editor-grid',
  overflow: 'board:WindowNarrow/creation.toolbar-overflow',
  menu: 'board:WindowNarrow/creation.toolbar-more-menu',
  rows: 'board:WindowNarrow/preview.grid-rows',
  strips: 'board:WindowNarrow/preview.side-strips',
  floor: 'board:WindowNarrow/preview.min-player-comment',
}
const EDITOR = '.workbench-editor'
const EDITOR_TEXT = `${EDITOR} .tiptap[contenteditable="true"]`
const TOOLBAR = '.workbench-editor-toolbar'
const ROW = `${TOOLBAR} [data-nomi-overflow-row]`
const TRIGGER = `${TOOLBAR} [data-overflow-trigger]`
const MENU = '[data-testid="nomi-overflow-menu"]'
const SPEND = `${APPROVAL_CARD}[data-kind="spend"]`
const IMAGE = { providerId: 'apimart', modelId: 'gpt-image-2' }
const STORY = ['第一场　雨后的巷口', '清晨，雨刚停。小女孩阿禾蹲在积水边，把一只折好的纸船放进水里。纸船顺着石板缝慢慢漂向巷口，她跟在后面一路小跑。', '第二场　河边', '纸船漂进小河，阿禾在桥上追着看，直到纸船消失在拐角。她回头，看见爷爷撑着伞站在桥头。']

const facts = {}
const shotDir = process.env.NOMI_WALK_SHOT_DIR
if (shotDir) fs.mkdirSync(shotDir, { recursive: true })

async function shot(walk, win, label) {
  const file = await walk.snap(`${PHASE}-${label}`)
  if (shotDir) fs.copyFileSync(file, path.join(shotDir, `${PHASE}-${label}.png`))
  return file
}

/** 创作页这一刻的几何：编辑区、正文、工具条、哪些按钮收起了、「⋯」、撤销 / 重做。 */
function creationGeometry(win) {
  return win.evaluate(({ editor, toolbar, row, trigger, agentPanel }) => {
    const box = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width) }
    }
    const section = document.querySelector(editor)
    const scroll = section?.querySelector('.workbench-editor__scroll')
    const content = section?.querySelector('.tiptap')
    const items = [...document.querySelectorAll(`${row} [data-overflow-item]`)].map((element) => ({
      id: element.getAttribute('data-overflow-item'),
      hidden: element.hasAttribute('data-overflowing') || getComputedStyle(element).display === 'none',
      label: element.querySelector('button')?.getAttribute('aria-label') ?? '',
      box: box(element.querySelector('button')),
    }))
    const legacyButtons = [...document.querySelectorAll(`${toolbar} [data-rich-text-action]`)].map((element) => ({ id: element.getAttribute('data-rich-text-action'), box: box(element) }))
    return {
      innerWidth, innerHeight,
      section: box(section),
      agent: box(document.querySelector(agentPanel)),
      toolbar: box(document.querySelector(toolbar)),
      content: box(content),
      scroll: scroll ? { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth } : null,
      items,
      legacyButtons,
      trigger: box(document.querySelector(trigger)),
      undo: box(document.querySelector(`${toolbar} [data-rich-text-action="undo"]`)),
      redo: box(document.querySelector(`${toolbar} [data-rich-text-action="redo"]`)),
      undoInRow: Boolean(document.querySelector(`${row} [data-rich-text-action="undo"], ${row} [data-rich-text-action="redo"]`)),
    }
  }, { editor: EDITOR, toolbar: TOOLBAR, row: ROW, trigger: TRIGGER, agentPanel: AGENT_PANEL })
}

function assertCreationNarrow(g, round) {
  // 编辑区宽 = 主区：右边不越过 Nomi 栏，正文不出横向滚动，正文宽 ≤ 680 且不越出编辑区。
  expect(g.section.right, `${A.grid}（${round}）：编辑区右沿不压到 Nomi 栏`).toBeLessThanOrEqual(g.agent.left + 0.5)
  expect(g.scroll.scrollWidth, `${A.grid}（${round}）：正文没有横向溢出`).toBeLessThanOrEqual(g.scroll.clientWidth + 1)
  expect(g.content.right, `${A.grid}（${round}）：正文右沿在编辑区里`).toBeLessThanOrEqual(g.section.right)
  expect(g.content.width, `${A.grid}（${round}）：正文宽 min(680, 主区)`).toBeLessThanOrEqual(680)
  expect(g.toolbar.right, `${A.grid}（${round}）：工具条右沿在编辑区里`).toBeLessThanOrEqual(g.section.right + 0.5)
  // 收起：有项收起时「⋯」在；收起的是排在后面的那一截（从右往左）；看得见的项不压「⋯」，「⋯」不压撤销。
  const hidden = g.items.filter((item) => item.hidden)
  expect(hidden.length, `${A.overflow}（${round}）：1100 + 停靠 340 时有按钮收进「⋯」`).toBeGreaterThan(0)
  expect(g.trigger, `${A.overflow}（${round}）：「⋯」在`).not.toBeNull()
  const firstHidden = g.items.findIndex((item) => item.hidden)
  expect(g.items.slice(firstHidden).every((item) => item.hidden), `${A.overflow}（${round}）：从右往左收（收起的是末尾连续一截）`).toBe(true)
  const lastVisible = g.items.filter((item) => !item.hidden).at(-1)
  expect(lastVisible.box.right, `${A.overflow}（${round}）：最后一颗看得见的按钮不压「⋯」`).toBeLessThanOrEqual(g.trigger.left)
  expect(g.trigger.right, `${A.overflow}（${round}）：「⋯」不压撤销`).toBeLessThanOrEqual(g.undo.left)
  // 撤销 / 重做永不让：不在可收的那一排里，钉在工具条右端（右边距 12）。
  expect(g.undoInRow, `${A.overflow}（${round}）：撤销 / 重做不在可收的那一排`).toBe(false)
  expect(g.redo.right, `${A.overflow}（${round}）：重做钉在工具条右端`).toBeGreaterThanOrEqual(g.toolbar.right - 13)
  expect(g.redo.right, `${A.overflow}（${round}）：重做在工具条里`).toBeLessThanOrEqual(g.toolbar.right)
  expect(g.undo.right, `${A.overflow}（${round}）：撤销紧挨重做`).toBeLessThanOrEqual(g.redo.left)
}

async function typeStory(win) {
  const text = win.locator(EDITOR_TEXT)
  await expect(text).toBeVisible()
  await text.click()
  for (const [index, paragraph] of STORY.entries()) {
    if (index > 0) await win.keyboard.press('Enter')
    await win.keyboard.insertText(paragraph)
  }
}

async function creationStation(walk, win, round) {
  const report = (facts[round] = {})
  await switchWorkspace(win, 'creation', `${round}：创作页`)
  await expandResidentPanel(win)
  report.window = await walk.resizeWindow(1100, 900).then(() => ({ width: 1100, height: 900 }))
  await win.waitForTimeout(400)
  const narrow = await creationGeometry(win)
  report.creation1100 = { section: narrow.section, agent: narrow.agent, content: narrow.content, scroll: narrow.scroll, toolbar: narrow.toolbar, undo: narrow.undo, redo: narrow.redo, trigger: narrow.trigger, visible: narrow.items.filter((item) => !item.hidden).map((item) => item.id), hidden: narrow.items.filter((item) => item.hidden).map((item) => item.id), legacyButtons: narrow.legacyButtons.map((item) => `${item.id}@${item.box?.left}-${item.box?.right}`) }
  await shot(walk, win, `${round}-creation-1100x900`)
  if (!AFTER) return
  assertCreationNarrow(narrow, round)

  // 只有一个阈值：拉宽到放得下，「⋯」消失、全部回来；再拉回 1100，收起的那一截和刚才一样。
  const triggerProof = await proveProbe(win.locator(TRIGGER), `${A.overflow}（${round}）：1100 有收起项时「⋯」在`)
  await walk.resizeWindow(1440, 900)
  await expect.poll(async () => (await creationGeometry(win)).items.filter((item) => item.hidden).length, { message: `${A.overflow}（${round}）：1440 放得下，一颗都不收` }).toBe(0)
  await expectAbsent(win.locator(TRIGGER), { provenBy: triggerProof, message: `${A.overflow}（${round}）：放得下时没有「⋯」` })
  report.creation1440 = await creationGeometry(win).then((g) => ({ section: g.section, visible: g.items.filter((item) => !item.hidden).length }))
  await shot(walk, win, `${round}-creation-1440x900`)
  await walk.resizeWindow(1100, 900)
  await expect.poll(async () => (await creationGeometry(win)).items.filter((item) => item.hidden).map((item) => item.id).join(','), { message: `${A.overflow}（${round}）：拉回 1100，收起的还是同一截` }).toBe(report.creation1100.hidden.join(','))

  // 「⋯」菜单：图标 + 名字、按原分组分隔、右边对齐「⋯」。
  await clickOrFail(win.locator(TRIGGER), `${A.menu}（${round}）：点「⋯」`)
  const menu = win.locator(MENU)
  await expect(menu, `${A.menu}（${round}）：菜单打开`).toBeVisible()
  const menuFacts = await win.evaluate(({ menuSelector, triggerSelector }) => {
    const root = document.querySelector(menuSelector)
    const trigger = document.querySelector(triggerSelector).getBoundingClientRect()
    const rect = root.getBoundingClientRect()
    const rows = [...root.children].map((child) => (child.getAttribute('role') === 'separator'
      ? { kind: 'separator' }
      : { kind: 'item', id: child.getAttribute('data-menu-item'), label: child.textContent.trim(), icon: Boolean(child.querySelector('svg')) }))
    return { rows, menuRight: rect.right, menuLeft: rect.left, menuTop: rect.top, triggerRight: trigger.right, triggerBottom: trigger.bottom, triggerActive: document.querySelector(triggerSelector).getAttribute('data-active') }
  }, { menuSelector: MENU, triggerSelector: TRIGGER })
  report.menu = menuFacts
  const hiddenItems = narrow.items.filter((item) => item.hidden)
  const itemRows = menuFacts.rows.filter((row) => row.kind === 'item')
  expect(itemRows.map((row) => row.id), `${A.menu}（${round}）：菜单里正好是收起的那几项、原顺序`).toEqual(hiddenItems.map((item) => item.id))
  expect(itemRows.map((row) => row.label), `${A.menu}（${round}）：菜单项名字 = 按钮的名字`).toEqual(hiddenItems.map((item) => item.label))
  expect(itemRows.every((row) => row.icon), `${A.menu}（${round}）：每一项都有图标`).toBe(true)
  const groupOf = (id) => ['bullet-list', 'ordered-list', 'task-list'].includes(id) ? 'list' : ['table', 'link'].includes(id) ? 'insert' : ['h1', 'h2', 'h3', 'blockquote', 'horizontal-rule'].includes(id) ? 'heading' : 'text'
  const expectedSeparators = new Set(hiddenItems.map((item) => groupOf(item.id))).size - 1
  expect(menuFacts.rows.filter((row) => row.kind === 'separator').length, `${A.menu}（${round}）：按原分组画分隔线`).toBe(expectedSeparators)
  expect(Math.abs(menuFacts.menuRight - menuFacts.triggerRight), `${A.menu}（${round}）：菜单右边对齐「⋯」`).toBeLessThanOrEqual(1.5)
  expect(menuFacts.menuTop, `${A.menu}（${round}）：菜单在「⋯」下面`).toBeGreaterThanOrEqual(menuFacts.triggerBottom)
  expect(menuFacts.triggerActive, `${A.menu}（${round}）：开着时「⋯」是按下的样子`).toBe('true')
  await shot(walk, win, `${round}-creation-menu`)

  // 菜单里的「项目符号」真的起列表，撤销（钉在右端的那颗）真的撤回。
  if (hiddenItems.some((item) => item.id === 'bullet-list')) {
    await clickOrFail(menu.locator('[data-menu-item="bullet-list"]'), `${A.menu}（${round}）：点「项目符号」`)
    await expect(win.locator(`${EDITOR_TEXT} ul`), `${A.menu}（${round}）：光标所在段变成列表`).toHaveCount(1)
    const listProof = await proveProbe(win.locator(`${EDITOR_TEXT} ul`), `${A.menu}（${round}）：菜单里点「项目符号」起了列表`)
    await expect(menu, `${A.menu}（${round}）：选完菜单关上`).toBeHidden()
    await clickOrFail(win.locator(`${TOOLBAR} [data-rich-text-action="undo"]`), `${A.overflow}（${round}）：点撤销`)
    await expectAbsent(win.locator(`${EDITOR_TEXT} ul`), { provenBy: listProof, message: `${A.overflow}（${round}）：撤销撤回了列表` })
  } else {
    await win.keyboard.press('Escape')
  }
  // 收起不影响 Markdown 输入规则：新起一段打「- 」照样起列表。
  await win.locator(EDITOR_TEXT).click()
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await win.keyboard.press('Enter')
  await win.keyboard.type('- ')
  await win.keyboard.insertText('rule')
  await expect(win.locator(`${EDITOR_TEXT} ul`), `${A.menu}（${round}）：收起之后「- 」输入规则照常起列表`).toHaveCount(1)
  const ruleProof = await proveProbe(win.locator(`${EDITOR_TEXT} ul`), `${round}：「- 」输入规则起了列表`)
  // 撤到列表没了为止（输入规则和随后打的字可能合成一步，也可能两步）；不多撤，免得撤掉前面的稿子。
  for (let step = 0; step < 3 && (await win.locator(`${EDITOR_TEXT} ul`).count()) > 0; step += 1) {
    await clickOrFail(win.locator(`${TOOLBAR} [data-rich-text-action="undo"]`), `${round}：撤销输入规则（第 ${step + 1} 下）`)
    await win.waitForTimeout(120)
  }
  await expectAbsent(win.locator(`${EDITOR_TEXT} ul`), { provenBy: ruleProof, message: `${round}：输入规则起的列表撤掉了` })
}

function previewGeometry(win) {
  return win.evaluate(({ agent, composer, spend, confirm, reject }) => {
    const box = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) }
    }
    const rails = [...document.querySelectorAll('.workbench-preview .workbench-panel-rail')].map((element) => ({ box: box(element), label: element.textContent.trim(), name: element.getAttribute('aria-label') }))
    return {
      innerWidth, innerHeight,
      preview: box(document.querySelector('.workbench-preview')),
      root: box(document.querySelector('#editing-surface-root')),
      agent: box(document.querySelector(agent)),
      composer: box(document.querySelector(`${agent} ${composer}`)),
      spendCard: box(document.querySelector(`${agent} ${spend}`)),
      spendConfirm: box(document.querySelector(`${agent} ${spend} ${confirm}`)),
      spendReject: box(document.querySelector(`${agent} ${spend} ${reject}`)),
      play: box(document.querySelector('.workbench-preview-player__play')),
      player: box(document.querySelector('.workbench-preview .workbench-preview-player')),
      timeline: box(document.querySelector('.workbench-preview .workbench-timeline__ruler-content') ?? document.querySelector('.workbench-preview .workbench-timeline__tracks')),
      rails,
      documentScrollHeight: document.scrollingElement.scrollHeight,
    }
  }, { agent: PREVIEW_PANEL, composer: COMPOSER, spend: SPEND, confirm: INTERVENTION_CONFIRM, reject: INTERVENTION_REJECT })
}

/** 整页跟窗口一样高：网格、Nomi 栏、付费卡的「生成 / 取消」、输入框、播放键、时间轴，底边都在窗内。 */
function assertPreviewFits(g, label) {
  const bottom = g.innerHeight + 0.5
  expect(g.root.bottom, `${A.rows}（${label}）：预览网格底边在窗内`).toBeLessThanOrEqual(bottom)
  expect(g.agent.bottom, `${A.rows}（${label}）：Nomi 栏底边在窗内`).toBeLessThanOrEqual(bottom)
  expect(g.composer, `${A.rows}（${label}）：Nomi 输入框在`).not.toBeNull()
  expect(g.composer.bottom, `${A.rows}（${label}）：Nomi 输入框在窗内`).toBeLessThanOrEqual(bottom)
  expect(g.spendConfirm, `${A.rows}（${label}）：付费卡上的「生成」在`).not.toBeNull()
  expect(g.spendConfirm.bottom, `${A.rows}（${label}）：付费卡上的「生成」在窗内（F2 当时掉到窗外）`).toBeLessThanOrEqual(bottom)
  expect(g.spendReject.bottom, `${A.rows}（${label}）：付费卡上的「取消」在窗内`).toBeLessThanOrEqual(bottom)
  expect(g.play.bottom, `${A.rows}（${label}）：播放键在窗内`).toBeLessThanOrEqual(bottom)
  expect(g.timeline.bottom, `${A.rows}（${label}）：时间轴在窗内`).toBeLessThanOrEqual(bottom)
  expect(g.documentScrollHeight, `${A.rows}（${label}）：整页不出竖向滚动`).toBeLessThanOrEqual(g.innerHeight)
}

async function previewStation(walk, win, round) {
  const report = facts[round]
  // ① 先把窗口调到 1100×720，再切到预览页——这一页「直接以 720 高打开」，不是从高窗口缩下来（协调 11-08）。
  await walk.resizeWindow(1100, 720)
  await win.waitForTimeout(300)
  await switchWorkspace(win, 'preview', `${round}：预览页`)
  await expect(win.locator('#editing-surface-root')).toBeVisible()
  await win.waitForTimeout(800)
  await expect(win.locator(`${PREVIEW_PANEL} ${SPEND}`), `${A.rows}（${round}）：预览页 Nomi 栏里那张付费卡在`).toBeAttached()
  const g = await previewGeometry(win)
  report.preview1100x720 = g
  await shot(walk, win, `${round}-preview-1100x720`)
  if (AFTER) {
    assertPreviewFits(g, `${round}，直接以 720 高打开`)
    expect(g.player.width, `${A.floor}（${round}）：1100 停靠时播放器不低于底线 400`).toBeGreaterThanOrEqual(400)
    expect(g.rails.length, `${A.strips}（${round}）：1100 停靠时至少一栏收成条`).toBeGreaterThan(0)
    for (const rail of g.rails) {
      expect(rail.box.width, `${A.strips}（${round}）：收起条宽 32（${rail.label}）`).toBe(32)
      expect(rail.label.length, `${A.strips}（${round}）：收起条有名字`).toBeGreaterThan(0)
    }
  }
  // ② 调研当时的路径：预览页开着、窗口从 900 高缩到 720（拖窗口下沿 / 半屏平铺 / 拔外接屏都会这样）。
  await walk.resizeWindow(1100, 900)
  await win.waitForTimeout(800)
  report.preview1100x900 = await previewGeometry(win)
  await walk.resizeWindow(1100, 720)
  await win.waitForTimeout(800)
  const shrunk = await previewGeometry(win)
  report.preview900to720 = shrunk
  await shot(walk, win, `${round}-preview-900to720`)
  if (AFTER) assertPreviewFits(shrunk, `${round}，预览页开着从 900 缩到 720`)
}

const present = createPresenter('S_WNARROW_PAGES')
const walk = await createRuntimeWalk('window-narrow-pages', { generationProvider: 'apimart', trustFixtureOrigin: true })
walk.report.phase = PHASE
walk.report.facts = facts
let failure
try {
  const { win } = await walk.start({ first: true })
  await walk.newProject()
  await typeStory(win)
  await creationStation(walk, win, 'zh-light')

  // 生成页：Nomi 停靠，起草三镜、摆上付费卡（夹具，零额度）。卡一直开着，到最后才取消。
  await walk.resizeWindow(1280, 900)
  await openCanvas(win)
  await expandResidentPanel(win)
  const drafted = await present(walk, win, {
    locale: 'zh-CN', kind: 'image',
    shots: (tag) => [1, 2, 3].map((index) => ({ title: `${tag} 纸船 ${index}`, prompt: `${tag} 纸船第 ${index} 镜：雨后清晨，纸船顺着水流漂`, taskKind: 'text_to_image', candidate: IMAGE })),
  })
  await previewStation(walk, win, 'zh-light')

  // 英文 · 暗色：同一个项目、不重载——语言走设置里的语言分段（生产入口），明暗按生产路径翻四个属性。
  await walk.resizeWindow(1280, 900)
  await setAppLanguage(win, 'en', 'en：设置里切英文')
  await applyColorSchemeForShot(win, 'dark')
  await creationStation(walk, win, 'en-dark')
  await previewStation(walk, win, 'en-dark')

  // 收尾：回生成页在卡上点「取消」，一笔不发。
  await walk.resizeWindow(1280, 900)
  await switchWorkspace(win, 'generation', '收尾：回生成页')
  await expandResidentPanel(win)
  await closeSpendCard(drafted.card, '收尾：付费卡点取消')
  await recorded(drafted.turnDone.received, '收尾：generate 在卡取消之后返回')
  expect(walk.fixture.images, '整条走查一笔图片都没提交').toHaveLength(0)
  walk.report.verified = AFTER ? Object.values(A) : ['before-phase-measured-only']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  if (shotDir) fs.writeFileSync(path.join(shotDir, `${PHASE}-facts.json`), JSON.stringify(facts, null, 2))
  await walk.finish(failure)
}
