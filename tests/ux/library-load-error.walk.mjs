#!/usr/bin/env node
// 项目库「读取失败」态走查（设计系统优化 B2）。
//
// 修复前的真实假象：`useLocalProjects` 只解构 `{ data, mutate }`，配 `fallbackData: []`，
// 于是 `desktop.projects.list()` 抛错时 `projects` 仍是 `[]`，页面落进
// `library.firstEmpty`——用户看到的是**崭新的首启空库引导屏**，读作「我的项目全没了」。
//
// 这条走查证三件事：
//   ① 空态探针是活的（读得到的时候确实显示「还没有项目」）——排除「断言恒真」；
//   ② 同一个零项目现场，让 list() 抛，界面换成**错误态 + 重新读取**，且空态文案消失；
//   ③ 修好数据源后点「重新读取」，错误态消失、库恢复正常——证明重试按钮真接线了。
//
// 注意：不用 win.reload()（会让 getActiveWorkbenchProjectId() 恒 null，面板静默空掉，
// 像极了真 bug）。故障注入走渲染层替换 window.nomiDesktop 的 projects.list，
// 再用 window focus 事件触发 SWR 的 revalidateOnFocus 重读。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareIsolation, launchIsolatedApp, dismissSplashIfPresent } from '../../evals/lib/isoApp.mjs'
import { screenshotSettled, expectVisible, expectHidden, proveProbe, expectAbsent, clickOrFail } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, '.library-load-error-walk')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const iso = prepareIsolation(path.join(os.tmpdir(), 'nomi-library-load-error'), { requireCatalog: false })
const { app, win } = await launchIsolatedApp(repoRoot, iso)

try {
  await dismissSplashIfPresent(win)
  await win.waitForTimeout(800)

  const emptyState = win.getByText('还没有项目', { exact: false })
  const errorState = win.locator('[data-testid="library-load-error"]')
  const retryButton = win.locator('[data-testid="library-load-retry"]')

  // ── ① 空态探针活着：读得到（零项目）时确实是「还没有项目」引导屏 ──
  const emptyProof = await proveProbe(emptyState, '首启空库引导屏「还没有项目」')
  await expectHidden(errorState, '还没出故障，不该有错误态')
  check('空态探针可证（零项目 → 首启引导屏）', true, '「还没有项目」可见')
  await screenshotSettled(win, { path: path.join(shotsDir, '01-empty-before-fault.png') })

  // ── ② 注入故障：让 nomi:projects:list 这条同步 IPC 返回失败 ──
  // 注入点选在主进程 IPC 而不是渲染层改 window.nomiDesktop：contextBridge 暴露的属性
  // 不可重定义（Cannot redefine property），且从 IPC 失败起走的是**生产那条报错路径**
  // （preload 的 invokeSync 见到 ok!==true 就 throw），比手塞一个 throw 更接近真实故障。
  const injected = await app.evaluate(({ ipcMain }) => {
    const channel = 'nomi:projects:list'
    globalThis.__nomiListOriginals = ipcMain.listeners(channel)
    ipcMain.removeAllListeners(channel)
    globalThis.__nomiListFault = true
    ipcMain.on(channel, (event, ...args) => {
      if (globalThis.__nomiListFault) {
        event.returnValue = { ok: false, error: 'EIO: 项目索引读取失败（走查注入）' }
        return
      }
      for (const handler of globalThis.__nomiListOriginals) handler(event, ...args)
    })
    return globalThis.__nomiListOriginals.length
  })
  // SWR revalidateOnFocus → 重跑 fetcher → 这次抛。
  // focus 事件有 5s 节流（SWR focusThrottleInterval 默认 5000），冷启动那一发可能已经用掉，
  // 所以这里轮询式补发，直到错误态出现（或超时由下面的断言报红）。
  let faultObserved = false
  for (let attempt = 0; attempt < 12 && !faultObserved; attempt += 1) {
    await win.evaluate(() => { window.dispatchEvent(new Event('focus')) })
    await win.waitForTimeout(1000)
    faultObserved = (await win.locator('[data-testid="library-load-error"]').count()) > 0
  }
  check('故障注入成功（list() 这条 IPC 现在返回失败）', injected === 1, `原 handler 数=${injected}`)
  await win.waitForTimeout(600)

  await expectVisible(errorState, '读取失败后应出现错误态')
  await expectVisible(retryButton, '错误态必须给「重新读取」出路')
  await expectVisible(win.getByText('读不到本地项目', { exact: false }), '错误态标题说人话')
  // 关键：空态不能再冒名顶替
  await expectAbsent(emptyState, { provenBy: emptyProof, message: '读取失败时不该再显示首启空库引导屏' })
  check('读取失败 → 错误态 + 重试按钮，空库引导屏消失', true, 'error 优先于 empty')
  await screenshotSettled(win, { path: path.join(shotsDir, '02-load-error.png') })

  // ── ③ 修好数据源 → 点「重新读取」→ 错误态消失、库恢复 ──
  await app.evaluate(() => { globalThis.__nomiListFault = false })
  await clickOrFail(retryButton, '重新读取')
  await win.waitForTimeout(600)
  await expectHidden(errorState, '重试成功后错误态必须消失')
  await expectVisible(emptyState, '数据源恢复后回到正常的空库引导屏')
  check('点「重新读取」→ 错误态清除、库恢复', true, 'refreshProjects 走 SWR revalidate')
  await screenshotSettled(win, { path: path.join(shotsDir, '03-recovered.png') })
} finally {
  await app.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '❌' : '✅'} 项目库读取失败态走查：${results.length - failed.length}/${results.length} 通过`)
console.log(`截图：${shotsDir}`)
if (failed.length) {
  console.log('失败项：', failed.map((r) => r.name).join('; '))
  process.exit(1)
}
