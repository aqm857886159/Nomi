// R13 验收走查（「素材标签页重叠 + 重复的 Nomi 重新打开入口」）。
//   ① 剪辑页左栏「素材」拉到最窄（240px）：「全部素材 / 项目素材」两个标签的字不越出自己的按钮、不压到旁边的钮；
//      再往左拖过最小宽度：左栏变成收起条（不再把整块面板挤进 32px）；从收起条拖开：面板回来；
//   ② 生成页侧栏拉到最窄：同上；
//   ③ 剪辑页收起 Nomi：叫回 Nomi 的入口只有一个（顶栏角标），右侧不再多一条竖条。
// zh / en 各跑一遍（英文标签长 1.5–2 倍，截断只有真截图看得出）。
// 用法: pnpm build && node tests/ux/asset-tab-overlap-and-nomi-entry.walk.mjs [--locale en]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'

const locale = process.argv.includes('--locale') ? process.argv[process.argv.indexOf('--locale') + 1] : 'zh-CN'
const en = locale === 'en'
const shotsDir = path.join(repoRoot, `tests/ux/shots/asset-tab-overlap-and-nomi-entry-${locale}`)
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-asset-tab-'))
const projectsDir = path.join(tempRoot, 'projects')
const projectId = 'walk-asset-tab'
const projectName = en ? 'Narrow panels' : '窄栏验收'
const root = path.join(projectsDir, 'walk-asset-tab')
fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
const now = Date.now()
fs.writeFileSync(path.join(root, '.nomi', 'project.json'), JSON.stringify({
  id: projectId, name: projectName, version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: path.resolve(root),
  payload: { timeline: { version: 1, fps: 30, scale: 1, playheadFrame: 0, tracks: [] }, generationCanvas: { nodes: [], edges: [], groups: [], selectedNodeIds: [] } },
}))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`)
}
const snap = async (page, name) => {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`) }).catch(() => {})
  console.log(`  [shot] ${name}`)
}

/** 素材来源标签：每个标签的字是否越出自己的按钮、是否压到同一行的下一个控件。 */
async function measureSourceTabs(page, scopeSelector) {
  return page.evaluate(({ scopeSelector, labels }) => {
    const scope = document.querySelector(scopeSelector)
    if (!scope) return { found: false }
    const tablist = [...scope.querySelectorAll('[role="tablist"]')].find((list) => labels.every((label) => list.textContent?.includes(label)))
    if (!tablist) return { found: false }
    const tabs = [...tablist.querySelectorAll('[role="tab"]')]
    const next = tablist.nextElementSibling
    const nextRect = next?.getBoundingClientRect()
    const rows = tabs.map((tab) => {
      const box = tab.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(tab)
      const text = range.getBoundingClientRect()
      // 按「实际画出来的范围」算：按钮自己裁掉（overflow 非 visible）的那段不算越界。
      const clipped = getComputedStyle(tab).overflowX !== 'visible'
      const drawnLeft = clipped ? Math.max(text.left, box.left) : text.left
      const drawnRight = clipped ? Math.min(text.right, box.right) : text.right
      return {
        label: tab.textContent?.trim(),
        tabWidth: Math.round(box.width),
        textWidth: Math.round(text.width),
        truncated: clipped && text.width > box.width + 0.5,
        spills: drawnLeft < box.left - 0.5 || drawnRight > box.right + 0.5,
        coversNext: Boolean(nextRect && drawnRight > nextRect.left + 0.5 && drawnLeft < nextRect.right),
      }
    })
    return { found: true, tablistWidth: Math.round(tablist.getBoundingClientRect().width), rows }
  }, { scopeSelector, labels: en ? ['All assets', 'Project assets'] : ['全部素材', '项目素材'] })
}

/** 把一条分隔把手往左拖 `dx` 像素（真实鼠标）。 */
async function dragHandle(page, handle, dx) {
  const box = await handle.boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y, { steps: 6 })
  await page.mouse.move(x + dx, y, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}

let app
let win
try {
  ;({ app, win } = await launchNomiApp({
    name: `asset-tab-overlap-${locale}`,
    tempRoot,
    projectsDir,
    settleMs: 0,
    viewportSize: { width: 1440, height: 900 },
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
  }))
  await win.locator('[data-project-card]', { hasText: projectName }).first().click({ timeout: stationTimeout() })
  for (let i = 0; i < 40 && !app.windows().some((page) => /projectId=/.test(page.url())); i += 1) await win.waitForTimeout(250)
  win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
  await win.setViewportSize({ width: 1440, height: 900 })
  await win.locator('.nomi-stepper').first().waitFor({ timeout: stationTimeout() })

  // —— ② 生成页侧栏拉到最窄 ——
  const stage = win.locator('.react-flow__pane').first()
  if (!(await stage.isVisible().catch(() => false))) await win.locator('.nomi-stepper__step[data-mode="generation"]').first().click()
  await stage.waitFor({ state: 'visible', timeout: stationTimeout() })
  await win.locator(`aside nav button[aria-label="${en ? 'Asset library' : '素材库'}"]`).first().click()
  await win.waitForTimeout(800)
  await dragHandle(win, win.locator(`aside [aria-label="${en ? 'Resize sidebar' : '调整侧栏宽度'}"], aside [role="separator"]`).first(), -400)
  const sidebar = await measureSourceTabs(win, 'aside')
  await snap(win, '01-generation-sidebar-narrow')
  check('② 生成页侧栏最窄：素材来源标签的字不越出按钮、不压旁边的钮', sidebar.found && sidebar.rows.every((row) => !row.spills && !row.coversNext), JSON.stringify(sidebar))

  // —— ① 剪辑页左栏「素材」拉到最窄 ——
  await win.locator('.nomi-stepper__step[data-mode="preview"]').first().click()
  await win.waitForTimeout(1500)
  await win.locator('[role="tab"]', { hasText: en ? /^Assets$/ : /^素材$/ }).first().click()
  await win.waitForTimeout(800)
  const handle = win.locator('#editing-surface-stage-row [data-separator], #editing-surface-stage-row [role="separator"]').first()
  const sourcePanel = win.locator('#editing-surface-source')
  const widthBefore = Math.round((await sourcePanel.boundingBox()).width)
  await dragHandle(win, handle, 240 - widthBefore)
  const editing = await measureSourceTabs(win, '#editing-surface-source')
  const widthAtMin = Math.round((await sourcePanel.boundingBox()).width)
  await snap(win, '02-editing-source-min-width')
  check('① 剪辑页左栏最窄（240）：素材来源标签的字不越出按钮、不压旁边的钮', editing.found && editing.rows.every((row) => !row.spills && !row.coversNext), `width=${widthAtMin} ${JSON.stringify(editing)}`)

  // 再往左拖过最小宽度 → 面板库把栏吸成收起条：内容也要换成收起条，而不是整块面板挤进 32px。
  await dragHandle(win, handle, -300)
  const collapsedState = await win.evaluate(() => {
    const panel = document.querySelector('#editing-surface-source')
    return {
      width: Math.round(panel?.getBoundingClientRect().width ?? -1),
      rail: Boolean(panel?.querySelector('.workbench-panel-rail')),
      tablists: panel?.querySelectorAll('[role="tablist"]').length ?? -1,
    }
  })
  await snap(win, '03-editing-source-drag-collapsed')
  check('① 拖过最小宽度：左栏变成收起条，没有把面板内容挤进窄条', collapsedState.rail && collapsedState.tablists === 0, JSON.stringify(collapsedState))
  await dragHandle(win, handle, 300)
  const reopened = await win.evaluate(() => {
    const panel = document.querySelector('#editing-surface-source')
    return { width: Math.round(panel?.getBoundingClientRect().width ?? -1), rail: Boolean(panel?.querySelector('.workbench-panel-rail')) }
  })
  await snap(win, '04-editing-source-drag-reopened')
  check('① 从收起条拖开：面板完整回来', !reopened.rail && reopened.width >= 240, JSON.stringify(reopened))

  // —— ③ 收起 Nomi：叫回入口只有一个 ——
  await win.keyboard.press('Meta+Backslash')
  await win.waitForTimeout(800)
  const reopenEntries = await win.evaluate(() => [...document.querySelectorAll('button[aria-label]')]
    .filter((button) => /^(展开 Nomi|Open Nomi|Expand Nomi)/.test(button.getAttribute('aria-label') || '') && button.getBoundingClientRect().width > 0)
    .map((button) => button.getAttribute('aria-label')))
  await snap(win, '05-editing-nomi-collapsed')
  check('③ 剪辑页收起 Nomi 后，叫回入口只有顶栏那一个', reopenEntries.length === 1, JSON.stringify(reopenEntries))
} catch (error) {
  console.log(`  FAIL walk crashed: ${error?.stack || error}`)
  results.push({ name: 'crash', ok: false })
  if (win) await snap(win, '99-crash')
} finally {
  await app?.close().catch(() => {})
}
const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed · shots: ${path.relative(repoRoot, shotsDir)}`)
process.exit(failed.length ? 1 : 0)
