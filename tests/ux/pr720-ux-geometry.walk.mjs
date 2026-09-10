/**
 * R13 走查 · PR #720 用户可见修复逐条复验（几何 / 交互面）。
 *
 * 覆盖 5 条（#1 提示词语言与 #4 apimart 填 key 另有脚本）：
 *   #5  左缘「+」更多菜单：hover 后指针斜着移进菜单仍开、各项可点；节点 composer 在场时菜单压在其上。
 *   #7  聊天框：长句软换行长高（≤上限）、删字缩回、权限弹层点外部关闭、发送/权限右锚。
 *   #13 收起态时间轴长条：agent 面板拖到最宽时不与左下工具组相交。
 *   #15 模型名长短变化时发送钮 rect.right 不动。
 *   #16 文字节点在左缘常驻区，不在「更多」菜单里。
 *
 * 隔离 profile（真实 catalog 拷贝，同机 safeStorage 可解）；不发消息、不调模型、不花钱。
 * 用法：node tests/ux/pr720-ux-geometry.walk.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { prepareIsolation } from '../../evals/lib/isoApp.mjs'
import { screenshotSettled, expectHittable, proveProbe, expectAbsent, clickOrFail, expectVisible } from './_assert.mjs'

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname)
const shots = path.join(repoRoot, 'tests/ux/shots/pr720-walkthrough')
fs.mkdirSync(shots, { recursive: true })

const results = []
function record(id, name, ok, detail) {
  results.push({ id, name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} [${id}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-pr720-geom-'))
const iso = prepareIsolation(isoDir, { requireCatalog: true })

const { app, win } = await launchNomiApp({
  name: 'pr720-ux-geometry',
  userDataDir: iso.chromiumDir, settingsDir: iso.settingsDir,
  projectsDir: iso.projectsDir, capabilityDir: iso.capabilityDir,
  args: ['--disable-gpu'], settleMs: 0,
})

const rectsOf = (selectors) => win.evaluate((sels) => {
  const out = {}
  for (const [name, sel] of Object.entries(sels)) {
    const el = document.querySelector(sel)
    if (!el) { out[name] = null; continue }
    const r = el.getBoundingClientRect()
    out[name] = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }
  return out
}, selectors)

const intersects = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)

try {
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) { w.setSize(1680, 1050); w.center() } }).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => { localStorage.setItem('nomi-color-scheme', 'light'); for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen') })
  await win.reload(); await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(2500)

  await clickOrFail(win.getByText('新建空白项目', { exact: false }), '新建空白项目')
  await win.waitForTimeout(2500)
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '生成 标签')
  await win.waitForTimeout(2000)
  await screenshotSettled(win, { path: path.join(shots, '00-generation-workspace.png') })

  // ───────── #16 文字节点回常驻区 ─────────
  const rail = win.locator('.generation-canvas-v2-toolbar').first()
  await expectVisible(rail, '左缘生成画布工具条')
  const residentLabels = await rail.locator('button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()))
  const moreButton = rail.locator('button[aria-label="更多"]').first()
  const textResident = residentLabels.includes('添加文字节点')
  record('#16', '文字节点在左缘常驻区（不在「更多」里）', textResident,
    `常驻按钮 = ${JSON.stringify(residentLabels)}`)

  // 打开「更多」菜单，确认文字不在其中（同一现场的对偶断言，不是空断言）
  await moreButton.hover()
  await win.waitForTimeout(500)
  const moreMenu = win.locator('.generation-canvas-v2-toolbar__more-menu').first()
  const moreVisible = await moreMenu.isVisible().catch(() => false)
  const moreLabels = moreVisible
    ? await moreMenu.locator('button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()))
    : []
  record('#16b', '「更多」菜单里已无文字节点', moreVisible && !moreLabels.some((l) => l.includes('文字')),
    `更多菜单 = ${JSON.stringify(moreLabels)}（菜单可见=${moreVisible}）`)
  await screenshotSettled(win, { path: path.join(shots, '16-text-node-resident.png') })

  // ───────── #5 「+」hover 菜单：斜着移进去仍开、可点 ─────────
  // 先造一个节点 composer 在场（复现「后挂载的 composer 盖住菜单」那一幕）
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(300)
  const newBoard = win.locator('button', { hasText: '新建画面' }).first()
  if (await newBoard.count()) { await clickOrFail(newBoard, '新建画面'); await win.waitForTimeout(1500) }
  await clickOrFail(rail.locator('button[aria-label="添加图片节点"]'), '左缘「添加图片节点」')
  await win.waitForTimeout(1800)
  const composerCardCount = await win.locator('.generation-canvas-v2-node__composer-card').count()
  await screenshotSettled(win, { path: path.join(shots, '05-node-composer-present.png') })

  // hover「+」，等菜单出。两条真人路径各走一遍：
  //  A 直线斜插（指针直奔菜单顶部一项）——用户反馈 #5 描述的正是这一种；
  //  B 先横穿 8px 桥再上行（本 PR 新增的 before 桥覆盖的那条）。
  const moreBox = await moreButton.boundingBox()
  const center = { x: moreBox.x + moreBox.width / 2, y: moreBox.y + moreBox.height / 2 }
  async function hoverOpenMenu() {
    await win.mouse.move(1000, 300)
    await win.waitForTimeout(400)
    await win.mouse.move(center.x, center.y)
    await win.waitForTimeout(700)
    return await moreMenu.isVisible().catch(() => false)
  }
  async function walkPath(points, { stepPx = 2, dwellMs = 18 } = {}) {
    let closedAt = null
    let cursor = { ...center }
    for (const target of points) {
      const steps = Math.max(1, Math.ceil(Math.hypot(target.x - cursor.x, target.y - cursor.y) / stepPx))
      for (let i = 1; i <= steps; i += 1) {
        const x = cursor.x + (target.x - cursor.x) * i / steps
        const y = cursor.y + (target.y - cursor.y) * i / steps
        await win.mouse.move(x, y)
        await win.waitForTimeout(dwellMs)
        if (!(await moreMenu.count())) { closedAt = { x: Math.round(x), y: Math.round(y) } ; break }
      }
      if (closedAt) break
      cursor = { ...target }
    }
    return closedAt
  }

  const openedFirst = await hoverOpenMenu()
  const menuBox = openedFirst ? await moreMenu.boundingBox() : null
  const zOrder = await win.evaluate(() => {
    const menu = document.querySelector('.generation-canvas-v2-toolbar__more-menu')
    const card = document.querySelector('.generation-canvas-v2-node__composer-card')
    const zi = (el) => { if (!el) return null; const v = getComputedStyle(el).zIndex; return v === 'auto' ? 'auto' : Number.parseInt(v, 10) }
    return { menuZ: zi(menu), cardZ: zi(card), cardPresent: Boolean(card) }
  })

  // 四条真人路径 = {最顶项, 最底项} × {慢, 快}。
  //  · 最顶项在按钮**上沿之上** 100+px，指针必须斜着往上走 —— 2026-09-11 走查红的就是它；
  //  · 最底项与按钮同高，指针几乎不离开按钮那条横带（对照组：这条一直是绿的）；
  //  · 慢（1px/30ms）与快（8px/4ms）各跑一次：hover 若还靠「缝里停多久」判定，慢的那条必红。
  // 每条都必须①全程不关 ②到达后目标项真的可点（expectHittable 会验命中、可见、未被遮挡）。
  const HOVER_PATHS = [
    { id: 'top-slow', label: '奔最顶项 · 慢（1px/30ms）', aim: 'top', speed: { stepPx: 1, dwellMs: 30 } },
    { id: 'top-fast', label: '奔最顶项 · 快（8px/4ms）', aim: 'top', speed: { stepPx: 8, dwellMs: 4 } },
    { id: 'bottom-slow', label: '奔最底项 · 慢（1px/30ms）', aim: 'bottom', speed: { stepPx: 1, dwellMs: 30 } },
    { id: 'bottom-fast', label: '奔最底项 · 快（8px/4ms）', aim: 'bottom', speed: { stepPx: 8, dwellMs: 4 } },
  ]
  const hoverRuns = []
  for (const spec of HOVER_PATHS) {
    const opened = await hoverOpenMenu()
    const box = opened ? await moreMenu.boundingBox() : null
    if (!box) { hoverRuns.push({ ...spec, opened, closedAt: null, held: false, hittable: false, detail: '菜单没打开' }); continue }
    // 瞄准项本体的文字起点一侧（真人点的是字，不是菜单中线）：这是斜率最陡、缝最长的那条路径。
    const target = spec.aim === 'top'
      ? { x: box.x + 24, y: box.y + 20 }
      : { x: box.x + 24, y: box.y + box.height - 18 }
    const closedAt = await walkPath([target], spec.speed)
    const held = !closedAt && await moreMenu.isVisible().catch(() => false)
    let hittable = false
    let detail = ''
    if (held) {
      const item = spec.aim === 'top' ? moreMenu.locator('button').first() : moreMenu.locator('button').last()
      try { await expectHittable(item, `更多菜单${spec.aim === 'top' ? '第一' : '最后一'}项`); hittable = true }
      catch (error) { detail = String(error?.message || error).slice(0, 120) }
    }
    hoverRuns.push({ ...spec, opened, closedAt, held, hittable, detail })
    await screenshotSettled(win, { path: path.join(shots, `05-more-menu-${spec.id}.png`) })
  }

  record('#5', 'hover「+」后斜着移进菜单（顶/底项 × 慢/快 四条路径）：菜单全程不关、目标项可点',
    hoverRuns.length === HOVER_PATHS.length && hoverRuns.every((run) => run.opened && run.held && run.hittable),
    `按钮=[${Math.round(moreBox.x)},${Math.round(moreBox.x + moreBox.width)}]x[${Math.round(moreBox.y)},${Math.round(moreBox.y + moreBox.height)}] `
    + `菜单=[${Math.round(menuBox?.x)},${Math.round(menuBox?.x + menuBox?.width)}]x[${Math.round(menuBox?.y)},${Math.round(menuBox?.y + menuBox?.height)}]`
    + `（菜单高过按钮 ${Math.round(moreBox.y - (menuBox?.y ?? 0))}px，奔顶项必须斜着往上走）；`
    + hoverRuns.map((run) => `${run.label}：${run.closedAt ? `在 (${run.closedAt.x},${run.closedAt.y}) 提前关闭` : '全程保持'}、可点=${run.hittable}${run.detail ? `（${run.detail}）` : ''}`).join('；'))
  record('#5b', '节点 composer 在场时更多菜单 z 序在其上',
    zOrder.cardPresent && typeof zOrder.menuZ === 'number' && (zOrder.cardZ === 'auto' || zOrder.menuZ > zOrder.cardZ),
    `menu z=${zOrder.menuZ}, composer-card z=${zOrder.cardZ}, composer 卡数=${composerCardCount}`)

  await win.mouse.move(900, 400)
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(500)

  // ───────── #7 聊天框 ─────────
  const SEL = {
    composer: '[data-v4-block="composer"]',
    input: '[data-v4-control="input"]',
    send: '[data-v4-control="send"]',
    permission: '[data-v4-control="permission"]',
    model: '[data-v4-control="model"]',
    panel: '[data-agent-resident="true"][data-agent-panel="true"]',
  }
  const input = win.locator(SEL.input).first()
  await expectVisible(input, 'agent 面板输入框')
  const before = await rectsOf(SEL)
  await input.click()
  const longText = '这是一段用来验证聊天框软换行自适应的连续中文长句不带任何回车符号'.repeat(4).slice(0, 200)
  await input.type(longText, { delay: 4 })
  await win.waitForTimeout(700)
  const grown = await rectsOf(SEL)
  const cap = await win.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? Number.parseFloat(getComputedStyle(el).maxHeight) : NaN
  }, SEL.composer)
  const grewOk = grown.composer.height > before.composer.height + 8 && (!Number.isFinite(cap) || grown.composer.height <= cap + 1)
  record('#7a', `连打 ${longText.length} 字不带回车：composer 长高且不超上限`, grewOk,
    `高度 ${Math.round(before.composer.height)} → ${Math.round(grown.composer.height)}（上限 ${Number.isFinite(cap) ? Math.round(cap) : 'n/a'}）`)
  await screenshotSettled(win, { path: path.join(shots, '07a-composer-grown.png') })

  const probeInput = () => win.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? { valueLength: el.value.length, scrollHeight: el.scrollHeight, height: Math.round(el.getBoundingClientRect().height) } : null
  }, SEL.input)
  await input.press('Meta+A')
  await input.press('Backspace')
  // 给足 3s 再量：700ms 量到不缩会被当成「还没重排」。
  await win.waitForTimeout(3000)
  const shrunk = await rectsOf(SEL)
  const measured = await probeInput()
  // 失焦一次再量：旧实现（把 flex 拉伸项压到 height:0 读 scrollHeight）在这三个时机全都不缩，
  // 所以三个都得断，只断第一个会漏掉「只在 change 那一帧临时收一下」的假修。
  const panelForBlur = (await rectsOf(SEL)).panel
  await win.mouse.click(panelForBlur.left + panelForBlur.width / 2, panelForBlur.top + 120)
  await win.waitForTimeout(600)
  const blurred = await rectsOf(SEL)
  // 再打一次同样长的一段、再删空：证明它是可逆的，不是「第一次删对了、第二次又棘轮住」。
  await input.click()
  await input.type(longText, { delay: 2 })
  await win.waitForTimeout(700)
  const regrown = await rectsOf(SEL)
  await input.press('Meta+A')
  await input.press('Backspace')
  await win.waitForTimeout(900)
  const reshrunk = await rectsOf(SEL)
  const backToOne = (rect) => Math.abs(rect.composer.height - before.composer.height) <= 2
  record('#7b', '删字后 composer 缩回一行高（清空 / 失焦 / 再打再删 三个时机都缩）',
    backToOne(shrunk) && backToOne(blurred) && backToOne(reshrunk)
    && regrown.composer.height > before.composer.height + 8,
    `原 ${Math.round(before.composer.height)} → 打满 ${Math.round(grown.composer.height)} → 清空 ${Math.round(shrunk.composer.height)}`
    + ` → 失焦 ${Math.round(blurred.composer.height)} → 再打满 ${Math.round(regrown.composer.height)} → 再清空 ${Math.round(reshrunk.composer.height)}；`
    + `清空时 textarea 内容长度=${measured?.valueLength} scrollHeight=${measured?.scrollHeight}（自身高度 ${measured?.height}）`)
  await screenshotSettled(win, { path: path.join(shots, '07b-composer-shrunk.png') })

  // 权限弹层：点开 → 点面板别处 → 关闭
  const popover = win.locator('[data-v4-popover="permission"]')
  await win.locator(SEL.permission).first().click()
  await win.waitForTimeout(500)
  // 先证探针会亮（弹层真的开了），再证点外部后它持续消失——否则「没看到弹层」和
  // 「选择器压根没找对」在日志里长得一模一样（_assert.mjs 的两道门）。
  let popoverProof = null
  try { popoverProof = await proveProbe(popover, '权限弹层点开后确实出现') } catch { popoverProof = null }
  await screenshotSettled(win, { path: path.join(shots, '07c-permission-popover-open.png') })
  const panelRect = (await rectsOf(SEL)).panel
  await win.mouse.click(panelRect.left + panelRect.width / 2, panelRect.top + 120)
  let popoverClosed = false
  if (popoverProof) {
    try {
      await expectAbsent(popover, { provenBy: popoverProof, message: '权限弹层点外部后应当关闭' })
      popoverClosed = true
    } catch { popoverClosed = false }
  }
  record('#7c', '权限弹层点外部即关闭', Boolean(popoverProof) && popoverClosed,
    `点开时探针可见=${Boolean(popoverProof)} 点外部后持续消失=${popoverClosed}`)
  await screenshotSettled(win, { path: path.join(shots, '07d-permission-popover-closed.png') })

  const anchored = await rectsOf(SEL)
  const sendInset = anchored.composer.right - anchored.send.right
  const permAfterSpacer = anchored.permission.left > anchored.model.right
  record('#7d', '发送钮与权限钮锚在底栏右侧', sendInset >= 0 && sendInset <= 12 && permAfterSpacer,
    `composer.right=${Math.round(anchored.composer.right)} send.right=${Math.round(anchored.send.right)}（内缩 ${Math.round(sendInset)}px）`)

  // ───────── #15 模型名长短变化，发送钮 right 不变 ─────────
  // 真人动作：点模型钮 → 在「对话」那一行的下拉里选模型；选最短名与最长名各一次。
  await win.locator(SEL.model).first().click()
  await win.waitForTimeout(600)
  const modelPopover = win.locator('[data-v4-popover="model"]').first()
  const modelPopoverVisible = await modelPopover.isVisible().catch(() => false)
  await screenshotSettled(win, { path: path.join(shots, '15a-model-popover.png') })
  const labels = []
  const sendRights = []
  if (modelPopoverVisible) {
    const chatTrigger = () => win.locator('[data-v4-popover="model"] [data-v4-model-row="对话"] button').first()
    await clickOrFail(chatTrigger(), '模型弹层「对话」行触发器')
    await win.waitForTimeout(700)
    // 作用域：只认「对话」那颗触发器 aria-controls 指到的 listbox（页面上另有图片/视频两个）。
    const listboxId = await chatTrigger().getAttribute('aria-controls')
    const optionTexts = await win.evaluate((id) => {
      const box = id ? document.getElementById(id) : null
      if (!box) return []
      return Array.from(box.querySelectorAll('[role="option"]')).map((o) => (o.textContent || '').trim())
    }, listboxId)
    const ranked = optionTexts.map((text, index) => ({ text, index })).filter((o) => o.text && o.text !== '自动选')
      .sort((a, b) => a.text.length - b.text.length)
    const picks = ranked.length >= 2 ? [ranked[0], ranked[ranked.length - 1]] : ranked
    for (let n = 0; n < picks.length; n += 1) {
      const pick = picks[n]
      if (n > 0) {
        await win.locator(SEL.model).first().click().catch(() => {})
        await win.waitForTimeout(500)
        await clickOrFail(chatTrigger(), '模型弹层「对话」行触发器')
        await win.waitForTimeout(600)
      }
      const currentId = await chatTrigger().getAttribute('aria-controls').catch(() => listboxId)
      await clickOrFail(win.locator(`#${currentId || listboxId} [role="option"]`).nth(pick.index), `对话行模型选项「${pick.text}」`)
      await win.waitForTimeout(900)
      await win.keyboard.press('Escape').catch(() => {})
      await win.waitForTimeout(500)
      const r = await rectsOf(SEL)
      const shownLabel = (await win.locator(SEL.model).first().innerText().catch(() => '')).trim()
      labels.push(`${pick.text}(${pick.text.length}字)→底栏显示"${shownLabel}"`)
      sendRights.push(Math.round(r.send.right))
      await screenshotSettled(win, { path: path.join(shots, `15-model-${n + 1}.png`) })
    }
  }
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(400)
  const distinctLabels = new Set(labels.map((l) => l.split('底栏显示')[1]))
  const rightStable = sendRights.length >= 2 && new Set(sendRights).size === 1 && distinctLabels.size >= 2
  record('#15', '模型名长短变化后发送钮 rect.right 不变', rightStable,
    `${labels.join(' ｜ ')}；send.right = ${JSON.stringify(sendRights)}${distinctLabels.size < 2 ? '（⚠ 底栏文案没真的变，断言无效）' : ''}`)

  // ───────── #13 面板拖到最宽后时间轴长条不压左下工具组 ─────────
  await win.keyboard.press('Escape').catch(() => {})
  // 同一 aria-label 的分隔条有两份（创作区那份 0x0 不可见）——取真正有面积的那一个。
  const separator = win.locator('[data-assistant-pane="true"] [role="separator"]')
  let sepBox = null
  for (let i = 0; i < await separator.count(); i += 1) {
    const box = await separator.nth(i).boundingBox()
    if (box && box.width > 0 && box.height > 0) { sepBox = box; break }
  }
  if (!sepBox) throw new Error('找不到可拖动的助手宽度分隔条')
  await win.mouse.move(sepBox.x + sepBox.width / 2, sepBox.y + sepBox.height / 2)
  await win.mouse.down()
  for (let x = sepBox.x; x >= 400; x -= 40) { await win.mouse.move(x, sepBox.y + sepBox.height / 2); await win.waitForTimeout(30) }
  await win.mouse.up()
  await win.waitForTimeout(900)
  const widened = await rectsOf({
    ...SEL,
    handle: '.workbench-generation__timeline-handle',
    navStack: '.generation-canvas-v2__navigation-stack',
    canvas: '.workbench-generation__canvas',
  })
  const overlap = intersects(widened.handle, widened.navStack)
  record('#13', 'agent 面板拖到最宽时「时间轴 · N 段」长条不与左下工具组相交', Boolean(widened.handle && widened.navStack) && !overlap,
    `面板宽=${Math.round(widened.panel.width)} 画布宽=${Math.round(widened.canvas.width)} 长条=[${Math.round(widened.handle?.left)},${Math.round(widened.handle?.right)}] 工具组=[${Math.round(widened.navStack?.left)},${Math.round(widened.navStack?.right)}] 相交=${overlap}`)
  await screenshotSettled(win, { path: path.join(shots, '13-timeline-pill-widest-panel.png') })

  fs.writeFileSync(path.join(shots, 'geometry-results.json'), JSON.stringify(results, null, 2))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length ? `✖ ${failed.length}/${results.length} 条红` : `✅ ${results.length} 条全绿`}；截图 ${shots}`)
  process.exitCode = failed.length ? 1 : 0
} catch (err) {
  console.log(`\n✖ 走查中断：${err?.stack || err?.message || err}`)
  await win.screenshot({ path: path.join(shots, 'geometry-FAIL.png') }).catch(() => {})
  fs.writeFileSync(path.join(shots, 'geometry-results.json'), JSON.stringify(results, null, 2))
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
