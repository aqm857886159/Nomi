// R16 走查（Phase B·方案门 surfacing）：外部 MCP agent 往画布**批量落节点**时，运行中的 Nomi
// 弹出应用内「方案门」确认卡（复用付费卡漏斗，kind=plan、分镜图标），真人点了才落——不再静默写画布。
// 起真 GUI app（写 instance 广告）+ 另起 stdio MCP 子进程（同 NOMI_CAPABILITY_DIR → 探到运行中的
// GUI，经 RPC 转发）：stdio 发 nomi_canvas_edit(action=add_nodes, 3 节点) → 主进程经 hybrid 网关 requestRenderer('plan.confirm')
// → GUI 弹方案卡 → 截图人眼看 → 点「落到画布」→ stdio 拿到 ids。全程**不花额度**（只建节点，不生成）。
// 用法：pnpm run build && node tests/ux/plan-gate.walk.mjs
import { launchNomiApp, repoRoot, withLinuxNoSandbox } from './_launchApp.mjs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import readline from 'node:readline'
import path from 'node:path'
import { screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/plan-gate')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-plangate-'))
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
const capDir = path.join(base, 'capability-core')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })
const realCat = path.join(os.homedir(), 'Library/Application Support/Nomi/model-catalog.json')
if (fs.existsSync(realCat)) fs.copyFileSync(realCat, path.join(settingsDir, 'model-catalog.json'))

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

// ── 起 GUI app（真窗口，写 instance 广告供 stdio 探测）───────────────────
const { app } = await launchNomiApp({
  name: 'plan-gate',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  env: { NOMI_CAPABILITY_DIR: capDir },
  args: ['--disable-gpu', '--disable-software-rasterizer'],
  settleMs: 0,
})

// ── stdio MCP 子进程（外部 agent 真路径；同 capDir → 转发到运行中的 GUI）─────
let child = null
const pending = new Map()
let seq = 0
function rpc(method, params, timeoutMs = 30000) {
  const id = (seq += 1)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC 超时: ${method}`)) }, timeoutMs)
    pending.set(id, { resolve, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
async function callTool(name, args, timeoutMs = 30000) {
  const res = (await rpc('tools/call', { name, arguments: args }, timeoutMs)).result
  const text = res?.content?.[0]?.text || ''
  if (res?.isError) throw new Error(`工具 ${name} 失败：${text}`)
  try { return JSON.parse(text) } catch { return text }
}

let exitCode = 0
try {
  const win = app.windows().filter((w) => !w.isClosed()).slice(-1)[0]
  win.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 160)))
  await win.waitForLoadState('domcontentloaded')
  await sleep(1500)
  await win.evaluate(() => { for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen') })
  await win.reload(); await sleep(1500)
  for (let i = 0; i < 5; i++) { const s = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first(); if (await s.count()) await s.click({ timeout: 1000 }).catch(() => {}); await win.keyboard.press('Escape').catch(() => {}); await sleep(300) }
  await screenshotSettled(win, { path: path.join(shotsDir, '01-app-ready.png') })

  child = spawn(require('electron'), withLinuxNoSandbox([repoRoot, '--disable-gpu']), { cwd: repoRoot, env: { ...process.env, ...sharedEnv, NOMI_MCP_STDIO: '1' }, stdio: ['pipe', 'pipe', 'inherit'] })
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    const t = line.trim(); if (!t.startsWith('{')) return
    let msg; try { msg = JSON.parse(t) } catch { return }
    if (msg.id != null && pending.has(msg.id)) { const { resolve, timer } = pending.get(msg.id); clearTimeout(timer); pending.delete(msg.id); resolve(msg) }
  })

  // 起服务（等它探到运行中的 GUI）。
  let init = null
  for (let i = 0; i < 20 && !init; i++) {
    try { init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {} }, 4000) } catch { await sleep(1000) }
  }
  ok(init?.result, 'stdio MCP 服务起来了（探到运行中的 GUI）')

  const proj = await callTool('nomi_project_create', { name: '方案门走查' })
  const projectId = proj.projectId || proj.id
  ok(projectId, `建项目（${projectId}）`)

  // 发批量 add_nodes（3 节点 = 一套方案）——**不 await**：它会阻塞在 GUI 的方案门卡上。
  console.log('  · 外部 agent 发 nomi_canvas_edit(add_nodes, 3 节点)，应在 GUI 弹方案门…')
  const addPromise = callTool('nomi_canvas_edit', {
    projectId,
    action: 'add_nodes',
    nodes: [
      { kind: 'shot', title: 'S1 空店', prompt: '深夜面馆空荡的店面' },
      { kind: 'shot', title: 'S2 擦桌', prompt: '老陈擦拭木桌' },
      { kind: 'shot', title: 'S3 门帘', prompt: '门帘一挑，女儿进门' },
    ],
  }, 60000)

  // GUI 应弹方案卡（kind=plan：分镜图标 + 「AI 助手想在画布落一套方案」+「落到画布」）。
  const planCard = win.locator('div.fixed.inset-0').filter({ hasText: /在画布落一套方案|落到画布/ }).first()
  let cardShown = false
  for (let i = 0; i < 30; i++) { if (await planCard.count()) { cardShown = true; break } await sleep(1000) }
  await screenshotSettled(win, { path: path.join(shotsDir, '02-plan-gate-card.png') })
  ok(cardShown, '外部 agent 批量落节点 → GUI 弹出应用内「方案门」卡（不再静默写画布）')
  const cardText = await win.evaluate(() => document.body.innerText.match(/AI 助手想在画布落一套方案[\s\S]{0,120}/)?.[0] || '').catch(() => '')
  console.log('  · 方案卡文案：', cardText.replace(/\n+/g, ' ').slice(0, 120))

  // 点「落到画布」确认 → stdio 的 add_nodes 解阻塞、拿到 3 个 id。
  const confirmBtn = planCard.locator('button').last()
  await confirmBtn.click({ timeout: 3000 }).catch(() => {})
  const added = await addPromise
  const ids = added.nodeIds || added.ids || []
  ok(Array.isArray(ids) && ids.length === 3, `确认后 3 节点真落画布（ids=${ids.length}）`)
  ok(!added.cancelled, '确认路径 cancelled 未置位')
  await sleep(1500)
  await screenshotSettled(win, { path: path.join(shotsDir, '03-after-confirm.png') })

  console.log(`\nPLAN-GATE PASS: ${passed} 断言——外部 agent 批量落节点经应用内方案门确认闭环。`)
  console.log('  截图 →', shotsDir)
} catch (err) {
  console.log(`✗ ${err?.message || err}`)
  exitCode = 1
} finally {
  if (child) child.kill('SIGTERM')
  await app.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
