// R16 走查（付费确认路由）：**Nomi 开着**时，外部 MCP agent 触发付费生成，确认要弹在**调用方**
// （Claude/Codex 的 elicitation），而不是把人赶回 Nomi 点应用内卡片。
//
// 为什么必须真机走查、单测不够：双问 bug 不在协议层，而在**传输层**——协议层弹完 elicitation 后，
// spendConfirmed 若不跟着跨 loopback RPC 进 GUI 主进程，渲染层会照旧再弹一次卡（用户点两次，比修之前更糟）。
// 只有「真 GUI + 真 stdio 子进程 + 真 RPC」这一条链跑通，才证明得了它。
//
// 两条腿（缺一不可，A 是 B 的基线）：
//  · A 客户端**不声明** elicitation（= Claude Code 当下的真实能力）→ App 必须照旧弹应用内确认卡。
//    这条既是回归保护（别把还在用卡的客户端修坏），也给 B 的「卡没出现」提供 proveProbe 基线——
//    否则「没看到卡」和「选择器写错了」在观测上完全一样（见 _assert.mjs 的血泪注释）。
//  · B 客户端**声明** elicitation（Codex/Cursor）→ 确认弹在调用方，App 全程不弹卡，生成照跑。
//
// 链路：起真 GUI app（写 instance 广告）→ 另起 stdio MCP 子进程（同 NOMI_CAPABILITY_DIR → 探到运行中的
// GUI，经 RPC 转发）。全程 mock vendor，**零额度**。
// 用法：pnpm run build && node tests/ux/spend-elicit-app-open.walk.mjs
import { launchNomiApp, repoRoot, withLinuxNoSandbox } from './_launchApp.mjs'
import { startMockVendorServer, writeIsolatedCatalog, parseToolResult } from './_mcpJourney.mjs'
import { clickOrFail, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import readline from 'node:readline'
import path from 'node:path'

const require = createRequire(import.meta.url)
const shotsDir = path.join(repoRoot, 'tests/ux/shots/spend-elicit-app-open')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-spendelicit-'))
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
  // 刻意不设 NOMI_LOOP_SPEND_OK：付费必须靠真人确认走通，不许走 env 逃生口。
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
const ok = (c, l) => { if (!c) throw new Error(`FAIL: ${l}`); passed += 1; console.log(`  ✓ ${l}`) }

const mockVendor = await startMockVendorServer()
writeIsolatedCatalog(settingsDir, mockVendor.origin)

const { app } = await launchNomiApp({
  name: 'spend-elicit-app-open',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  env: { NOMI_CAPABILITY_DIR: capDir },
  args: ['--disable-gpu', '--disable-software-rasterizer'],
  settleMs: 0,
})

/**
 * 起一个 stdio MCP 子进程当外部 agent。capabilities 决定它是「能替我们问真人」的客户端还是不能的。
 * elicitation/create **不自动应答**——要趁它挂起时去 GUI 抓现行，看有没有第二张卡。
 */
function spawnAgent({ capabilities, clientName }) {
  const pending = new Map()
  const elicitInbox = []
  let elicitWaiter = null
  let elicitSeen = 0
  let seq = 0
  const child = spawn(require('electron'), withLinuxNoSandbox([repoRoot, '--disable-gpu']), {
    cwd: repoRoot,
    env: { ...process.env, ...sharedEnv, NOMI_MCP_STDIO: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const t = line.trim(); if (!t.startsWith('{')) return
    let msg; try { msg = JSON.parse(t) } catch { return }
    if (msg.method === 'elicitation/create' && msg.id != null) {
      elicitSeen += 1
      if (elicitWaiter) { const w = elicitWaiter; elicitWaiter = null; w(msg) } else elicitInbox.push(msg)
      return
    }
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
    rpc,
    async callTool(name, args, timeoutMs = 90000) {
      const res = (await rpc('tools/call', { name, arguments: args }, timeoutMs)).result
      const parsed = parseToolResult(res)
      if (parsed.isError) throw new Error(`工具 ${name} 失败：${parsed.text.slice(0, 200)}`)
      return parsed
    },
    async start() {
      let init = null
      for (let i = 0; i < 20 && !init; i++) {
        try { init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities, clientInfo: { name: clientName } }, 4000) } catch { await sleep(1000) }
      }
      return init
    },
    waitForElicit(timeoutMs = 30000) {
      if (elicitInbox.length) return Promise.resolve(elicitInbox.shift())
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { elicitWaiter = null; reject(new Error('没等到 elicitation/create')) }, timeoutMs)
        elicitWaiter = (msg) => { clearTimeout(timer); resolve(msg) }
      })
    },
    answerElicit(id, confirm) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result: confirm ? { action: 'accept', content: { confirm: true } } : { action: 'decline' } }) + '\n')
    },
    /** 累计收到过几次 elicitation/create（断言「第二次没再问」用）。 */
    elicitSeen: () => elicitSeen,
  }
}

let agents = []
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

  // 应用内付费确认卡（i18n runtime.capability.spendTitle = 「AI 助手想生成{{intent}}」）。
  const spendCard = win.locator('div.fixed.inset-0').filter({ hasText: /AI 助手想生成/ })

  // ── 前置：证明 App 真被认成「开着」——否则整条走查会退回 headless 路、测的是旧行为 ──
  const advertFiles = fs.readdirSync(capDir).filter((f) => f.startsWith('instance'))
  ok(advertFiles.length > 0, `GUI 写出了 instance 广告（${advertFiles.join(',')}）= isAppOpen() 为真`)
  const advert = JSON.parse(fs.readFileSync(path.join(capDir, advertFiles[0]), 'utf8'))
  const capToken = fs.readFileSync(path.join(capDir, 'token'), 'utf8').trim()
  const pingRes = await fetch(`http://127.0.0.1:${advert.port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${capToken}` },
    body: JSON.stringify({ method: 'ping', params: {} }),
  }).then((r) => r.json()).catch(() => null)
  ok(pingRes?.ok === true, `GUI 的 RPC server 活着（port=${advert.port}）= 生成会经 RPC 转发进 GUI 主进程`)

  // ══ A 腿 · 基线：客户端不声明 elicitation（Claude Code 当下）→ App 必须照旧弹卡 ══
  console.log('\n  ── A 腿：客户端问不了真人 → 应用内确认卡兜底（也是 B 腿的探针基线）──')
  const plainAgent = spawnAgent({ capabilities: {}, clientName: 'claude-code' })
  agents.push(plainAgent)
  ok(Boolean((await plainAgent.start())?.result), 'stdio MCP 起来了（不声明 elicitation）')
  const projA = await plainAgent.callTool('nomi_project_create', { name: '付费确认-兜底腿' })
  const projectIdA = projA.json?.projectId || projA.json?.id
  ok(projectIdA, `建项目（${projectIdA}）`)

  const genA = plainAgent.callTool('nomi_generate', {
    projectId: projectIdA, vendor: 'nomi-mock', modelKey: 'nomi-mock-image', intent: 'image', prompt: '兜底腿：巷口回头',
  })
  // 探针基线：这一屏卡**确实会浮**。expectAbsent 只认这个证明。
  const cardProof = await proveProbe(spendCard, '客户端不支持 elicitation 时，App 确实会弹付费确认卡', 30_000)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-fallback-card-shown.png') })
  ok(true, '不声明 elicitation + App 开着 → 应用内确认卡照旧弹出（没修坏兜底路）')
  // 卡上必须写明这一点还换来一段免问期（不写 = 骗同意）。
  const cardBody = await spendCard.first().innerText().catch(() => '')
  ok(/不再逐次打断你/.test(cardBody), '卡上写明了授权范围（「后续生成不再逐次打断你」），不是偷偷记信任')
  await clickOrFail(spendCard.locator('button').last(), '确认生成')
  const resA = await genA
  ok(resA.json?.status === 'succeeded', `点了卡之后生成跑完（status=${resA.json?.status}）`)

  // ★ 会话级信任：同项目第二次生成不该再弹卡——这是 Claude Code 这类客户端今天就能拿到的好处。
  console.log('  · 同项目再发一次生成，应当不再弹卡…')
  const resA2 = await plainAgent.callTool('nomi_generate', {
    projectId: projectIdA, vendor: 'nomi-mock', modelKey: 'nomi-mock-image', intent: 'image', prompt: '兜底腿：第二张',
  })
  ok(resA2.json?.status === 'succeeded', `第二次生成直接跑完（status=${resA2.json?.status}）——没再要一次点击`)
  await screenshotSettled(win, { path: path.join(shotsDir, '02b-second-gen-no-card.png') })
  await expectAbsent(spendCard, { provenBy: cardProof, message: '同会话同项目第二次生成不该再弹卡' })
  ok(true, '同项目第二次生成**没再弹卡**（治「反复确认」，卡片路也生效）')
  plainAgent.child.kill('SIGTERM')

  // ══ B 腿 · 修复本体：客户端声明 elicitation → 确认弹在调用方，App 不再弹卡 ══
  console.log('\n  ── B 腿：客户端能问真人 → 确认弹在调用方，Nomi 不该再要一次点击 ──')
  const elicitAgent = spawnAgent({ capabilities: { elicitation: {} }, clientName: 'codex' })
  agents.push(elicitAgent)
  ok(Boolean((await elicitAgent.start())?.result), 'stdio MCP 起来了（声明 elicitation）')
  const projB = await elicitAgent.callTool('nomi_project_create', { name: '付费确认-调用方腿' })
  const projectIdB = projB.json?.projectId || projB.json?.id
  ok(projectIdB, `建项目（${projectIdB}）`)

  const genB = elicitAgent.callTool('nomi_generate', {
    projectId: projectIdB, vendor: 'nomi-mock', modelKey: 'nomi-mock-image', intent: 'image', prompt: '调用方腿：巷口回头',
  })
  const elicit = await elicitAgent.waitForElicit(30_000)
  ok(true, 'App 开着，付费确认仍弹在**调用方**（收到 elicitation/create）——不再赶用户回 Nomi')
  const msgText = elicit.params?.message || ''
  console.log('  · 确认文案：', msgText.replace(/\n+/g, ' ').slice(0, 120))
  ok(msgText.includes('nomi-mock-image'), '确认文案点名了要花钱的模型（用户看得懂在批什么）')
  ok(!msgText.includes('Nomi 未打开'), '文案没再谎称「Nomi 未打开」（App 明明开着）')

  // 趁 elicitation 挂起去 GUI 抓现行——带 A 腿的基线，「没看到卡」才算数。
  await sleep(2000)
  await screenshotSettled(win, { path: path.join(shotsDir, '03-during-elicit-no-card.png') })
  await expectAbsent(spendCard, { provenBy: cardProof, message: '确认已在调用方问过，App 不该再弹第二张卡' })
  ok(true, 'elicitation 挂起期间 App **没有**弹付费确认卡（无双问，基线已证卡是能被看见的）')

  elicitAgent.answerElicit(elicit.id, true)
  const resB = await genB
  ok(resB.json?.status === 'succeeded', `调用方确认后生成直接跑完（status=${resB.json?.status}）——没碰过 Nomi 窗口`)
  const assetUrl = resB.json?.assets?.[0]?.url || ''
  ok(String(assetUrl).startsWith('nomi-local://'), `真落了资产（${String(assetUrl).slice(0, 46)}）= 付费令牌确实铸出来了`)

  await sleep(1000)
  await screenshotSettled(win, { path: path.join(shotsDir, '04-after-generate.png') })
  await expectAbsent(spendCard, { provenBy: cardProof, message: '生成结束后也不该补问一次' })
  ok(true, '生成结束后 App 依然没冒出确认卡（确认没被补问）')

  // ★ 会话级信任（elicitation 路）：同项目第二次连 elicitation 都不该再弹。
  const elicitBefore = elicitAgent.elicitSeen()
  const resB2 = await elicitAgent.callTool('nomi_generate', {
    projectId: projectIdB, vendor: 'nomi-mock', modelKey: 'nomi-mock-image', intent: 'image', prompt: '调用方腿：第二张',
  })
  ok(resB2.json?.status === 'succeeded', `第二次生成直接跑完（status=${resB2.json?.status}）`)
  ok(elicitAgent.elicitSeen() === elicitBefore, '同项目第二次生成**没再 elicit**（调用方那头也不再被打断）')
  await expectAbsent(spendCard, { provenBy: cardProof, message: '免问放行也不该退回去弹 App 卡' })
  ok(true, '免问放行没有退化成弹 App 卡')

  ok(mockVendor.hits.length >= 4, `两腿各两次生成都真跑了管线，打的是 mock vendor（${mockVendor.hits.length} 次，零额度）`)

  console.log(`\nSPEND-ELICIT PASS: ${passed} 断言——问得到真人的客户端就地问，问不到的照旧走 App 卡。`)
  console.log('  截图 →', shotsDir)
} catch (err) {
  console.log(`✗ ${err?.message || err}`)
  exitCode = 1
} finally {
  for (const a of agents) a.child.kill('SIGTERM')
  await mockVendor.close().catch(() => undefined)
  await app.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
