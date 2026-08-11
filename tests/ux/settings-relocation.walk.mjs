// R13 走查：给用户看「语言 / 外观 / 关于 归位到设置」到底长什么样（2026-08-04）。
// 零额度——不建生成节点、不碰任何模型。
//
// 用户问的是「我没看到你改的设置那些东西」——他跑的是 /Applications/Nomi.app v0.17.1（7-26 构建）。
// 这条走查跑的是**当前 main 的 dist**，把改动拍下来给他看，同时用属性断言钉死：
//   ① 顶栏右簇分了组（有真渲染的分隔线），且语言/外观图标**不再常驻顶栏**
//   ② 设置「通用」页签里有语言分段控件（zh-CN / en 两颗，当前档 aria-pressed=true）
//   ③ 设置「通用」页签里有外观切换
//   ④ 设置「关于」页签里有版本号 / 上手手册 / 重看开屏 / 检查更新
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, 'docs/design/mockups/2026-08-04-settings-after')
fs.mkdirSync(outDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-settings-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const { app, win: _win } = await launchNomiApp({
  name: 'settings-relocation',
  userDataDir: settingsDir,
  settingsDir: settingsDir,
  projectsDir: projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let win = _win
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live[live.length - 1] || win
  return win
}
const resize = async () => {
  const bw = await app.browserWindow(getWin())
  await bw.evaluate((w) => { w.setBounds({ x: 0, y: 0, width: 1440, height: 940 }); w.center() })
  await getWin().waitForTimeout(400)
}
const snap = async (name) => {
  await getWin().screenshot({ path: path.join(outDir, name) })
  console.log(`  · 截图 ${name}`)
}

const verdicts = []
const check = (name, ok, detail = '') => { verdicts.push([name, ok, detail]); console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`) }

win.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 160)}`))

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2200)
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  await resize()
  for (let i = 0; i < 5; i++) {
    const skip = getWin().locator('button:has-text("跳过")').first()
    if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(200)
  }
  await getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first().click({ timeout: 8000 }).catch(() => {})
  await getWin().waitForTimeout(3000)
  for (let i = 0; i < 5; i++) { await getWin().keyboard.press('Escape').catch(() => {}); await getWin().waitForTimeout(180) }
  await resize()

  // ========== ① 顶栏：分了组，且语言/外观不在顶栏常驻 ==========
  const bar = await getWin().evaluate(() => {
    const region = document.querySelector('[aria-label*="全局"], [aria-label*="global"]')
      || [...document.querySelectorAll('div')].find((d) => d.querySelector('button[aria-label*="设置"]'))
    if (!region) return { why: 'no-region' }
    const buttons = [...region.querySelectorAll('button')]
      .filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => b.getAttribute('aria-label') || b.textContent?.trim() || '?')
    // 真渲染出来的分隔线（w-px 竖线），条件渲染后没按钮的组，分隔线要跟着藏
    const dividers = [...region.querySelectorAll('span,div')].filter((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.width <= 2 && r.height >= 10 && cs.display !== 'none'
    }).length
    return { buttons, dividers }
  })
  console.log('  · 顶栏右簇:', JSON.stringify(bar))
  const hasLangInBar = (bar.buttons || []).some((l) => /语言|Language|中文|English/.test(l))
  const hasThemeInBar = (bar.buttons || []).some((l) => /外观|亮色|暗色|主题|Appearance|theme/i.test(l))
  check('顶栏右簇分了组（有真渲染的分隔线）', (bar.dividers || 0) >= 1, `${bar.dividers} 条分隔线`)
  check('语言不再常驻顶栏（已归位设置）', !hasLangInBar, JSON.stringify(bar.buttons))
  check('外观不再常驻顶栏（已归位设置）', !hasThemeInBar, '')
  await snap('01-appbar.png')

  // ========== ② 打开设置 → 通用 ==========
  // ⚠️ 页签点击必须**限定在弹窗的 aside 里**：满屏还有别的「通用」（创作助手的「通用助手」、
  // 输入框底部的「模式 通用 ▾」），裸 `button:has-text("通用")` 会点中弹窗背后那个，
  // 于是停在「文件与保存」页却报「没有语言控件」= 假红。断言同理，一律只读弹窗内的文字。
  const dialog = () => getWin().locator('[role="dialog"][aria-modal="true"]').first()
  await getWin().locator('button[aria-label*="设置"]').first().click({ timeout: 8000 })
  await dialog().waitFor({ state: 'visible', timeout: 8000 })
  await dialog().locator('aside button', { hasText: '通用' }).first().click({ timeout: 5000 })
  await getWin().waitForTimeout(800)
  const general = await dialog().evaluate((el) => {
    const locales = [...el.querySelectorAll('[data-settings-locale]')].map((b) => ({
      locale: b.getAttribute('data-settings-locale'),
      active: b.getAttribute('aria-pressed') === 'true',
      text: b.textContent?.trim(),
    }))
    const text = el.innerText
    return { locales, hasAppearance: /外观|Appearance/.test(text), hasLanguageLabel: /语言|Language/.test(text) }
  })
  console.log('  · 通用页签:', JSON.stringify(general))
  check('设置「通用」里有语言分段控件', general.locales.length >= 2 && general.locales.some((l) => l.active), JSON.stringify(general.locales))
  check('设置「通用」里有外观切换', general.hasAppearance, '')
  await snap('02-settings-general.png')

  // 归位≠可发现：量一下语言那一行是不是要滚动才看得到（弹窗内容区固定 420 高、可滚）。
  const fold = await dialog().evaluate((el) => {
    const pane = el.querySelector('section')
    const first = el.querySelector('[data-settings-locale]')
    if (!pane || !first) return null
    const p = pane.getBoundingClientRect()
    const f = first.getBoundingClientRect()
    return {
      belowFold: f.top > p.bottom,
      needScrollPx: Math.max(0, Math.round(f.bottom - p.bottom)),
      scrollHeight: pane.scrollHeight,
      clientHeight: pane.clientHeight,
    }
  })
  console.log('  · 语言行相对首屏:', JSON.stringify(fold))
  check('语言/外观在「通用」里（首屏或滚动可达，记录需滚多少）', Boolean(fold), `需向下滚 ${fold?.needScrollPx ?? '?'}px，内容 ${fold?.scrollHeight}/${fold?.clientHeight}`)
  await dialog().evaluate((el) => { const p = el.querySelector('section'); if (p) p.scrollTop = p.scrollHeight })
  await getWin().waitForTimeout(500)
  await snap('02b-settings-general-scrolled.png')

  // ========== ③ 关于页签 ==========
  await dialog().locator('aside button', { hasText: '关于' }).first().click({ timeout: 5000 })
  await getWin().waitForTimeout(800)
  const about = await dialog().evaluate((el) => {
    const text = el.innerText
    return {
      version: /\d+\.\d+\.\d+/.test(text),
      handbook: /手册|上手|Handbook|Guide/.test(text),
      replay: /重看|回放|开屏|Replay/.test(text),
      update: /更新|Update/.test(text),
      sample: text.slice(0, 400),
    }
  })
  console.log('  · 关于页签:', JSON.stringify({ ...about, sample: undefined }))
  check('设置「关于」里有版本号', about.version, '')
  check('设置「关于」里有上手手册', about.handbook, '')
  check('设置「关于」里有重看开屏', about.replay, '')
  check('设置「关于」里有检查更新', about.update, '')
  await snap('03-settings-about.png')

  console.log('\n=== 判据 ===')
  const failed = verdicts.filter(([, ok]) => !ok).length
  for (const [name, ok, detail] of verdicts) console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`\n截图目录：${outDir}`)
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error('走查失败:', error)
  await snap('99-failure.png').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
