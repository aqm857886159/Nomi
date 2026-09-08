// B3 花钱确认弹层的键盘/无障碍保障 —— R13 零额度真机走查。
// 方案：docs/plan/2026-09-07-design-system-optimization.md §1 B3。
// 用法: node tests/ux/spend-confirm-a11y.walk.mjs
// 产出: tests/ux/shots/spend-confirm-a11y/*.png（自己 Read 亲眼看）
//
// 背景：花钱确认卡是手写 `fixed inset-0` 全屏阻断层，此前 Esc / 焦点陷阱 / role=dialog 三样全缺——
// 比更轻的「删除确认」（走 DesignModal，三样全自动）保障更差。这条走查钉死四件事：
//   ① Esc 能关（等价于取消/忽略，且 resolve(false)）
//   ② Tab 出不去弹层（连按 12 次，焦点必须始终落在卡内）
//   ③ 关闭后焦点回到触发它的那个元素
//   ④ 打开时默认焦点**不在**「确认」钮上（落在对话框本体）
// 走真 app、真组件树：用 SpendConfirmDialog 在 __nomiE2E==='1' 时挂出的 window.__nomiSpendConfirmE2E
// 驱动**真实** requestConfirm（同 ConfirmDialogHost 的 __nomiConfirmDialogE2E 既有写法）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/spend-confirm-a11y')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-spend-a11y-'))
const settingsDir = path.join(tempRoot, 'settings')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [settingsDir, userDataDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const DIALOG = '[data-spend-confirm-dialog]'
const evidence = []
const check = (ok, message) => {
  console.log(`${ok ? '✅' : '❌'} ${message}`)
  if (!ok) throw new Error(message)
  evidence.push(message)
}

let app = null
let failed = false
try {
  app = await launchNomiApp({
    name: 'spend-confirm-a11y',
    settingsDir,
    userDataDir,
    projectsDir,
    args: ['--disable-gpu'],
    settleMs: 1800,
  })
  const win = app.win

  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)

  // 进 studio：花钱确认卡挂在 NomiStudioApp 根，库页上不存在。
  const blank = win.locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blank.waitFor({ state: 'visible', timeout: 20_000 })
  await blank.click()
  await win.waitForTimeout(2600)

  // E2E 桥就位（SpendConfirmDialog 懒加载，随 studio 挂载）。
  await win.waitForFunction(() => typeof window.__nomiSpendConfirmE2E === 'function', undefined, { timeout: 20_000 })
  check(true, '真实 requestConfirm 桥已挂出（走的是生产同一条渲染管线，不是复刻卡）')

  // 触发元素：拿一个 studio 里真实存在、可聚焦的按钮当「打开这张卡的人」。
  const triggerId = await win.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (el) => !el.disabled && el.getClientRects().length > 0,
    )
    if (!button) throw new Error('走查前提失效：studio 里找不到可聚焦按钮当触发元素')
    button.id = button.id || 'nomi-a11y-trigger'
    button.focus()
    return button.id
  })
  const triggerFocusedBefore = await win.evaluate((id) => document.activeElement?.id === id, triggerId)
  check(triggerFocusedBefore, `触发元素 #${triggerId} 在开卡前确实持有焦点（阳性前提）`)

  // ── 开卡 ─────────────────────────────────────────────────────────────────────
  const openCard = async (label) =>
    win.evaluate((confirmLabel) => {
      window.__nomiSpendA11yResult = 'pending'
      window
        .__nomiSpendConfirmE2E({
          title: 'B3 走查 · 花钱确认',
          message: '这一步会真花额度。走查只验键盘与无障碍保障，不发任何生成请求。',
          confirmLabel,
          details: [
            { label: '节点', value: '雨夜推门 ×1' },
            { label: '预估', value: '¥1.20' },
          ],
        })
        .then((ok) => {
          window.__nomiSpendA11yResult = ok ? 'confirmed' : 'cancelled'
        })
    }, label)

  await openCard('确认花费 ¥1.20')
  const dialog = win.locator(DIALOG).first()
  const probe = await proveProbe(dialog, '花钱确认卡探针可测到')
  await expectVisible(dialog, '花钱确认卡可见')

  const semantics = await dialog.evaluate((el) => ({
    role: el.getAttribute('role'),
    ariaModal: el.getAttribute('aria-modal'),
    labelledBy: el.getAttribute('aria-labelledby'),
    labelText: el.getAttribute('aria-labelledby')
      ? document.getElementById(el.getAttribute('aria-labelledby'))?.textContent?.trim()
      : null,
    zIndex: window.getComputedStyle(el.parentElement).zIndex,
  }))
  check(
    semantics.role === 'dialog' && semantics.ariaModal === 'true',
    `④a 语义：role=${semantics.role} / aria-modal=${semantics.ariaModal}`,
  )
  check(
    Boolean(semantics.labelledBy) && semantics.labelText === 'B3 走查 · 花钱确认',
    `④b aria-labelledby 指到真标题：「${semantics.labelText}」`,
  )
  check(semantics.zIndex === '9100', `z-index 走 NOMI_OVERLAY_Z_INDEX.dialog 常量（实测 ${semantics.zIndex}）`)

  // ── ④ 默认焦点不在「确认」上 ──────────────────────────────────────────────────
  await win.waitForTimeout(400)
  const initialFocus = await win.evaluate(() => {
    const active = document.activeElement
    return {
      isDialogItself: Boolean(active?.matches?.('[data-spend-confirm-dialog]')),
      insideDialog: Boolean(active?.closest?.('[data-spend-confirm-dialog]')),
      text: active?.textContent?.trim().slice(0, 40) ?? '',
      tag: active?.tagName ?? '',
    }
  })
  check(
    initialFocus.isDialogItself,
    `④ 打开时默认焦点落在对话框本体（${initialFocus.tag}），不是「确认花费」钮`,
  )
  check(
    !initialFocus.text.includes('确认花费'),
    '④ 反证：默认焦点上的文字不含「确认花费」，回车按不掉这笔钱',
  )
  await screenshotSettled(win, { path: path.join(shotsDir, '01-opened-default-focus.png') })

  // ── ② Tab 出不去 ────────────────────────────────────────────────────────────
  const outsideHits = []
  for (let i = 0; i < 12; i += 1) {
    await win.keyboard.press('Tab')
    const where = await win.evaluate(() => {
      const active = document.activeElement
      return {
        inside: Boolean(active?.closest?.('[data-spend-confirm-dialog]')),
        tag: active?.tagName ?? 'NONE',
        text: active?.textContent?.trim().slice(0, 24) ?? '',
      }
    })
    if (!where.inside) outsideHits.push(`第 ${i + 1} 次 Tab → ${where.tag} 「${where.text}」`)
  }
  check(outsideHits.length === 0, `② Tab 连按 12 次焦点始终在卡内（越界 ${outsideHits.length} 次）`)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-tab-trapped.png') })

  // 反向 Tab 也不能溜出去（scopeTab 两头都要圈住）。
  const backOutside = []
  for (let i = 0; i < 6; i += 1) {
    await win.keyboard.press('Shift+Tab')
    const inside = await win.evaluate(() =>
      Boolean(document.activeElement?.closest?.('[data-spend-confirm-dialog]')),
    )
    if (!inside) backOutside.push(i + 1)
  }
  check(backOutside.length === 0, `② Shift+Tab 连按 6 次同样出不去（越界 ${backOutside.length} 次）`)

  // ── ① Esc 能关 + ③ 焦点返回 ─────────────────────────────────────────────────
  await win.keyboard.press('Escape')
  await expectAbsent(
    win.locator(DIALOG),
    { provenBy: probe, message: '① 按 Esc 后花钱确认卡消失' },
  )
  const resolved = await win.evaluate(() => window.__nomiSpendA11yResult)
  check(resolved === 'cancelled', `① Esc 等价于取消：requestConfirm resolve 到 ${resolved}（不是 confirmed）`)

  await win.waitForTimeout(300)
  const returned = await win.evaluate((id) => {
    const active = document.activeElement
    return { id: active?.id ?? '', tag: active?.tagName ?? 'NONE', match: active?.id === id }
  }, triggerId)
  check(returned.match, `③ 关闭后焦点回到触发元素 #${triggerId}（实测 ${returned.tag}#${returned.id}）`)
  await screenshotSettled(win, { path: path.join(shotsDir, '03-closed-focus-returned.png') })

  // ── 回归：点「取消」也照样还焦点（Esc 不是唯一出口） ─────────────────────────
  await win.evaluate((id) => document.getElementById(id)?.focus(), triggerId)
  await openCard('确认花费 ¥1.20')
  await expectVisible(win.locator(DIALOG).first(), '第二次开卡可见（用于验证按钮出口）')
  await win.locator(DIALOG).getByRole('button', { name: '取消' }).first().click()
  await expectAbsent(win.locator(DIALOG), { provenBy: probe, message: '点「取消」后卡消失' })
  await win.waitForTimeout(300)
  const returnedAgain = await win.evaluate((id) => document.activeElement?.id === id, triggerId)
  check(returnedAgain, '③ 走「取消」钮关闭时焦点同样回到触发元素')

  // ── 顺带：其它手写浮层的 Esc（同一个 useOverlayEscape 原语） ────────────────────
  // 时间轴「快捷键」说明框：它自己就是那张教键盘的卡，此前偏偏不认 Esc。
  await clickOrFail(win.getByRole('button', { name: '预览', exact: true }).first(), '切到预览视图')
  await win.waitForTimeout(1200)
  const shortcutsButton = win.getByRole('button', { name: /快捷键/ }).first()
  await shortcutsButton.waitFor({ state: 'visible', timeout: 15_000 })
  await shortcutsButton.click()
  const shortcuts = win.getByRole('dialog', { name: '快捷键' })
  const shortcutsProbe = await proveProbe(shortcuts, '时间轴快捷键说明框探针可测到')
  await expectVisible(shortcuts, '快捷键说明框可见')
  await screenshotSettled(win, { path: path.join(shotsDir, '04-timeline-shortcuts-open.png') })
  await win.keyboard.press('Escape')
  await expectAbsent(shortcuts, { provenBy: shortcutsProbe, message: '① 快捷键说明框按 Esc 后关闭' })
  check(true, '① 顺带：时间轴「快捷键」说明框现在认 Esc（同一 useOverlayEscape 原语）')
  await screenshotSettled(win, { path: path.join(shotsDir, '05-timeline-shortcuts-escaped.png') })

  console.log('\n—— 证据 ——')
  evidence.forEach((line) => console.log(`  · ${line}`))
  console.log(`\n截图：${shotsDir}`)
} catch (error) {
  failed = true
  console.error(`\n❌ 走查失败：${error?.message ?? error}`)
  if (app?.win) {
    await app.win.screenshot({ path: path.join(shotsDir, '99-failure.png') }).catch(() => {})
  }
} finally {
  await app?.app?.close?.().catch(() => {})
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
