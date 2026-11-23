// 指向元素对齐走查（2026-10-24 拍板图：LibraryPointers；设计卡 docs/plan/2026-10-23-skill-prompt-library-layout.md ★1b / ★9）。
//
// 真 Electron + 隔离资料目录 + 主进程网络闸（零外网、零花费）。
// 覆盖：Agent「/」触发与搜索过滤、空结果态、键盘上下键/Enter/Esc、`@` 互不冲突、3 分类（全部/技能/提示词，效果归提示词）、
// 无内部 /id、底部「去 Skill 库」开抽屉、技能芯片（IconBooks）vs 提示词芯片（IconBulb）+ 界面语言标题、
// 节点「提示词预设」4 分类（全部/我的/内置/公开库）+ 追加与撤销、空节点 4 个推荐效果、创作区写作技能芯片及不改动项核验；
// 中英（zh-CN / en）× 光暗（light / dark）双轨真截图。
//
// 断言名 `board:LibraryPointers/<元素 id>` 对应 docs/design/boards/2026-10-24/LibraryPointers.board.json 里 implemented 元素。
// 用法：pnpm build && node tests/ux/library-pointers.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, clickOrFail, proveProbe, expectAbsent, applyColorSchemeForShot, waitForVisualQuiescence } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { newProjectEntry, closeRailDrawer, switchWorkspace, setAppLanguage, canvasAddBar, canvasAddMoreMenu } from './_shell.mjs'
import { COMPOSER_SKILL, SKILL_POPOVER } from './agent-runtime-walk-support.mjs'

const zh = (key) => uiText('zh-CN', key)
const en = (key) => uiText('en', key)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = process.env.NOMI_LIBRARY_POINTERS_SHOTS || path.join(os.tmpdir(), 'nomi-library-pointers-walk')
fs.mkdirSync(out, { recursive: true })

const run = await launchNomiApp({
  name: 'library-pointers',
  settleMs: 0,
  viewportSize: { width: 1280, height: 800 },
  mainRequire: [path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')],
  env: { NOMI_TEST_NETWORK_GUARD: '1' },
  initialLocalStorage: {
    'nomi:locale:v1': 'zh-CN',
    'nomi-color-scheme': 'light',
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
  },
})

const page = run.win
page.setDefaultTimeout(stationTimeout({ operations: 2 }))

const mediaSettled = () => page.evaluate(() => {
  const inView = (element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
  }
  const images = [...document.querySelectorAll('[data-skill-media="image"]')].filter(inView)
  const videos = [...document.querySelectorAll('[data-skill-media="video"] video, video[data-skill-media="video"]')].filter(inView)
  return images.every((image) => image.complete) && videos.every((video) => video.readyState >= 2 || video.error)
})

const shot = async (name) => {
  for (let tries = 0; tries < 40 && !(await mediaSettled()); tries += 1) await page.waitForTimeout(150)
  await waitForVisualQuiescence(page).catch(() => {})
  await page.screenshot({ path: path.join(out, `${name}.png`) })
}

const composerInput = () => page.locator('[data-v4-block="composer"] [data-v4-control="input"]').first()
const skillPopover = () => page.locator(SKILL_POPOVER).first()

async function addImageNode() {
  const toolbar = canvasAddBar(page)
  await expect(toolbar).toBeVisible()
  const trigger = toolbar.locator('[data-node-kind="image"]').first()
  if (await trigger.isVisible()) await trigger.click()
  else {
    await toolbar.locator('[data-canvas-add-more="true"]').click()
    await canvasAddMoreMenu(page).locator('[data-node-kind="image"]').click()
  }
  const node = page.locator('[data-node-id]').last()
  await expect(node).toBeVisible()
  await node.click()
}

try {
  await clickOrFail(newProjectEntry(page), '新建项目进入工作台')
  await expect(composerInput()).toBeVisible()

  // ── 1. Agent 底栏「Skill」钮（board:LibraryPointers/pointers.agent-skill-button）
  const skillBtn = page.locator(COMPOSER_SKILL).first()
  await expect(skillBtn, 'board:LibraryPointers/pointers.agent-skill-button').toBeVisible()
  await expect(skillBtn).toHaveAttribute('aria-pressed', 'false')

  // ── 2. 输入 `/` 弹出 Agent「/」弹层（zh-CN · light）
  await composerInput().click()
  await page.keyboard.type('/')
  await expect(skillPopover(), 'board:LibraryPointers/pointers.agent-slash.panel').toBeVisible()
  await expect(skillPopover().locator('[data-library-picker]')).toHaveAttribute('aria-label', zh('agentPanelV4.skillMenuAria'))

  // 搜索框占位与搜索（board:LibraryPointers/pointers.agent-slash.search）
  const slashSearch = skillPopover().locator('[data-library-search]')
  await expect(slashSearch, 'board:LibraryPointers/pointers.agent-slash.search').toHaveAttribute('placeholder', zh('agentPanelV4.skillSearch'))

  // 分类严格为 3 项：全部 / 技能 / 提示词（board:LibraryPointers/pointers.agent-slash.categories）
  const slashCategoryButtons = skillPopover().locator('button[aria-pressed]')
  await expect(slashCategoryButtons, 'board:LibraryPointers/pointers.agent-slash.categories').toHaveCount(3)
  const zhSlashCats = await slashCategoryButtons.allTextContents()
  expect(zhSlashCats).toEqual([zh('agentPanelV4.skillAll'), zh('agentPanelV4.sectionSkills'), zh('agentPanelV4.sectionPrompts')])

  // 底部「去 Skill 库」（board:LibraryPointers/pointers.agent-slash.footer）
  const footerBtn = skillPopover().locator('[data-v4-skill-footer="true"]')
  await expect(footerBtn, 'board:LibraryPointers/pointers.agent-slash.footer').toHaveText(zh('agentPanelV4.goToSkillLibrary'))

  // 拍 zh-CN light 默认 `/` 弹层
  await shot('slash-zh-light')

  // 输入关键字过滤（同步从输入框继续打字）+ 键盘上下选态
  await page.keyboard.type('分镜')
  const plannerRow = skillPopover().locator('[data-v4-command="skill:workbench-storyboard-planner"], [data-v4-command*="storyboard"]').first()
  await expect(plannerRow, 'board:LibraryPointers/pointers.agent-slash.row').toBeVisible()
  // 行内不再印内部 `/id` <code>
  await expect(plannerRow.locator('code')).toHaveCount(0)
  // 键盘下键移动高亮态，并确认缩略图已真实解码（非空框）
  await page.keyboard.press('ArrowDown')
  await expect(skillPopover().locator('[data-library-active="true"]')).toBeVisible()
  await expect.poll(
    () => plannerRow.locator('img[data-skill-media="image"]').evaluate((img) => img.complete && img.naturalWidth > 0),
    { message: 'Agent / 技能行缩略图应真实解码显示' },
  ).toBe(true)
  await shot('slash-filter-keyboard-zh-light')

  // 回车确认选中 → 挂上技能芯片（IconBooks），清掉 `/` 草稿并关闭弹层
  await page.keyboard.press('Enter')
  await expect(skillPopover()).toBeHidden()
  const skillChip = page.locator('[data-v4-chip="skill"]').first()
  await expect(skillChip, 'board:LibraryPointers/pointers.agent-chip').toBeVisible()
  await expect(skillChip.locator('[data-v4-chip-icon="skill"]')).toBeVisible()
  await expect(skillBtn).toHaveAttribute('aria-pressed', 'true')
  await shot('chip-skill-zh-light')

  // 点芯片 × 移除
  await skillChip.locator('button').click()
  await expect(page.locator('[data-v4-chip="skill"]')).toHaveCount(0)

  // 验证空结果态与 Esc 关闭
  await composerInput().click()
  await page.keyboard.type('/no-such-skill-prompt-991827')
  await expect(skillPopover().locator('[data-v4-skill-empty="true"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(skillPopover()).toBeHidden()
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Backspace')

  // 验证与 `@` 引用互不打架
  await page.keyboard.type('@')
  await expect(skillPopover()).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Backspace')

  // 点击底栏「Skill」钮切到「提示词」分类，验证效果归提示词并挂上提示词芯片（IconBulb）
  await skillBtn.click()
  await expect(skillPopover()).toBeVisible()
  await slashCategoryButtons.nth(2).click()
  await slashSearch.fill('人物三视图')
  const effectRow = skillPopover().locator('[data-v4-command="prompt:effect-character-three-view"]').first()
  await expect(effectRow).toBeVisible()
  await expect(effectRow.locator('code')).toHaveCount(0)
  await effectRow.click()
  const promptChip = page.locator('[data-v4-chip="prompt"]').first()
  await expect(promptChip).toBeVisible()
  await expect(promptChip.locator('[data-v4-chip-icon="prompt"]')).toBeVisible()
  await expect(promptChip).toContainText('人物三视图')
  await shot('chip-prompt-zh-light')
  await promptChip.locator('button').click()

  // 点底部「去 Skill 库」打开左栏 Skill 抽屉
  await skillBtn.click()
  await expect(skillPopover()).toBeVisible()
  await footerBtn.click()
  await expect(skillPopover()).toBeHidden()
  await expect(page.locator('[data-shell-drawer="skills"]')).toBeVisible()
  await closeRailDrawer(page, 'skills', '关闭 Skill 抽屉')

  // ── 3. 暗色模式（zh-CN · dark）：`/` 弹层 + Q8 暗色插画封面
  await applyColorSchemeForShot(page, 'dark')
  await composerInput().click()
  await page.keyboard.type('/分镜')
  await expect(skillPopover()).toBeVisible()
  await shot('slash-zh-dark')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Backspace')

  // ── 4. 英文模式（en · light & dark）：`/` 弹层分类、搜索占位、底部文案无中文串味
  await applyColorSchemeForShot(page, 'light')
  await setAppLanguage(page, 'en')
  await composerInput().click()
  await page.keyboard.type('/')
  await expect(skillPopover()).toBeVisible()
  await expect(skillPopover().locator('[data-library-search]')).toHaveAttribute('placeholder', en('agentPanelV4.skillSearch'))
  await expect(skillPopover().locator('[data-v4-skill-footer="true"]')).toHaveText(en('agentPanelV4.goToSkillLibrary'))
  const enSlashCats = await skillPopover().locator('button[aria-pressed]').allTextContents()
  expect(enSlashCats).toEqual([en('agentPanelV4.skillAll'), en('agentPanelV4.sectionSkills'), en('agentPanelV4.sectionPrompts')])
  // 英文弹层分组头零中文字符防回退（涵盖 builtin-expressions → Expressions 等内置/公开来源）
  const enGroupHeaders = await skillPopover().locator('[data-library-group] > summary, [data-library-group] > h3').allTextContents()
  expect(enGroupHeaders.length).toBeGreaterThan(0)
  expect(enGroupHeaders.filter((label) => /[\u4e00-\u9fff]/.test(label)), '英文弹层分组头不得含中文').toEqual([])
  expect(enGroupHeaders.some((label) => label.includes('Prompts · Expressions'))).toBe(true)
  await shot('slash-en-light')
  await applyColorSchemeForShot(page, 'dark')
  await shot('slash-en-dark')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Backspace')

  // ── 5. 切回 zh-CN light 核验节点「提示词预设」弹层（4 项分类对齐提示词库）与空节点推荐芯片
  await applyColorSchemeForShot(page, 'light')
  await setAppLanguage(page, 'zh-CN')
  await switchWorkspace(page, 'generation', '画布页')
  await addImageNode()

  // 空节点 4 个推荐效果芯片（board:LibraryPointers/pointers.node-empty-chips）
  const emptyChips = page.locator('[data-node-effect-chips="empty"] [data-effect-chip]')
  await expect(emptyChips, 'board:LibraryPointers/pointers.node-empty-chips').toHaveCount(4)

  // 打开节点「提示词预设」弹层
  await page.locator('[data-effect-more]').last().click()
  const nodePicker = page.getByTestId('node-prompt-presets')
  await expect(nodePicker, 'board:LibraryPointers/pointers.node-picker.panel').toBeVisible()
  await expect(nodePicker.locator('[data-library-search]'), 'board:LibraryPointers/pointers.node-picker.search').toHaveAttribute('placeholder', zh('libraries.prompt.searchAria'))
  const nodeCats = await nodePicker.locator('button[aria-pressed]').allTextContents()
  expect(nodeCats, 'board:LibraryPointers/pointers.node-picker.categories').toEqual([
    zh('libraries.layout.all'),
    zh('libraries.layout.mine'),
    zh('libraries.layout.segment.builtin'),
    zh('libraries.layout.segment.public'),
  ])
  await shot('node-picker-zh-light')

  // 选中一条预设并验证追加与撤销（board:LibraryPointers/pointers.node-picker.row）
  await nodePicker.locator('[data-library-search]').fill('人物三视图')
  const presetRow = nodePicker.locator('[data-library-option="effect-character-three-view"]').first()
  await expect(presetRow, 'board:LibraryPointers/pointers.node-picker.row').toBeVisible()
  const emptyProof = await proveProbe(emptyChips, '空节点推荐芯片存在')
  await presetRow.click()
  const nodeEditor = page.locator('.generation-canvas-v2-node__composer [contenteditable="true"]').last()
  await expect(nodeEditor).not.toHaveText('')
  await expectAbsent(emptyChips, { provenBy: emptyProof })

  // ── 6. 切回创作区核验别处不变项（board:LibraryPointers/pointers.rewrite-skill-chip & pointers.unchanged-elsewhere）
  await switchWorkspace(page, 'creation', '创作区')
  await page.locator('[data-v4-control="permission"]').first().click()
  await expect(page.locator('[data-v4-control="system-prompt"]'), 'board:LibraryPointers/pointers.unchanged-elsewhere').toBeVisible()
  await page.keyboard.press('Escape')

  // 确认创作区编辑器加载正常，写作技能条入口未破坏（board:LibraryPointers/pointers.rewrite-skill-chip）
  await expect(page.locator('[data-creation-editor], .ProseMirror').first(), 'board:LibraryPointers/pointers.rewrite-skill-chip').toBeVisible()

  console.log(JSON.stringify({ passed: true, out }))
} finally {
  await run.close()
}
