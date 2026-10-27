// 分镜表窗口化走查（2026-10-16，性能波次 P-plan）：真实 Electron / IPC / 渲染 / 项目文件，**零生成额度**（全程不点生成）。
//
// 窗口化之后只有视口里的行挂在 DOM 上。这条走查把「旧功能普查」逐条在 320 镜的方案上点一遍，证明：
//   ① 打开只挂首屏 + 缓冲（行数 / 编辑器数远小于 320），行区报出逻辑总数 320；
//   ② 行高变了（打字、窗口变窄走窄档）各行按实测高度重排，首尾相接（不重叠、不留缝）；
//   ③ 焦点在编辑器里时滚走，这一行不卸（输入不丢），回来 Ctrl+Z 还能撤销刚打的字；
//   ④ 键盘上下移到视口外的镜：列表滚过去、焦点落在那一镜上；焦点行被钉住、视口滚远时按 ↓，没挂的下一镜按下标滚回来；
//   ⑤ 跨屏多选：点第 1 镜、滚到第 40 镜 Shift+点 → 选中 40 镜；
//   ⑥ 拖拽排序仍然换得动位置；
//   ⑦ 加一镜后总数 +1、滚到底够得着它；删掉它再 Ctrl+Z 回来；
//   ⑧ 滚到中间、滚到底，末镜挂得上；
//   ⑨ 英文 + 暗色 + 最小窗口（1100×690）：行走窄档、同样只挂首屏；
//   ⑪ 快速滚动：滚过的行先挂轻量占位、滚动中不建编辑器，停下后换成完整行（记长任务数）；
//   ⑫ 快速滚动后点占位行马上打字，字不丢；⑬ 重挂后接着改再撤销，新编辑另起一组；
//   ⑩ 生成中的状态刷新：画布节点状态一变，挂着的行立刻跟、视口外的行挂上时就是最新态（只改 store，不发请求）。
// 截图：zh 亮（顶 / 中 / 底）+ en 暗窄窗（顶 / 中 / 底），落在 STORYBOARD_WINDOWING_OUT（默认 .tmp/storyboard-windowing）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchCoreSmoke } from './core-smoke/fixture.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = process.env.STORYBOARD_WINDOWING_OUT || path.join(repoRoot, '.tmp', 'storyboard-windowing')
fs.mkdirSync(outDir, { recursive: true })

const SHOTS = 320
const DOC = 'doc-1'
const DESIGN = 'windowing-plan'
const plan = {
  title: '窗口化方案',
  anchors: [],
  shots: Array.from({ length: SHOTS }, (_, i) => ({
    index: i + 1, shotId: `shot-${i + 1}`, shotKind: 'video', durationSec: 5, anchorIds: [],
    prompt: `镜头 ${i + 1}：人物穿过雨夜的街道，镜头跟拍。`, modelKey: 'doubao-seedance-2.5', modelVendor: 'apimart',
  })),
}
const seed = () => ({
  nodes: [], groups: [], edges: [],
  payload: {
    workbenchDocuments: [{ id: DOC, version: 1, title: '文稿 001', updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '夜里的街道，雨一直在下。' }] }] } }],
    activeDocumentId: DOC,
    storyboardDesignsByDocumentId: { [DOC]: [{ id: DESIGN, documentId: DOC, title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
})

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}
const frames = (win) => win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const editor = (win) => win.locator('[data-storyboard-editor="true"]')
const rowSel = (n) => `[data-storyboard-editor="true"] [data-storyboard-row="${n}"]`
const promptBox = (n) => `${rowSel(n)} [data-prompt-box] [contenteditable="true"]`

async function mounted(win) {
  return win.evaluate(() => {
    const box = document.querySelector('[data-storyboard-rows]')
    return {
      rows: box ? box.querySelectorAll('[data-storyboard-row]').length : 0,
      editors: box ? box.querySelectorAll('[data-prompt-box]').length : 0,
      total: box ? Number(box.getAttribute('data-storyboard-row-count')) : -1,
      density: [...new Set([...(box?.querySelectorAll('[data-storyboard-row-density]') ?? [])].map((el) => el.getAttribute('data-storyboard-row-density')))],
    }
  })
}
async function scrollTo(win, where) {
  await win.evaluate((target) => {
    const scroll = document.querySelector('[data-storyboard-scroll]')
    scroll.scrollTop = target === 'bottom' ? scroll.scrollHeight : target === 'top' ? 0 : Math.round(scroll.scrollHeight / 2)
  }, where)
  for (let i = 0; i < 6; i += 1) await frames(win)
  await settled(win)
}
/** 往下滚到第 n 镜出现（滚动中它先是轻量占位），然后停下等它换成完整行。 */
async function scrollUntilRow(win, n) {
  const seen = () => win.locator(`${rowSel(n)}, [data-storyboard-editor="true"] [data-storyboard-row-placeholder="${n}"]`).count()
  for (let i = 0; i < 400; i += 1) {
    if (await seen()) {
      await win.locator(rowSel(n)).waitFor({ timeout: stationTimeout() })
      return true
    }
    await win.evaluate(() => { const scroll = document.querySelector('[data-storyboard-scroll]'); scroll.scrollTop += Math.round(scroll.clientHeight * 0.8) })
    await frames(win)
  }
  return false
}
/** 停下以后，视口附近的占位全部换成完整行。 */
async function settled(win) {
  await win.waitForFunction(() => !document.querySelector('[data-storyboard-row-placeholder]'), null, { timeout: stationTimeout() })
  for (let i = 0; i < 2; i += 1) await frames(win)
}
/** 挂着的各项（组头 / 镜头行）按下标排好，相邻两项首尾相接（容 1px 舍入）。 */
async function itemsContiguous(win) {
  return win.evaluate(() => {
    const items = [...document.querySelectorAll('[data-storyboard-rows] [data-storyboard-item]')]
      .map((el) => ({ index: Number(el.getAttribute('data-index')), rect: el.getBoundingClientRect() }))
      .sort((a, b) => a.index - b.index)
    const gaps = []
    for (let i = 1; i < items.length; i += 1) {
      if (items[i].index !== items[i - 1].index + 1) continue
      const gap = items[i].rect.top - items[i - 1].rect.bottom
      if (Math.abs(gap) > 1) gaps.push(`#${items[i - 1].index}→#${items[i].index} 缝 ${Math.round(gap)}`)
    }
    return { ok: items.length > 1 && gaps.length === 0, detail: gaps.length ? gaps.join('; ') : `${items.length} 项相接` }
  })
}
async function resize(smoke, win, size) {
  const browserWindow = await smoke.app.browserWindow(win)
  await browserWindow.evaluate((target, next) => target.setContentSize(next.width, next.height), size)
  await win.setViewportSize(size)
  for (let i = 0; i < 6; i += 1) await frames(win)
}
/**
 * HTML5 拖放：按浏览器的顺序派发 dragstart → dragover → drop → dragend（React 在根上监听原生事件）。
 * 每一步单独一次 evaluate（各自一个任务）：React 在两步之间把 dragstart 记下的「拖的是哪一镜」提交掉，
 * 和真人拖动时事件分属不同任务一致。
 */
async function dragRow(win, from, to) {
  const fromSel = `${rowSel(from)} [data-storyboard-row-drag]`
  const toSel = rowSel(to)
  const fire = (selector, types) => win.evaluate(({ selector, types }) => {
    const el = document.querySelector(selector)
    window.__walkDataTransfer ??= new DataTransfer()
    for (const type of types) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: window.__walkDataTransfer }))
  }, { selector, types })
  await fire(fromSel, ['dragstart'])
  await frames(win)
  await fire(toSel, ['dragenter', 'dragover'])
  await frames(win)
  await fire(toSel, ['drop'])
  await frames(win)
  await fire(fromSel, ['dragend'])
  for (let i = 0; i < 4; i += 1) await frames(win)
}
async function shot(win, name) {
  const file = path.join(outDir, `${name}.png`)
  await win.screenshot({ path: file })
  console.log(`  📷 ${file}`)
}

async function openPlan(win) {
  await win.locator('.nomi-stepper__step[data-mode="creation"]').first().click()
  await win.locator('[data-creation-document-switcher]').first().click()
  await win.getByRole('menuitem', { name: plan.title }).first().click()
  await win.locator(`${rowSel(1)} [data-prompt-box]`).first().waitFor({ timeout: stationTimeout({ operations: 3 }) })
  for (let i = 0; i < 4; i += 1) await frames(win)
}

async function passZhLight() {
  console.log('[windowing] zh · 亮 · 1280×800')
  const smoke = await launchCoreSmoke({ name: 'storyboard-windowing-zh', seed, needs: [], locale: 'zh-CN', preferences: { 'nomi-color-scheme': 'light' }, extras: { mainRequire: [path.join(repoRoot, 'tests', 'ux', '_quietWalk.cjs')], env: { ELECTRON_EXTRA_LAUNCH_ARGS: '--disable-features=CalculateNativeWinOcclusion' } } })
  try {
    await smoke.openProject()
    const win = smoke.win
    await openPlan(win)

    // ① 打开只挂首屏 + 缓冲
    const open = await mounted(win)
    check(open.total === SHOTS, '① 行区报出逻辑总数', `${open.total}`)
    check(open.rows > 0 && open.rows <= 16, '① 打开只挂首屏 + 缓冲的行', `挂 ${open.rows} 行 / ${SHOTS}`)
    check(open.editors <= open.rows, '① 编辑器数 ≤ 行数', `${open.editors}`)
    await shot(win, 'zh-light-top')

    // ② 编辑器里打几行字（后面 ③ 用）；行高变化后各项仍首尾相接（实测高度回写给虚拟列表，不重叠、不留缝）
    await win.locator(promptBox(1)).click()
    await win.keyboard.press('End')
    for (let i = 0; i < 4; i += 1) { await win.keyboard.press('Shift+Enter'); await win.keyboard.type(`追加第 ${i + 1} 行`) }
    for (let i = 0; i < 4; i += 1) await frames(win)
    const typedLayout = await itemsContiguous(win)
    check(typedLayout.ok, '② 打字后各行首尾相接（不重叠、不留缝）', typedLayout.detail)
    // 窗口变窄 → 行走窄档、整行变矮：每一项按实测高度重新排
    const before = await win.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().height, rowSel(2))
    await resize(smoke, win, { width: 1100, height: 690 })
    const after = await win.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().height, rowSel(2))
    const resizedLayout = await itemsContiguous(win)
    check(after !== before && resizedLayout.ok, '② 行高变了（窄档），各行按实测高度重排、首尾相接', `第 2 镜 ${Math.round(before)} → ${Math.round(after)}；${resizedLayout.detail}`)
    await resize(smoke, win, { width: 1280, height: 800 })

    // ③ 焦点在编辑器里滚走：这一行钉住不卸；回来 Ctrl+Z 撤销刚打的字
    await scrollTo(win, 'middle')
    const pinned = await win.locator(rowSel(1)).count()
    check(pinned === 1, '③ 正在编辑的行滚出视口仍挂着（输入不丢）')
    await shot(win, 'zh-light-middle')
    await scrollTo(win, 'top')
    const typed = await win.locator(promptBox(1)).innerText()
    await win.locator(promptBox(1)).click()
    for (let i = 0; i < 12; i += 1) await win.keyboard.press('Control+z')
    for (let i = 0; i < 3; i += 1) await frames(win)
    const undone = await win.locator(promptBox(1)).innerText()
    check(typed.includes('追加第 4 行') && !undone.includes('追加第'), '③ 滚走再回来，编辑器 Ctrl+Z 撤销仍可用', `撤销后：${undone.slice(0, 30)}`)

    // ③b 焦点换走 → 这一行卸载 → 回来撤销（V-1210 首轮的阻断项）：撤销历史不许跟着编辑器实例一起没了
    const original3 = await win.locator(promptBox(3)).innerText()
    await win.locator(promptBox(3)).click()
    await win.keyboard.press('Control+a')
    await win.keyboard.type('V1210 undo boundary')
    for (let i = 0; i < 3; i += 1) await frames(win)
    await win.locator(promptBox(4)).click()
    const row3Probe = await proveProbe(win.locator(rowSel(3)), '刚改完的第 3 镜挂着')
    await scrollTo(win, 'bottom')
    await expectAbsent(win.locator(rowSel(3)), { provenBy: row3Probe, message: '焦点换走后滚远，第 3 镜卸载了（不靠钉住）' })
    check(true, '③b 焦点换走后滚远：第 3 镜确实卸载了（不靠钉住）')
    await scrollTo(win, 'top')
    await win.locator(promptBox(3)).waitFor({ timeout: stationTimeout() })
    const remounted3 = await win.locator(promptBox(3)).innerText()
    await win.locator(promptBox(3)).click()
    await win.keyboard.press('Control+z')
    for (let i = 0; i < 3; i += 1) await frames(win)
    const undone3 = await win.locator(promptBox(3)).innerText()
    check(remounted3.includes('V1210 undo boundary') && undone3.trim() === original3.trim(), '③b 卸载再挂上后 Ctrl+Z：恢复原文', `回来时：${remounted3.slice(0, 24)}；撤销后：${undone3.slice(0, 24)}`)

    // ④ 键盘上下移到视口外
    await win.locator(rowSel(2)).evaluate((el) => el.focus())
    for (let i = 0; i < 12; i += 1) { await win.keyboard.press('ArrowDown'); await frames(win) }
    for (let i = 0; i < 4; i += 1) await frames(win)
    const focusInfo = await win.evaluate(() => {
      const row = document.activeElement?.closest('[data-storyboard-row]')
      const scroll = document.querySelector('[data-storyboard-scroll]').getBoundingClientRect()
      const rect = row?.getBoundingClientRect()
      return { row: row?.getAttribute('data-storyboard-row') ?? null, inView: Boolean(rect && rect.bottom > scroll.top && rect.top < scroll.bottom) }
    })
    check(focusInfo.row === '14' && focusInfo.inView, '④ 键盘 ↓ 移到原先没挂的第 14 镜：滚过去并聚焦', JSON.stringify(focusInfo))

    // ④b 相邻那一镜不在 DOM 里（焦点行被钉住、视口早已滚远）：按下标滚过去再聚焦
    await scrollTo(win, 'top')
    await win.locator(rowSel(1)).evaluate((el) => el.focus())
    await scrollTo(win, 'bottom')
    const secondMounted = await win.locator(rowSel(2)).count()
    await win.keyboard.press('ArrowDown')
    for (let i = 0; i < 6; i += 1) await frames(win)
    const farFocus = await win.evaluate(() => {
      const row = document.activeElement?.closest('[data-storyboard-row]')
      const scroll = document.querySelector('[data-storyboard-scroll]').getBoundingClientRect()
      const rect = row?.getBoundingClientRect()
      return { row: row?.getAttribute('data-storyboard-row') ?? null, inView: Boolean(rect && rect.bottom > scroll.top && rect.top < scroll.bottom) }
    })
    check(secondMounted === 0 && farFocus.row === '2' && farFocus.inView, '④b 焦点行滚远后按 ↓：没挂的下一镜滚回来并聚焦', JSON.stringify({ secondMounted, ...farFocus }))

    // ⑤ 跨屏多选
    await scrollTo(win, 'top')
    await win.locator(`${rowSel(1)} [data-storyboard-visual-column]`).click({ position: { x: 4, y: 4 } })
    const reached40 = await scrollUntilRow(win, 40)
    check(reached40, '⑤ 滚到第 40 镜')
    await win.locator(rowSel(40)).scrollIntoViewIfNeeded()
    await win.locator(`${rowSel(40)} [data-storyboard-visual-column]`).click({ position: { x: 4, y: 4 }, modifiers: ['Shift'] })
    await frames(win)
    const footerText = await win.locator('[data-storyboard-agent-handoff="footer"]').innerText().catch(() => '')
    check(/40/.test(footerText), '⑤ 跨屏 Shift 多选：选中 40 镜（页脚计数）', footerText.trim())
    await win.keyboard.press('Escape')

    // ⑥ 拖拽排序：第 3 镜拖到第 5 镜
    await scrollTo(win, 'top')
    // 清掉 ⑤ 的多选（浮条上的「×」，按词典里的无障碍名找），拖拽前回到无选择状态
    await win.getByRole('button', { name: uiText('zh-CN', 'storyboardEditor.selection.clear'), exact: true }).click()
    const promptOf = (n) => win.locator(promptBox(n)).innerText()
    const thirdBefore = await promptOf(3)
    await dragRow(win, 3, 5)
    const fifthAfter = await promptOf(5).catch(() => '')
    check(fifthAfter.trim() === thirdBefore.trim(), '⑥ 拖拽排序：第 3 镜的内容到了第 5 位', fifthAfter.slice(0, 20))

    // ⑦ 加一镜 → 总数 +1、够得着；删掉再 Ctrl+Z
    await scrollTo(win, 'bottom')
    await editor(win).getByRole('button', { name: uiText('zh-CN', 'storyboardEditor.addShot') }).click()
    for (let i = 0; i < 4; i += 1) await frames(win)
    const added = await mounted(win)
    check(added.total === SHOTS + 1, '⑦ 加一镜后逻辑总数 +1', `${added.total}`)
    await scrollTo(win, 'bottom')
    const lastReach = await scrollUntilRow(win, SHOTS + 1)
    check(lastReach, '⑦ 新加的末镜滚到底够得着')
    await win.locator(`[data-storyboard-row-menu-trigger="${SHOTS + 1}"]`).click()
    await win.locator(`[data-storyboard-row-menu="${SHOTS + 1}"]`).getByRole('button', { name: uiText('zh-CN', 'storyboardEditor.rowMenu.deleteUndoable'), exact: true }).click()
    for (let i = 0; i < 4; i += 1) await frames(win)
    const deleted = await mounted(win)
    check(deleted.total === SHOTS, '⑦ 删掉末镜：总数回到 320', `${deleted.total}`)
    await win.keyboard.press('Control+z')
    for (let i = 0; i < 4; i += 1) await frames(win)
    const restored = await mounted(win)
    check(restored.total === SHOTS + 1, '⑦ Ctrl+Z 撤销删除：末镜回来', `${restored.total}`)

    // ⑩ 生成中的状态刷新：画布里这一镜的节点状态一变，行跟着变——挂着的行立刻变，没挂的行挂上时就是新状态。
    //    只改画布 store（走查桥，__nomiE2E 下才有），不发任何生成请求。
    const setNodeStatus = (status) => win.evaluate(({ status, designId }) => {
      const store = window.__nomiCanvasStore
      const ids = ['walk-node-shot-2', 'walk-node-shot-200']
      const base = (id, shotId) => ({ id, kind: 'video', title: shotId, position: { x: 0, y: 0 }, status, meta: { storyboardDesignId: designId, shotId } })
      store.setState((state) => ({ nodes: [...state.nodes.filter((node) => !ids.includes(node.id)), base(ids[0], 'shot-2'), base(ids[1], 'shot-200')] }))
    }, { status, designId: DESIGN })
    const generateState = (n) => win.locator(`${rowSel(n)} [data-storyboard-generate-state]`).first().getAttribute('data-storyboard-generate-state').catch(() => null)
    check(await win.evaluate(() => Boolean(window.__nomiCanvasStore)), '⑩ 走查桥在（__nomiE2E）')
    await scrollTo(win, 'top')
    await setNodeStatus('running')
    for (let i = 0; i < 3; i += 1) await frames(win)
    check(await generateState(2) === 'busy', '⑩ 挂着的第 2 镜：节点跑起来，行立刻显示生成中')
    await scrollTo(win, 'top')
    check(await scrollUntilRow(win, 200), '⑩ 滚到第 200 镜')
    await win.locator(rowSel(200)).scrollIntoViewIfNeeded()
    check(await generateState(200) === 'busy', '⑩ 原先没挂的第 200 镜：挂上时就是生成中')
    await setNodeStatus('error')
    for (let i = 0; i < 3; i += 1) await frames(win)
    check(await generateState(200) === 'idle', '⑩ 第 200 镜节点失败：行退出生成中')
    await scrollTo(win, 'top')
    check(await generateState(2) === 'idle', '⑩ 滚回顶部：第 2 镜同样是最新状态（不是挂载时的快照）')

    // ⑪ 快速滚动（V-1210 首轮第 2 项）：100 次真滚轮、每次 800px、两帧一次。滚动中新进来的行先挂占位，
    //    不建编辑器；停下后占位换成完整行。记长任务与滚动中新建的编辑器数。
    await scrollTo(win, 'top')
    await win.evaluate(() => {
      const rows = document.querySelector('[data-storyboard-rows]')
      window.__walkScroll = { editorsCreated: 0, placeholders: 0, longTasks: 0 }
      window.__walkFrames = []
      let last = performance.now()
      const tick = (now) => { window.__walkFrames.push(now - last); last = now; if (window.__walkFrames.length < 20000 && !window.__walkFramesStop) requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      window.__walkScrollObserver = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          window.__walkScroll.editorsCreated += (node.matches('[data-prompt-box]') ? 1 : 0) + node.querySelectorAll('[data-prompt-box]').length
          window.__walkScroll.placeholders += (node.matches('[data-storyboard-row-placeholder]') ? 1 : 0) + node.querySelectorAll('[data-storyboard-row-placeholder]').length
        }
      })
      window.__walkScrollObserver.observe(rows, { childList: true, subtree: true })
      window.__walkLongTasks = new PerformanceObserver((list) => { window.__walkScroll.longTasks += list.getEntries().length })
      try { window.__walkLongTasks.observe({ type: 'longtask' }) } catch { /* 无长任务支持 */ }
    })
    const scrollBox = await win.locator('[data-storyboard-scroll]').boundingBox()
    await win.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2)
    for (let i = 0; i < 100; i += 1) { await win.mouse.wheel(0, 800); await frames(win) }
    const duringScroll = await win.evaluate(() => {
      window.__walkFramesStop = true
      const frames = [...window.__walkFrames].sort((a, b) => a - b)
      const at = (q) => Math.round(frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] * 10) / 10
      return { ...window.__walkScroll, scrollTop: document.querySelector('[data-storyboard-scroll]').scrollTop, frameP50: at(0.5), frameP95: at(0.95), frameMax: at(1) }
    })
    await settled(win)
    const afterSettle = await win.evaluate(() => { window.__walkScrollObserver.disconnect(); window.__walkLongTasks.disconnect(); return { ...window.__walkScroll } })
    check(duringScroll.scrollTop > 40000 && duringScroll.placeholders > 50 && duringScroll.editorsCreated <= 30, '⑪ 快速滚动：滚过的行先挂占位、滚动中几乎不建编辑器', JSON.stringify(duringScroll))
    // 占位长什么样（不计入上面的数字）：往回快滚几下，滚动中截一张
    await win.mouse.wheel(0, -2400)
    await frames(win)
    await win.screenshot({ path: path.join(outDir, 'zh-light-scrolling.png') })
    await settled(win)
    check((await mounted(win)).rows > 0, '⑪ 停下后占位换成完整行', `停下后又建了 ${afterSettle.editorsCreated - duringScroll.editorsCreated} 个编辑器；滚动全程长任务 ${afterSettle.longTasks} 个`)

    // ⑫ 点占位行马上打字（V-1210 复验 R2-1）：快速滚动后、占位还没换成完整行时，真鼠标点一行的提示词处、紧接着打字——字必须进这一镜的提示词
    await scrollTo(win, 'top')
    await win.locator(promptBox(1)).click()
    const scrollArea = await win.locator('[data-storyboard-scroll]').boundingBox()
    await win.mouse.move(scrollArea.x + scrollArea.width / 2, scrollArea.y + scrollArea.height / 2)
    await win.mouse.wheel(0, 6000)
    await frames(win)
    const target = await win.evaluate(() => {
      const scroll = document.querySelector('[data-storyboard-scroll]').getBoundingClientRect()
      for (const row of document.querySelectorAll('[data-storyboard-row-placeholder]')) {
        const prompt = row.querySelector('[data-storyboard-content-column]')
        const rect = prompt?.getBoundingClientRect()
        if (rect && rect.top > scroll.top + 4 && rect.bottom < scroll.bottom - 4) {
          return { index: row.getAttribute('data-storyboard-row-placeholder'), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        }
      }
      return null
    })
    check(Boolean(target), '⑫ 快速滚动后视口里有占位行可点（复现前提）', JSON.stringify(target))
    if (target) {
      await win.mouse.click(target.x, target.y)
      await win.keyboard.type(' V1210 immediate input')
      await settled(win)
      const typedInto = await win.locator(promptBox(Number(target.index))).innerText()
      check(typedInto.includes('V1210 immediate input'), '⑫ 点占位行马上打字：字进了这一镜的提示词（不丢）', `第 ${target.index} 镜：${typedInto.slice(-30)}`)
    }

    // ⑬ 重挂后接着改，再撤销（V-1210 复验 R2-2）：重挂后的新编辑另起一组，第一次 Ctrl+Z 只撤新编辑
    await scrollTo(win, 'top')
    const editRow = 4
    const originalEdit = await win.locator(promptBox(editRow)).innerText()
    await win.locator(promptBox(editRow)).click()
    await win.keyboard.press('Control+a')
    await win.keyboard.type('V1210 first completed edit')
    await win.locator(promptBox(5)).click()
    await scrollTo(win, 'bottom')
    // 回顶部后**一挂上就点进去打字**（不等其余行就绪）：重放历史的那一刻和新编辑紧挨着，正是复验抓到的时序
    await win.evaluate(() => { document.querySelector('[data-storyboard-scroll]').scrollTop = 0 })
    await win.locator(promptBox(editRow)).waitFor({ timeout: stationTimeout() })
    await win.locator(promptBox(editRow)).click()
    await win.keyboard.press('End')
    await win.keyboard.type(' SECOND')
    await win.keyboard.press('Control+z')
    for (let i = 0; i < 3; i += 1) await frames(win)
    const firstUndo = await win.locator(promptBox(editRow)).innerText()
    await win.keyboard.press('Control+z')
    for (let i = 0; i < 3; i += 1) await frames(win)
    const secondUndo = await win.locator(promptBox(editRow)).innerText()
    check(firstUndo.trim() === 'V1210 first completed edit' && secondUndo.trim() === originalEdit.trim(), '⑬ 重挂后接着改：第一次 Ctrl+Z 只撤新编辑，第二次回到原文', `第 ${editRow} 镜：一次后「${firstUndo.slice(0, 30)}」，两次后「${secondUndo.slice(0, 20)}」`)

    // ⑧ 滚到底：末镜挂上
    await scrollTo(win, 'bottom')
    const bottom = await mounted(win)
    check(await win.locator(rowSel(SHOTS + 1)).count() === 1, '⑧ 滚到底末镜挂着')
    check(bottom.rows <= 16, '⑧ 滚到底仍只挂视口附近的行', `${bottom.rows}`)
    await shot(win, 'zh-light-bottom')
  } finally {
    await smoke.close()
  }
}

async function passEnDarkNarrow() {
  console.log('[windowing] en · 暗 · 1100×690')
  const smoke = await launchCoreSmoke({ name: 'storyboard-windowing-en', seed, needs: [], locale: 'en', emptyViewport: { width: 1100, height: 690 }, preferences: { 'nomi-color-scheme': 'dark' }, extras: { mainRequire: [path.join(repoRoot, 'tests', 'ux', '_quietWalk.cjs')], env: { ELECTRON_EXTRA_LAUNCH_ARGS: '--disable-features=CalculateNativeWinOcclusion' } } })
  try {
    await smoke.openProject()
    const win = smoke.win
    await openPlan(win)
    const open = await mounted(win)
    check(open.total === SHOTS && open.rows > 0 && open.rows <= 16, '⑨ en 窄窗：同样只挂首屏 + 缓冲', `挂 ${open.rows} 行 / 总 ${open.total}`)
    const tableWidth = await win.evaluate(() => document.querySelector('[data-storyboard-rows]').clientWidth)
    check(open.density.length === 1 && open.density[0] === (tableWidth < 740 ? 'narrow' : 'wide'), '⑨ 行宽档位由行区量一次、每行一致', `表宽 ${tableWidth} → ${open.density.join(',')}`)
    await shot(win, 'en-dark-narrow-top')
    await scrollTo(win, 'middle')
    await shot(win, 'en-dark-narrow-middle')
    await scrollTo(win, 'bottom')
    check(await scrollUntilRow(win, SHOTS), '⑨ en 窄窗：末镜够得着')
    await shot(win, 'en-dark-narrow-bottom')
  } finally {
    await smoke.close()
  }
}

await passZhLight()
await passEnDarkNarrow()
if (failures.length) {
  console.error(`\n[windowing] ${failures.length} 项没过：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\n[windowing] 全部通过')
