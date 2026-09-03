// R13 走查（workbench token 根层收口）：**库页**上的付费确认卡必须解析得到 --workbench-* 设计值，
// 光/暗各一张截图 + 计算值断言。
//
// 病史（docs/plan/2026-08-24-workbench-token-root-scope.md）：--workbench-* 曾只定义在
// .workbench-shell 作用域；付费确认卡挂在 app 公共根（NomiStudioApp），从库页弹出时祖先链上
// 没有该类 → var() 静默失效退回继承灰（ProductionContractSummary 勾勾 text-workbench-success、
// 库页 WorkbenchButton 底色全中）。收口后 token 定义在 :root（tailwind.config.ts addBase），
// 解析与挂载点无关——本走查在**真实退灰现场**（库页 + 真卡）钉死这一点。
//
// 链路（真机，单测替不了 cascade）：真 GUI 停在库页（全程不进项目，DOM 无 .workbench-shell 可借）
// + stdio MCP 子进程（不声明 elicitation → App 弹应用内确认卡）+ mock vendor **零额度**。
// 深浅切换：浅色走真实用户偏好（localStorage `nomi-color-scheme`，boot 即浅，不受夜间自动暗干扰）；
// 暗色执行 applyNomiColorScheme 的那四行属性写入（src/theme/colorScheme.ts:54——app 的真实开关）。
// 用法：pnpm run build && node tests/ux/workbench-token-root-scope.walk.mjs
import { launchNomiApp, repoRoot, withLinuxNoSandbox } from './_launchApp.mjs'
import { startMockVendorServer, writeIsolatedCatalog, parseToolResult } from './_mcpJourney.mjs'
import { clickOrFail, expectVisible, screenshotSettled } from './_assert.mjs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import readline from 'node:readline'
import path from 'node:path'

const require = createRequire(import.meta.url)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/workbench-token-root-scope')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-tokenscope-'))
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
const capDir = path.join(base, 'capability-core')
for (const d of [settingsDir, projectsDir, capDir]) fs.mkdirSync(d, { recursive: true })

const sharedEnv = {
  NOMI_E2E: '1',
  NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
  NOMI_ELECTRON_USER_DATA_DIR: settingsDir,
  NOMI_SETTINGS_DIR: settingsDir,
  NOMI_PROJECTS_DIR: projectsDir,
  NOMI_CAPABILITY_DIR: capDir,
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
const ok = (c, l) => { if (!c) throw new Error(`FAIL: ${l}`); passed += 1; console.log(`  ✓ ${l}`) }

// 设计值（真源 tailwind.config.ts addBase；改值那边、这里跟着改——断的是「解析得到真源值」）。
const LIGHT_SUCCESS = '#34c759'
const DARK_SUCCESS = '#45d483'

const mockVendor = await startMockVendorServer()
writeIsolatedCatalog(settingsDir, mockVendor.origin)

const { app, win } = await launchNomiApp({
  name: 'workbench-token-root-scope',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  env: { NOMI_CAPABILITY_DIR: capDir },
  args: ['--disable-gpu', '--disable-software-rasterizer'],
  settleMs: 0,
})

/** stdio MCP 子进程（不声明 elicitation = Claude Code 当下形态 → App 必弹应用内卡）。 */
function spawnAgent() {
  const pending = new Map()
  let seq = 0
  const child = spawn(require('electron'), withLinuxNoSandbox([repoRoot, '--disable-gpu']), {
    cwd: repoRoot,
    env: { ...process.env, ...sharedEnv, NOMI_MCP_STDIO: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const t = line.trim(); if (!t.startsWith('{')) return
    let msg; try { msg = JSON.parse(t) } catch { return }
    if (msg.id != null && pending.has(msg.id)) { const { resolve, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); resolve(msg) }
  })
  const rpc = (method, params, timeoutMs = 30000) => {
    const id = (seq += 1)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC 超时: ${method}`)) }, timeoutMs)
      pending.set(id, { resolve, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  return {
    child,
    async callTool(name, args, timeoutMs = 90000) {
      const res = (await rpc('tools/call', { name, arguments: args }, timeoutMs)).result
      const parsed = parseToolResult(res)
      if (parsed.isError) throw new Error(`工具 ${name} 失败：${parsed.text.slice(0, 200)}`)
      return parsed
    },
    async start() {
      let init = null
      for (let i = 0; i < 20 && !init; i++) {
        try { init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code' } }, 4000) } catch { await sleep(1000) }
      }
      return init
    },
  }
}

let agent = null
let exitCode = 0
try {
  win.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 160)))
  await win.waitForLoadState('domcontentloaded')
  await sleep(1500)
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
    // 真实用户偏好路径钉浅色：走查可能在 18:00 后跑，「天黑自动暗」会把首屏变暗污染浅色断言。
    window.localStorage.setItem('nomi-color-scheme', 'light')
  })
  await win.reload(); await sleep(1500)
  await win.setViewportSize({ width: 1280, height: 820 })

  // ── 现场自证（断言前先证明在「库页 + 浅色 + 无壳」这个曾经的退灰现场）──
  await expectVisible(win.getByText('新建空白项目').first(), '库页在屏（「新建空白项目」可见）')
  ok(true, '库页在屏')
  const site = await win.evaluate(() => ({
    shellAbsent: document.querySelector('.workbench-shell') === null,
    scheme: document.documentElement.getAttribute('data-mantine-color-scheme'),
  }))
  ok(site.shellAbsent, '现场确认：库页 DOM 无 .workbench-shell 祖先可借（收口前这正是退灰现场）')
  ok(site.scheme === 'light', `现场确认：浅色模式生效（data-mantine-color-scheme=${site.scheme}）`)

  // ── 浅色 · 根层解析 ──
  const lightRoot = await win.evaluate(() => ({
    success: getComputedStyle(document.body).getPropertyValue('--workbench-success').trim(),
    previewH: getComputedStyle(document.documentElement).getPropertyValue('--workbench-preview-timeline-height').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }))
  ok(lightRoot.success === LIGHT_SUCCESS, `库页 body 解析 --workbench-success=${lightRoot.success}（设计值 ${LIGHT_SUCCESS}，不再退继承灰）`)
  ok(lightRoot.previewH === '222px', `漂移冲突按 cascade 现行赢家收口：--workbench-preview-timeline-height=${lightRoot.previewH}（208px 陈旧副本淘汰）`)

  // ── MCP 触发真卡（浮在库页上）──
  agent = spawnAgent()
  ok(Boolean((await agent.start())?.result), 'stdio MCP 起来了（不声明 elicitation → 走应用内卡）')
  const proj = await agent.callTool('nomi_project_create', { name: 'token 作用域走查' })
  const projectId = proj.json?.projectId || proj.json?.id
  ok(projectId, `建项目（${projectId}）`)
  const gen = agent.callTool('nomi_generate', {
    projectId, vendor: 'nomi-mock', modelKey: 'nomi-mock-image', intent: 'image', prompt: '库页 token 走查：巷口回头',
  })
  const spendCard = win.locator('div.fixed.inset-0').filter({ hasText: /AI 助手想生成/ })
  await expectVisible(spendCard.first(), '付费确认卡弹出（浮在库页上）', 30_000)
  ok(true, '付费确认卡弹出，浮在库页上')
  await expectVisible(win.getByText('新建空白项目').first(), '卡下面还是库页（没被导航走）')
  ok(true, '卡下面还是库页')

  // ── 浅色 · 卡上解析 + 真实上色 ──
  const cancelBtn = spendCard.locator('button').first()
  const lightCard = await spendCard.first().evaluate((el) => getComputedStyle(el).getPropertyValue('--workbench-success').trim())
  const lightBtnBg = await cancelBtn.evaluate((el) => getComputedStyle(el).backgroundColor)
  ok(lightCard === LIGHT_SUCCESS, `卡节点解析 --workbench-success=${lightCard}（勾勾/成功语义同一条 var 链）`)
  // paper 白的合法序列化随引擎版本变（oklch(1 0 0) / rgb(255,255,255) / color(srgb 1 1 1)）——断语义不断字面。
  const isPaperWhite = /^(?:oklch\(1 0 0\)|rgb\(255, 255, 255\)|color\(srgb 1 1 1\))$/.test(lightBtnBg)
  ok(lightBtnBg !== 'rgba(0, 0, 0, 0)' && isPaperWhite, `卡上 WorkbenchButton 真实上色 bg=${lightBtnBg}（bg-workbench-surface→paper 白；收口前这里是 transparent）`)
  await screenshotSettled(win, { path: path.join(shotsDir, '01-light-card-on-library.png') })

  // ── 暗色（执行 applyNomiColorScheme 的四行属性写入，src/theme/colorScheme.ts:54）──
  await win.evaluate(() => {
    const root = document.documentElement
    root.dataset.theme = 'dark'
    root.dataset.nomiColorScheme = 'dark'
    root.setAttribute('data-mantine-color-scheme', 'dark')
    root.style.colorScheme = 'dark'
  })
  await sleep(400) // --nomi-transition-fast=140ms：等 transition-colors 收敛再读色/截图（首跑抢读到 oklab(1 0 0) 中间帧）
  const darkRoot = await win.evaluate(() => ({
    bodyBg: getComputedStyle(document.body).backgroundColor,
    success: getComputedStyle(document.body).getPropertyValue('--workbench-success').trim(),
  }))
  ok(darkRoot.bodyBg !== lightRoot.bodyBg, `暗色确实生效（body 底色 ${lightRoot.bodyBg} → ${darkRoot.bodyBg}）`)
  ok(darkRoot.success === DARK_SUCCESS, `暗色下 --workbench-success=${darkRoot.success}（设计值 ${DARK_SUCCESS}，暗色覆写也在根层）`)
  const darkBtnBg = await cancelBtn.evaluate((el) => getComputedStyle(el).backgroundColor)
  // 白的任何序列化（oklch/oklab/rgb/color(srgb)）都算没换色——字符串不等 ≠ 换了色。
  const whiteish = /^(?:oklch\(1 0 0\)|oklab\(1 0 0\)|rgb\(255, 255, 255\)|color\(srgb 1 1 1\))$/
  ok(!whiteish.test(darkBtnBg) && darkBtnBg !== 'rgba(0, 0, 0, 0)', `暗色下按钮真实换到暗 paper（${darkBtnBg}）`)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-dark-card-on-library.png') })

  // ── 收尾：确认生成走完（证明这张卡是真卡、链路是活的，不是摆拍）──
  await clickOrFail(spendCard.locator('button').last(), '确认生成')
  const res = await gen
  ok(res.json?.status === 'succeeded', `确认后生成跑完（status=${res.json?.status}）`)
  ok(mockVendor.hits.length >= 1, `打的是 mock vendor（${mockVendor.hits.length} 次，零额度）`)

  console.log(`\nTOKEN-ROOT-SCOPE PASS: ${passed} 断言——库页浮层光/暗都解析到设计值，退灰病根已除。`)
  console.log('  截图 →', shotsDir)
} catch (err) {
  console.log(`✗ ${err?.message || err}`)
  exitCode = 1
} finally {
  agent?.child.kill('SIGTERM')
  await mockVendor.close().catch(() => undefined)
  await app.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
