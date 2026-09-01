// 真机走查（R13）：**英文界面下的浏览器素材子系统**。
//
// 盯的是 2026-09-02 修掉的那批：25 条词条 zh+en 译文都在、却零引用——代码把中文写死在
// useBrowserDialogActions / BrowserAssetOverlayApp / browserAssetPopoverUtils 等处，
// 于是英文界面下浏览器素材与对话框整片显示中文。同一批文案当时还存了两份
// （browserAssets.* 与 runtime.browser.*），已定 browserAssets.* 为唯一 owner。
//
// **这条走查覆盖什么、不覆盖什么（别把它当全覆盖）**：
//   覆盖 = 常规可达面：浏览器对话框外壳（标签页/工具栏/书签）、素材站点面板、素材盒入口。
//          逐面断言「无残留中文 + 无未解析的原始 key」，并截图人眼看。
//   不覆盖 = 错误/边缘路径（抓取失败、来源会话失效、截图不支持、模型没返回提示词…）。
//          那些要真网络 + 真失败才触发，塞进走查只会得到又慢又飘的假绿。
//          它们由 src/ui/browser/browserAssetI18n.test.ts 在数据层钉住：
//          24 个键逐个解析得出译文、英文侧无汉字（阳性对照验过会红）。
//
// 零额度：只开内置浏览器外壳，不加载外部页面、不碰生成 API。隔离 userData + 项目目录。
// 用法：pnpm run build && node tests/ux/browser-asset-i18n.walk.mjs
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import {
  clickOrFail,
  expectNoCjkInEnglishDom,
  expectNoRawI18nKeysInDom,
  expectVisible,
  screenshotSettled,
} from './_assert.mjs'

const outDir = path.join(repoRoot, 'tests/ux/shots/browser-asset-i18n')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-browser-i18n-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

// 项目名给 ASCII：它是**用户内容**，英文界面显示中文本来就对，但现存 UI 没给它打
// [data-user-content]，会被 CJK 网误报。
const { app, win } = await launchNomiApp({
  name: 'browser-asset-i18n',
  userDataDir: path.join(tmp, 'udata'),
  projectsDir,
  args: ['--lang=en-US'],
  env: { NOMI_E2E_SMOKE: '1', NOMI_TEST_SYSTEM_LOCALE: '1' },
  settleMs: 1800,
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 逐面两张网：英文界面不该有中文，也不该把原始 key 直接渲染出来。 */
async function assertSurfaceClean(surface) {
  try {
    await expectNoCjkInEnglishDom(win, { message: `[en] ${surface}：英文界面不该有未翻译中文` })
    check(`${surface} · 无残留中文`, true)
  } catch (error) {
    check(`${surface} · 无残留中文`, false, String(error).split('\n').slice(0, 4).join(' / '))
  }
  try {
    await expectNoRawI18nKeysInDom(win, { message: `[en] ${surface}：界面上不该有未解析的 i18n 键` })
    check(`${surface} · 无原始 key`, true)
  } catch (error) {
    check(`${surface} · 无原始 key`, false, String(error).split('\n').slice(0, 4).join(' / '))
  }
}

try {
  const errors = []
  win.on('pageerror', (e) => errors.push(String(e)))

  await win.keyboard.press('Escape').catch(() => {})
  const card = win.locator('[data-project-card]').first()
  if (await card.count()) await clickOrFail(card, '项目卡')
  else await clickOrFail(win.getByText('New blank project', { exact: false }).first(), '新建空白项目')

  // 等真实信号，不拿长 sleep 当「打开完了」。
  const browserTab = win.getByRole('button', { name: 'Browser', exact: false }).first()
  await expectVisible(browserTab, '项目打开后应出现「Browser」入口', 30_000)
  await win.keyboard.press('Escape').catch(() => {})
  await clickOrFail(browserTab, 'Browser 入口')

  // 浏览器外壳起来的真实信号：工具栏上的「Asset box」按钮出现。
  const assetBox = win.getByRole('button', { name: 'Asset box', exact: false }).first()
  await expectVisible(assetBox, '浏览器对话框应出现「Asset box」按钮', 30_000)
  check('英文界面能打开内置浏览器', true)
  await assertSurfaceClean('浏览器对话框外壳')
  await screenshotSettled(win, { path: path.join(outDir, 'browser-shell-en.png') })

  // 素材站点面板（常规可达的第二面）
  const assetSites = win.getByRole('button', { name: 'Asset websites', exact: false }).first()
  if (await assetSites.count()) {
    await clickOrFail(assetSites, 'Asset websites')
    await expectVisible(win.getByText('Pinterest', { exact: false }).first(), '素材站点面板应列出站点', 20_000)
    await assertSurfaceClean('素材站点面板')
    await screenshotSettled(win, { path: path.join(outDir, 'asset-sites-en.png') })
  }

  // 素材盒入口
  await clickOrFail(assetBox, 'Asset box')
  await expectVisible(assetBox, '素材盒入口点击后浏览器外壳仍在', 15_000)
  await assertSurfaceClean('素材盒入口')
  await screenshotSettled(win, { path: path.join(outDir, 'asset-box-en.png') })

  if (errors.length > 0) throw new Error(`页面级 JS 错误：${errors.slice(0, 2).join(' / ')}`)
  check('无页面级 JS 错误', true)
} catch (error) {
  check('走查跑完', false, String(error).split('\n')[0])
  await screenshotSettled(win, { path: path.join(outDir, 'FAIL.png') }).catch(() => {})
} finally {
  console.log('\n═══ 结果 ═══')
  const failed = results.filter((r) => !r.ok)
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`)
  await app.close().catch(() => {})
  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length} 项未通过`)
    process.exit(1)
  }
  console.log('\n全部通过')
}
