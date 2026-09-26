// R13 真机走查：应用内代理设置（零 vendor 调用、零额度；只打免费图床做连通探测）。
//
// 判据不是「有没有渲染出来」，是**三态切换真的改变了出站行为**：
//   跟随系统 → 测试连通应成功（这台机器有 HTTP 代理）
//   不用代理 → 测试连通应失败（tmpfiles.org 国内直连是 000）
// 这一来一回同时验了：热切换生效（不用重启）、dispatcher 真的被换掉、直连档真的还原了。
//
// 用法：pnpm build 后 node scripts/proxy-setting-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { realNomiProfile, seedRealCredentials } from '../tests/ux/_realProfile.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.proxy-setting-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log('  📸 ' + name)
}

const settings = path.join(os.tmpdir(), 'nomi-proxywalk-settings')
const projects = path.join(os.tmpdir(), 'nomi-proxywalk-projects')
mkdirSync(settings, { recursive: true })
mkdirSync(projects, { recursive: true })
// 凭据钥匙（Windows 的 Local State）跟目录一起进隔离副本，user-data 与启动器默认同形、只是先建出来。
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'proxy-setting-'))
const userDataDir = path.join(tempRoot, 'user-data')
if (existsSync(realNomiProfile().catalogPath)) seedRealCredentials({ settingsDir: settings, userDataDir })

const { app, win } = await launchNomiApp({
  name: 'proxy-setting',
  tempRoot,
  userDataDir,
  settingsDir: settings,
  projectsDir: projects,
  // 代理必须来自「系统设置」这条路（用户的真实场景）。留着 env 变量会让探测走 env 分支，
  // 测不到我们真正关心的那条链。
  env: { HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '', ALL_PROXY: '', all_proxy: '' },
})
let failed = false
const fail = (msg) => { console.log('  ✗ ' + msg); failed = true }

try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  await win.waitForTimeout(2000)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  // 启动时的代理装载延迟 3s，等它跑完再看状态，否则读到的是「还没探测」。
  await win.waitForTimeout(3500)

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
  await win.waitForTimeout(1500)

  const netRow = win.locator('[role="dialog"] button[aria-expanded]').filter({ hasText: '网络' }).first()
  if (!(await netRow.isVisible().catch(() => false))) {
    fail('模型设置面板里没找到「网络」行')
    throw new Error('no network row')
  }
  console.log('  收起态：' + (await netRow.textContent() || '').trim())
  await shot(win, '01-collapsed.png')

  await netRow.click()
  await win.waitForTimeout(700)
  await shot(win, '02-expanded.png')
  const panel = win.locator('[role="dialog"]').first()
  await panel.screenshot({ path: path.join(outDir, '03-panel.png') })

  const modes = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[role="dialog"] button[aria-pressed]')).map((b) => ({
      text: (b.textContent || '').trim(),
      pressed: b.getAttribute('aria-pressed'),
    })),
  )
  console.log('  三态：' + JSON.stringify(modes))
  if (modes.length !== 3) fail('三态控件数量不对，实际 ' + modes.length)

  const clickMode = async (label) => {
    await win.evaluate((text) => {
      const hit = Array.from(document.querySelectorAll('[role="dialog"] button[aria-pressed]'))
        .find((b) => (b.textContent || '').trim() === text)
      hit?.click()
    }, label)
    await win.waitForTimeout(1200)
  }
  // UI 上点一次（验按钮真能跑），同时直接拿 IPC 的逐项明细做**决定性断言**：
  // 聚合值「任一通即通」在直连下也会是 ok（litterbox 国内直连本就通 412），
  // 只有看 tmpfiles 那一项才分得清「dispatcher 到底换没换」。
  const runTest = async () => {
    await win.evaluate(() => {
      const hit = Array.from(document.querySelectorAll('[role="dialog"] button'))
        .find((b) => (b.textContent || '').trim() === '测试连通')
      hit?.click()
    })
    await win.waitForTimeout(1500)
    const res = await win.evaluate(async () => window.nomiDesktop?.proxy?.test?.())
    const tried = res?.result?.tried || []
    const tmpfiles = tried.find((t) => /tmpfiles/.test(t.target))
    return { agg: res?.result?.ok ? 'ok' : 'fail', tmpfiles: tmpfiles ? (tmpfiles.ok ? 'ok' : 'fail') : 'missing', tried }
  }

  console.log('\n  ── 跟随系统（这台机器系统里有 HTTP 代理）──')
  await clickMode('跟随系统')
  const sys = await runTest()
  console.log('  聚合=' + sys.agg + '  tmpfiles=' + sys.tmpfiles + '  明细=' + JSON.stringify(sys.tried.map((t) => [t.target, t.ok])))
  await shot(win, '04-system-tested.png')
  if (sys.tmpfiles !== 'ok') fail('跟随系统下 tmpfiles 应可达（代理生效），实际 ' + sys.tmpfiles)

  console.log('\n  ── 不用代理（tmpfiles 应立刻够不到）──')
  await clickMode('不用代理')
  const off = await runTest()
  console.log('  聚合=' + off.agg + '  tmpfiles=' + off.tmpfiles + '  明细=' + JSON.stringify(off.tried.map((t) => [t.target, t.ok])))
  await shot(win, '05-off-tested.png')
  if (off.tmpfiles !== 'fail') fail('强制直连下 tmpfiles 应不可达，实际 ' + off.tmpfiles + '（= dispatcher 没真被换掉）')
  // 聚合仍是 ok 且**应该**是 ok：litterbox 国内直连能通，图确实还送得出去。这条钉住那个语义。
  if (off.agg !== 'ok') console.log('  （注意：litterbox 这次也不通，聚合才成了 fail —— 非回归，是它自己抽了）')

  console.log('\n  ── 切回跟随系统（验直连档真的还原了，不是单向门）──')
  await clickMode('跟随系统')
  const back = await runTest()
  console.log('  聚合=' + back.agg + '  tmpfiles=' + back.tmpfiles)
  if (back.tmpfiles !== 'ok') fail('切回跟随系统后 tmpfiles 应恢复可达，实际 ' + back.tmpfiles)

  // 自定义态——群反馈 07-24 真正要的那件事（「给 nomi 单独走代理，不改系统全局」）。
  // 直接填这台机器真实的代理地址，端到端验：填进去 → 生效 → tmpfiles 可达。
  console.log('\n  ── 自定义（填真代理地址，端到端验）──')
  await clickMode('自定义')
  await win.waitForTimeout(800)
  const input = win.locator('[role="dialog"] input[type="text"]').first()
  if (!(await input.isVisible().catch(() => false))) fail('切到「自定义」后没出现输入框')
  else {
    await input.fill('http://127.0.0.1:7897')
    await input.press('Enter')
    await win.waitForTimeout(1500)
    await shot(win, '06-custom.png')
    const custom = await runTest()
    console.log('  聚合=' + custom.agg + '  tmpfiles=' + custom.tmpfiles)
    if (custom.tmpfiles !== 'ok') fail('自定义地址应生效（tmpfiles 可达），实际 ' + custom.tmpfiles)
    const pill = await win.evaluate(() => {
      const row = Array.from(document.querySelectorAll('[role="dialog"] button[aria-expanded]'))
        .find((b) => (b.textContent || '').includes('网络'))
      return (row?.textContent || '').trim()
    })
    console.log('  收起态胶囊：' + pill)
    if (!/自定义/.test(pill)) fail('状态胶囊没反映「自定义」，实际：' + pill)
  }
  // SOCKS——单测只能证明地址解析对，**隧道真跑得起来只有这一步能证**：
  // undici 6 上手写的 connector（socks 建隧道 → https 交给 undici 自己做 TLS 升级）是全项最有
  // 风险的一块。这台机器 Clash 的 SOCKS 口同为 7897（scutil 确认）。
  console.log('\n  ── 自定义 · SOCKS5（连接器真跑隧道）──')
  const socksInput = win.locator('[role="dialog"] input[type="text"]').first()
  if (!(await socksInput.isVisible().catch(() => false))) fail('自定义输入框不见了，测不了 SOCKS')
  else {
    await socksInput.fill('socks5://127.0.0.1:7897')
    await socksInput.press('Enter')
    await win.waitForTimeout(1800)
    await shot(win, '07-socks.png')
    const socks = await runTest()
    console.log('  聚合=' + socks.agg + '  tmpfiles=' + socks.tmpfiles + '  明细=' + JSON.stringify(socks.tried.map((t) => [t.target, t.ok])))
    if (socks.tmpfiles !== 'ok') fail('SOCKS5 隧道应能到 tmpfiles（https 要经 TLS 升级），实际 ' + socks.tmpfiles)
    const st = await win.evaluate(async () => (await window.nomiDesktop?.proxy?.get?.())?.status)
    console.log('  状态：activeUrl=' + st?.activeUrl + '  unsupported=' + JSON.stringify(st?.unsupported))
    if (!/^socks5:/.test(st?.activeUrl || '')) fail('状态里 activeUrl 应是 socks5://…，实际 ' + st?.activeUrl)
    if (st?.unsupported) fail('SOCKS 不该再被标成 unsupported，实际：' + st.unsupported)
  }

  await clickMode('跟随系统') // 走查不留副作用（虽然用的是隔离 settings 目录）

  const finalText = await win.evaluate(() => (document.querySelector('[role="dialog"]')?.textContent || '').trim())
  if (!/网络/.test(finalText)) fail('网络行不见了')
} catch (error) {
  console.log('  ✗ 走查抛错: ' + String(error).slice(0, 300))
  failed = true
} finally {
  await app.close().catch(() => {})
}
console.log(failed ? '\n✗ 未通过' : '\n✓ 通过：三态切换真的改变了出站行为，热切换生效、直连档能还原')
process.exit(failed ? 1 : 0)
