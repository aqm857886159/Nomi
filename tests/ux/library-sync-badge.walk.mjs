// 项目卡同步角标走查（2026-09-12）。
//
// 对的是 2026-09-11 用户实测反馈的两条：
//   ① 角标被截断——它显示的是完整那句「可在另一台电脑继续」，而卡片列宽只有 minmax(200px, 1fr)，
//      这一行左边还站着更新时间。改成角标只说状态（「已就绪」），完整那句退到 title 与浮层。
//   ② 浮层位置不对——原来 `absolute right-2 top-full` 挂在**卡片**上（贴卡片下沿、右对齐），
//      跟点的是哪一枚角标无关，卡在最后一行还会被滚动容器切掉。现在走 AnchoredPopover 贴角标。
//
// 判据不用 rect（裁切**不改** rect，见 design/AnchoredPopover.tsx 的抬头），
// 而用 `expectOverlayReachable`：真的从屏幕坐标打下去，看落到的是不是浮层自己。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, clickOrFail, proveProbe, expectAbsent, expectOverlayReachable } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const out = path.resolve('tests/ux/shots/library-sync-badge')
fs.mkdirSync(out, { recursive: true })

const run = await launchNomiApp({
  name: 'library-sync-badge',
  settleMs: 800,
  initialLocalStorage: { 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
})
const page = run.win
page.setDefaultTimeout(stationTimeout({ operations: 2 }))
const shot = (name) => page.screenshot({ path: path.join(out, name) })
const failures = []

try {
  await (await run.app.browserWindow(page)).evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1280, height: 900 }))

  // 建一个真项目：同步探测只对有 rootPath 的项目跑，所以必须有一张真卡片，不能灌状态。
  await clickOrFail(page.getByRole('button', { name: '新建空白项目', exact: false }).first(), '新建空白项目')
  await expectVisible(page.locator('[data-workspace-mode]').first(), '新项目没有进到工作区')
  await clickOrFail(page.getByRole('button', { name: '项目库', exact: false }).first(), '回项目库')

  const card = page.locator('[data-project-card="true"]').first()
  await expectVisible(card, '项目库里没有卡片')
  const badge = card.locator('[data-sync-status]')
  await expectVisible(badge, '项目卡上没有同步角标（同步探测没跑出来）')
  await shot('01-card-badge.png')

  // ① 角标不再被截断：可见文字**短于**完整那句，而完整那句在 title 上读得到。
  const badgeText = (await badge.innerText()).trim()
  const fullLabel = await badge.getAttribute('title')
  await expect(badgeText.length, `角标文字仍是长句（"${badgeText}"）`).toBeLessThanOrEqual(8)
  await expect(fullLabel, '角标 title 没有写完整那句').not.toBe(badgeText)
  // 真的没被截：滚动宽度不超过可见宽度（CSS 截断的指纹就是 scrollWidth > clientWidth）。
  const overflow = await badge.evaluate((el) => el.scrollWidth - el.clientWidth)
  await expect(overflow, `角标仍在截断（多出 ${overflow}px）`).toBeLessThanOrEqual(1)

  // ② 浮层贴的是被点的那枚角标，而且真的点得到（不是 DOM 里在、屏幕上被裁）。
  const popover = page.locator('[data-sync-popover]')
  const absent = await proveProbe(badge, '角标可达（浮层未开时它就在这儿）')
  await expectAbsent(popover, { provenBy: absent })
  await clickOrFail(badge, '点同步角标')
  await expectVisible(popover, '点角标没有出详情浮层')
  await expectOverlayReachable(popover, '同步详情浮层')
  const geometry = await page.evaluate(() => {
    const anchor = document.querySelector('[data-sync-status]')?.getBoundingClientRect()
    const layer = document.querySelector('[data-sync-popover]')?.getBoundingClientRect()
    const cardBox = document.querySelector('[data-project-card="true"]')?.getBoundingClientRect()
    return anchor && layer && cardBox
      ? { anchorLeft: anchor.left, layerLeft: layer.left, anchorBottom: anchor.bottom, layerTop: layer.top, cardBottom: cardBox.bottom }
      : null
  })
  await expect(geometry, '量不到角标/浮层几何').not.toBe(null)
  // 贴角标 = 横向和角标对齐（左对齐 align="start"），纵向紧跟角标下缘——
  // 而不是旧写法那样贴在**整张卡**的下沿（那条 |layerTop - cardBottom| 才会接近 0）。
  await expect(Math.abs(geometry.layerLeft - geometry.anchorLeft), '浮层没有和角标横向对齐').toBeLessThanOrEqual(24)
  await expect(geometry.layerTop - geometry.anchorBottom, '浮层没有紧跟角标下缘').toBeLessThanOrEqual(24)
  await shot('02-popover-anchored.png')

  // 顺带：原来点外面 / Esc 都关不掉它，AnchoredPopover 接上 onClose 之后才有。
  const open = await proveProbe(popover, '浮层此刻确实开着')
  await page.keyboard.press('Escape')
  await expectAbsent(popover, { provenBy: open })
  await shot('03-escape-closed.png')
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
  await shot('99-failure.png').catch(() => {})
} finally {
  await run.close()
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`  · 同步角标走查通过；截图在 ${out}`)
}
