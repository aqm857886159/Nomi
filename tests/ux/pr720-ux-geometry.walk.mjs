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
import { screenshotSettled, expectHittable, proveProbe, expectAbsent } from './_assert.mjs'

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

  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 15000 })
  await win.waitForTimeout(2500)
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: 8000 })
  await win.waitForTimeout(2000)
  await screenshotSettled(win, { path: path.join(shots, '00-generation-workspace.png') })

  // ───────── #16 文字节点回常驻区 ─────────
  const rail = win.locator('.generation-canvas-v2-toolbar').first()
  await rail.waitFor({ state: 'visible', timeout: 10000 })
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
  if (await newBoard.count()) { await newBoard.click({ timeout: 5000 }).catch(() => {}); await win.waitForTimeout(1500) }
  await rail.locator('button[aria-label="添加图片节点"]').first().click({ timeout: 8000 }).catch(() => {})
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
  async function walkPath(points, stepPx = 2) {
    let closedAt = null
    let cursor = { ...center }
    for (const target of points) {
      const steps = Math.max(1, Math.ceil(Math.hypot(target.x - cursor.x, target.y - cursor.y) / stepPx))
      for (let i = 1; i <= steps; i += 1) {
        const x = cursor.x + (target.x - cursor.x) * i / steps
        const y = cursor.y + (target.y - cursor.y) * i / steps
        await win.mouse.move(x, y)
        await win.waitForTimeout(18)
        if (!(await moreMenu.count())) { closedAt = { x: Math.round(x), y: Math.round(y) } ; break }
      }
      if (closedAt) break
      cursor = { ...target }
    }
    return closedAt
  }

  const openedA = await hoverOpenMenu()
  const menuBox = openedA ? await moreMenu.boundingBox() : null
  const zOrder = await win.evaluate(() => {
    const menu = document.querySelector('.generation-canvas-v2-toolbar__more-menu')
    const card = document.querySelector('.generation-canvas-v2-node__composer-card')
    const zi = (el) => { if (!el) return null; const v = getComputedStyle(el).zIndex; return v === 'auto' ? 'auto' : Number.parseInt(v, 10) }
    return { menuZ: zi(menu), cardZ: zi(card), cardPresent: Boolean(card) }
  })
  // A：直奔菜单顶部一项（真人最短路径）
  const closedA = menuBox ? await walkPath([{ x: menuBox.x + menuBox.width / 2, y: menuBox.y + 20 }]) : { x: -1, y: -1 }
  const menuOpenAfterA = await moreMenu.isVisible().catch(() => false)
  let itemHittableA = false
  let hitDetailA = ''
  if (menuOpenAfterA) {
    try { await expectHittable(moreMenu.locator('button').first(), '更多菜单第一项'); itemHittableA = true } catch (e) { hitDetailA = String(e?.message || e).slice(0, 120) }
  }
  await screenshotSettled(win, { path: path.join(shots, '05-more-menu-diagonal.png') })

  // B：直奔菜单**最底**一项（与按钮同高，指针不离开按钮那条横带）——用来定位「哪一半没修好」。
  const openedB = await hoverOpenMenu()
  const menuBoxB = openedB ? await moreMenu.boundingBox() : null
  const closedB = menuBoxB
    ? await walkPath([{ x: menuBoxB.x + menuBoxB.width / 2, y: menuBoxB.y + menuBoxB.height - 18 }])
    : { x: -1, y: -1 }
  const menuOpenAfterB = await moreMenu.isVisible().catch(() => false)
  let itemHittableB = false
  if (menuOpenAfterB) {
    try { await expectHittable(moreMenu.locator('button').last(), '更多菜单最后一项'); itemHittableB = true } catch { itemHittableB = false }
  }
  await screenshotSettled(win, { path: path.join(shots, '05-more-menu-hover-hold.png') })

  record('#5', 'hover「+」后指针斜着移进菜单：菜单仍开且菜单项可点',
    openedA && !closedA && menuOpenAfterA && itemHittableA,
    `按钮=[${Math.round(moreBox.x)},${Math.round(moreBox.x + moreBox.width)}]x[${Math.round(moreBox.y)},${Math.round(moreBox.y + moreBox.height)}] 菜单=[${Math.round(menuBox?.x)},${Math.round(menuBox?.x + menuBox?.width)}]x[${Math.round(menuBox?.y)},${Math.round(menuBox?.y + menuBox?.height)}]；`
    + `奔顶项（菜单 ${Math.round(moreBox.y - (menuBox?.y ?? 0))}px 高过按钮，必须斜着往上走）${closedA ? `在 (${closedA.x},${closedA.y}) 提前关闭` : '全程保持'}（可点=${itemHittableA}）；`
    + `奔底项（与按钮同高、指针不离开按钮横带）${closedB ? `在 (${closedB.x},${closedB.y}) 关闭` : '全程保持'}（可点=${itemHittableB}）。`
    + `→ 8px before 桥只补了按钮那条横带的缝，菜单高出按钮的那一段没有 hit-area，`
    + `指针一离开按钮上沿（y<${Math.round(moreBox.y)}）且还没进菜单左沿（x<${Math.round(menuBox?.x)}）就 pointerleave 立刻关`)
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
  await input.waitFor({ state: 'visible', timeout: 10000 })
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

  await input.press('Meta+A')
  await input.press('Backspace')
  // 给足 3s 再量：700ms 量到不缩会被当成「还没重排」。实测 5s、失焦、重新打字再删都不缩。
  await win.waitForTimeout(3000)
  const shrunk = await rectsOf(SEL)
  const measured = await win.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? { valueLength: el.value.length, scrollHeight: el.scrollHeight, height: Math.round(el.getBoundingClientRect().height) } : null
  }, SEL.input)
  record('#7b', '删字后 composer 缩回原高', Math.abs(shrunk.composer.height - before.composer.height) <= 2,
    `高度回到 ${Math.round(shrunk.composer.height)}（原 ${Math.round(before.composer.height)}）；`
    + `清空后 textarea 内容长度=${measured?.valueLength} 但 scrollHeight 仍是 ${measured?.scrollHeight}（=它自己被撑开后的高度 ${measured?.height}）`
    + ` → 压 0 高测量对 flex 拉伸的 textarea 不生效，高度成了只涨不落的棘轮`)
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
    await chatTrigger().click({ timeout: 5000 })
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
        await chatTrigger().click({ timeout: 5000 }).catch(() => {})
        await win.waitForTimeout(600)
      }
      const currentId = await chatTrigger().getAttribute('aria-controls').catch(() => listboxId)
      await win.locator(`#${currentId || listboxId} [role="option"]`).nth(pick.index).click({ timeout: 5000 })
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
