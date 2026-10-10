// R13 走查：per-connection provider proxy 字段（#258 拆项①）。
// 用法: node tests/ux/provider-proxy-field.walk.mjs
// 产出: tests/ux/shots/provider-proxy/*.png —— 人眼判断代理字段在「自定义 API」表单的高级折叠区里、
// 输入非法值给红、输入合法值消红。不调用任何模型、不花额度。
//
// 验收点（评估文档 + 用户点名）：ProviderProxyField 是可见 UI，按 §1.5 是低频高级字段，
// 归到 Advanced 折叠区（参考 OnboardingWizardAdvancedFields 先例），不抢 L1 常驻位。
// 断言（不是空点）：① 折叠区默认收起时代理字段不常驻；② 展开后代理字段出现；
// ③ 非法值出错误提示；④ 合法值提示消失；⑤ 代理提示与自定义请求头标题如实说明「加密保存」
//   （凭据加密落盘改动的上屏证明）；⑥ 相邻截图必须有可见变化。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled, proveProbe, expectVisible, expectHidden, clickOrFail } from './_assert.mjs'
import { modelSettingsEntry } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/provider-proxy')
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-provider-proxy-userdata')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

let n = 0
const shots = []
const failures = []
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  const file = path.join(shotsDir, `${tag}.png`)
  await screenshotSettled(win, { path: file })
  const bytes = fs.readFileSync(file)
  const prev = shots[shots.length - 1]
  const same = prev && prev.bytes.equals(bytes)
  if (same) failures.push(`${tag} 与上一张 ${prev.tag} 完全相同——这一步没产生任何可见变化`)
  shots.push({ tag, bytes })
  console.log(`  · shot ${tag}${same ? ' ❌ 与上一张相同' : ''}`)
}

const { app, win } = await launchNomiApp({ name: 'provider-proxy-field', userDataDir: userData })

try {
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(k, 'seen')
    }
  })
  await win.reload()
  await win.waitForTimeout(1200)
  for (let i = 0; i < 6; i++) {
    const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(300)
  }

  // 打开模型设置首页。
  const openSettings = modelSettingsEntry(win)
  if (!(await openSettings.count())) { failures.push('找不到模型设置入口'); throw new Error('no settings entry') }
  await openSettings.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(800)
  if (!(await win.locator('[data-model-settings-page]').count())) { failures.push('模型设置面板没打开'); throw new Error('panel closed') }

  // 下钻「自定义 API / 接入你的中转站」——只有 custom 预设才显示 Advanced（含代理字段）。
  console.log('— 进入自定义 API 表单 —')
  const customApi = win.locator('[data-model-home-action="custom-api"]').first()
  if (!(await customApi.count())) { failures.push('首页没有「自定义 API」入口'); throw new Error('no custom-api row') }
  await customApi.click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(700)
  const page = await win.evaluate(() => document.querySelector('[data-model-settings-page]')?.getAttribute('data-model-settings-page') || '')
  console.log(`  · 当前页 = ${page}`)
  await snap(win, 'custom-api-form')

  // 文案对照 src/i18n/locales/modelSetup.ts（默认 zh-CN，window 未暴露 t）。
  const advancedLabel = '高级设置'
  const proxyPlaceholder = '如：http://127.0.0.1:7897 或 socks5://127.0.0.1:7897'
  const invalidText = '需以 http://、https:// 或 socks:// 开头'
  // 认代理输入框而非 label 文本：placeholder 唯一，locator 稳；toBeHidden/toBeVisible 自动重试，
  // 且正确把「Mantine Collapse 收起(高度0裁剪)」判成 hidden、展开判成 visible。
  const proxyInput = win.locator(`input[placeholder="${proxyPlaceholder}"]`)
  const advanced = win.locator('button, [role="button"], a', { hasText: new RegExp(advancedLabel) }).first()

  // ① §1.5：高级区默认收起 → 代理字段此刻应隐藏（不抢 L1 常驻位）。
  //   先在展开态用 proveProbe 证明「这个 placeholder locator 真能测到代理框」（硬断言，找不到就抛，
  //   即正对照）；再回到收起态判定它不可见。
  //   为什么不用 Playwright toBeHidden：Mantine Collapse 收起时把子元素**留在 DOM 里**、只把包裹层
  //   高度压到 0 并 overflow:hidden，Playwright 的可见性模型对这种「被祖先裁剪」的 input 仍判 visible
  //   （实测），会假红。改用 Chromium 原生 Element.checkVisibility()（考虑祖先 content-visibility/裁剪），
  //   它与截图 ground truth 一致。proveProbe 已证 locator 恒可解析，故这里判 false 只可能是「真隐藏」。
  console.log('— §1.5：收起态代理字段应隐藏（先取探针证明）—')
  await clickOrFail(advanced, '高级设置折叠入口')
  await win.waitForTimeout(500)
  await proveProbe(proxyInput, '展开高级设置后代理输入框可见')
  await expectVisible(proxyInput, '展开高级设置后代理字段应出现')
  await snap(win, 'advanced-expanded-proxy-visible')
  // 收起高级区，回到默认态：代理框留在 DOM 但被折叠裁剪 → 用户看不见。
  await clickOrFail(advanced, '高级设置折叠入口（收起）')
  await win.waitForTimeout(500)
  const collapsedProxyVisible = await win.evaluate((ph) => {
    const el = document.querySelector(`input[placeholder="${ph}"]`)
    if (!el) return false
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    const r = el.getBoundingClientRect()
    return r.width > 0.5 && r.height > 0.5
  }, proxyPlaceholder)
  if (collapsedProxyVisible) failures.push('高级区收起时代理字段仍可见——应归折叠区，别抢 L1 位')
  console.log(`  · 收起态代理字段可见 = ${collapsedProxyVisible}（期望 false）`)
  await snap(win, 'advanced-collapsed-proxy-hidden')

  // ② 非法值 → 出错误提示（invalidProxyUrl）。重新展开后操作。
  console.log('— 输入非法代理地址，应出错误提示 —')
  await clickOrFail(advanced, '高级设置折叠入口（再展开）')
  await expectVisible(proxyInput, '再展开后代理字段应可见')
  await proxyInput.fill('not-a-proxy-scheme://oops')
  await expectVisible(win.getByText(invalidText, { exact: true }), '非法代理地址应触发错误提示')
  await snap(win, 'invalid-proxy-shows-error')

  // ③ 合法值 → 错误提示消失。
  console.log('— 改成合法代理地址，错误提示应消失 —')
  await proxyInput.fill('')
  await proxyInput.fill('http://127.0.0.1:7897')
  await expectHidden(win.getByText(invalidText, { exact: true }), '合法代理地址后错误提示应消失')
  await snap(win, 'valid-proxy-error-cleared')

  // ④ 凭据加密文案上屏（本次改动）：代理提示与自定义请求头标题都要如实说明「加密保存」，
  //    与 API Key 的「加密保存」承诺对齐——因为 proxyUrl 的 user:pass 与 extraHeaders 的 Authorization
  //    现已升到同一 safeStorage 加密落盘层。断言真实文案在屏，不是空点。
  console.log('— 代理提示应含「加密保存」文案 —')
  await expectVisible(
    win.getByText('只影响这个 API，不会改变其他厂商；支持 HTTP / HTTPS / SOCKS。只存在你的电脑上，加密保存', { exact: true }),
    '代理字段提示应说明加密保存',
  )
  // 加一行自定义请求头 → 标题「自定义请求头（…加密保存）」应出现。
  console.log('— 加一行自定义请求头，标题应含「加密保存」文案 —')
  const addHeader = win.locator('button, [role="button"], a', { hasText: /添加请求头/ }).first()
  await clickOrFail(addHeader, '添加请求头按钮')
  await win.waitForTimeout(400)
  await expectVisible(
    win.getByText('自定义请求头（只存在你的电脑上，加密保存）', { exact: true }),
    '自定义请求头标题应说明加密保存',
  )
  await snap(win, 'credential-config-encrypted-copy')

  console.log(`\nDone. ${n} shots → ${path.relative(repoRoot, shotsDir)}`)
  if (failures.length) {
    console.log('\n=== 失败 ===')
    for (const f of failures) console.log(`  ❌ ${f}`)
  }
  await app.close()
  process.exit(failures.length ? 1 : 0)
} catch (error) {
  console.error(`PROVIDER PROXY WALK FAIL: ${error?.stack || error}`)
  if (failures.length) for (const f of failures) console.log(`  ❌ ${f}`)
  await app.close().catch(() => undefined)
  process.exit(1)
}
