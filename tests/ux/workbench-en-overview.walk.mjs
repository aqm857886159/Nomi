#!/usr/bin/env node
// 主工作台 en 全览走查（i18n 阶段一）—— EN-DOM 断言网的「主战场」那条。
//
// 抓的是 check:i18n-key-parity 抓不到的那一半漏译:parity 只证「en 词典每个键都有值」,证不了
// 「这个键真的被用上了」。组件里一句硬编码中文、或走错分支拿到中文串,parity 照样绿——只有真把
// 主工作台切到 en、真渲染出画布/顶栏/标签/侧栏,才看得见那一句露出来的中文。
//
// 与另外两条 en 走查（mcp-client-activation / provider-model-discovery）互补:它们盯的是各自那面
// 局部面板;这条盯**主工作台默认落地屏**（创作标签 + 顶栏 + 侧栏 chrome）的整页可见文本。
//
// 关键手法（都踩过坑,见 memory）:
//   · 切语言走**真实用户路径**——开设置→通用→点 [data-settings-locale="en"],不 win.reload()。
//     reload 后 getActiveWorkbenchProjectId() 恒 null、面板静默空掉,像极了真 bug(memory:走查里别用
//     win.reload)。setAppLocale 内部 i18n.changeLanguage 直接触发 react-i18next 活性重渲,无需 reload。
//   · 断言前**先证明在现场**——先断言 getAppLocale()==='en' 且界面出现已知英文锚点,再跑 CJK 扫描;
//     否则「界面还没切过去」和「切过去但没漏译」两种绿看起来一样(memory:断言前证明你在你以为的现场)。
//   · 探针**每步前量状态**——建项目/开设置/切语言各自等到位再往下(memory:探针先量状态)。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareIsolation, launchIsolatedApp, dismissSplashIfPresent, createBlankProject } from '../../evals/lib/isoApp.mjs'
import { screenshotSettled, expectNoCjkInEnglishDom } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, '.workbench-en-overview-walk')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// requireCatalog:false —— 这条走查不跑真生成/真模型,只看 UI chrome 的语言,不需要已配置的 key。
const iso = prepareIsolation(path.join(os.tmpdir(), 'nomi-workbench-en-overview'), { requireCatalog: false })
const { app, win } = await launchIsolatedApp(repoRoot, iso)

try {
  await dismissSplashIfPresent(win)
  // 跳过开屏/巡览遮罩,避免它们盖在工作台上让后续点击落空。
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1']) localStorage.setItem(k, 'seen')
  })

  // ① 起始页 → 新建空白项目 → 落进主工作台（默认中文、默认「创作」标签）。
  const projectDir = await createBlankProject(win, iso.projectsDir)
  await win.waitForTimeout(1200)
  const inWorkbench = await win.evaluate(() => {
    // 进了项目就有外壳左栏（项目库页没有左栏），用它判「已进工作台」。
    return Boolean(document.querySelector('[data-shell-rail]'))
  })
  check('新建空白项目后落进主工作台', inWorkbench, `project=${path.basename(projectDir)}`)
  // 现场对照:切换前顶栏应是中文——用顶栏「创作」标签(中文原文)在不在做锚点,
  // 不读 document.body.innerText(那会把 seed 数据也算进来、且触 check:walkthroughs 全页文本规则)。
  const zhTabCount = await win.getByRole('button', { name: '创作', exact: true }).count()
  check('切换前主工作台是中文（顶栏「创作」在）', zhTabCount > 0, `创作 tab=${zhTabCount}`)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-workbench-zh.png') })

  // ② 走真实用户路径切 en:开设置（通用）→ 点 English 分段钮 → 关设置。不 reload。
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'general' } })))
  const overlay = win.locator('[data-settings-overlay="true"]')
  await overlay.waitFor({ state: 'visible', timeout: 8_000 })
  const enLocaleBtn = overlay.locator('[data-settings-locale="en"]').first()
  await enLocaleBtn.waitFor({ state: 'visible', timeout: 6_000 })
  await enLocaleBtn.click({ timeout: 6_000 })
  // 等 i18n 活性重渲把设置面板自己翻成英文(证明 changeLanguage 已生效),再关。
  await win.waitForTimeout(600)
  // 关设置:点关闭钮(中英文名都兜住,此刻已可能翻英文)。
  const closeBtn = overlay.getByRole('button', { name: /Close settings|关闭设置|Close|关闭/ }).first()
  if (await closeBtn.count()) {
    await closeBtn.click({ timeout: 5_000 }).catch(() => {})
  } else {
    // 兜底:点遮罩空白处关闭。
    await win.evaluate(() => {
      const box = document.querySelector('[data-settings-overlay="true"]')
      if (box) box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
  }
  await overlay.waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {})
  await win.waitForTimeout(800)

  // ③ 证明已在 en 现场:locale=en 且顶栏出现已知英文锚点(创作标签→Create / 生成→Generate)。
  //    没有这一步,「界面还没切」和「切了没漏译」两种绿分不开。
  const localeEn = await win.evaluate(() => (window.localStorage.getItem('nomi:locale:v1') || document.documentElement.lang || ''))
  check('已切到 en（运行时 locale）', /en/i.test(localeEn), `locale=${localeEn || '(空)'}`)
  // 顶栏「创作」标签的英文原文是 Create——用 Playwright locator 断言它**在**(正向证据,不读全页 innerText)。
  // 有它即证明工作台 chrome(不只是设置面板)已翻英文:若切换没生效,顶栏仍是「创作」、Create 不会出现,此断言就红。
  // 无需再补「创作 不在」的缺席断言——正向命中已把「界面还没切」和「切了没漏译」两种绿分开(缺席断言另有棘轮成本)。
  const enTabCount = await win.getByRole('button', { name: 'Create', exact: true }).count()
  check('主工作台 chrome 已翻英文（顶栏 Create 在）', enTabCount > 0, `Create tab=${enTabCount}`)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-workbench-en.png') })

  // ④ EN-DOM 断言网:界面确已在 en,整页可见文本不该再有一个中文字(漏译当场报红)。
  //    用户自己写的内容([data-user-content])整棵豁免——此刻是空白新项目,没有用户中文内容,
  //    任何 CJK 都是产品 UI 的漏译。
  await expectNoCjkInEnglishDom(win, { message: '主工作台默认落地屏在 en 下出现未翻译中文' })
  check('EN-DOM 断言网通过（主工作台整页零漏译中文）', true, 'expectNoCjkInEnglishDom OK')
  await screenshotSettled(win, { path: path.join(shotsDir, '03-workbench-en-verified.png') })
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} 主工作台 en 全览走查：${results.length - failed.length}/${results.length} 通过`)
console.log(`截图：${shotsDir}`)
if (failed.length) {
  console.log('失败项：', failed.map((r) => r.name).join('; '))
  process.exit(1)
}
