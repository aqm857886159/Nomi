// R13/R16 走查：「本地模型」接入旅程（本地文本端点：探到 → 连 → 列表 → 能力预检 → 建档；未开服务时安静）。
// 用法: node tests/ux/local-model-connect.walk.mjs
// 产出: tests/ux/shots/local-model-connect/*.png
//
// 真 HTTP stub 服务器模拟本地运行时（serve /v1/models + 支持 tool-call 的 chat completion 响应）。
// 探测经 env NOMI_LOCAL_TEXT_PROBE_BASE_URLS 指向 stub 的随机端口，**不占用真实 11434/1234/8080**
// （避免和本机真运行时/其它 worktree 抢端口）。
//
// 等待纪律：断言用 _assert.mjs 的 expectVisible/expectText（自动重试到 15s），不用「长 sleep 当完成信号」。
// 探测/能力预检是异步的，让自动重试的断言去等模型行/能力徽标出现，而不是猜一个墙钟时长。
//
// 要人眼判的：
//   ① 探到运行时那张卡：列出 stub 上的模型 + 每个模型一个「连接」按钮
//   ② 点「连接」后：模型进已建档区，带能力徽标「支持 Agent」（stub 回了 tool_calls）
//   ③ 第二次启动、什么本地服务都没开：卡片安静提示「没检测到」，不报错、不打扰
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { openModelSettings, revealModelConnection } from './_shell.mjs'
import { clickOrFail, expectVisible, expectText, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/local-model-connect')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

let n = 0
async function snap(win, name) {
  n += 1
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

/** 起一个 OpenAI-兼容 stub：GET /v1/models + POST /v1/chat/completions（回 tool_calls）。 */
function startStub() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/v1/models') {
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-7b-instruct', object: 'model' }] }))
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      // 支持工具调用 → 能力预检判「支持 Agent」。
      return res.end(JSON.stringify({
        choices: [{
          index: 0,
          message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'report_ready', arguments: '{"ok":true}' } }] },
          finish_reason: 'tool_calls',
        }],
      }))
    }
    res.statusCode = 404
    res.end('{}')
  })
  return server
}

async function dismissChrome(win) {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2500)
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) {
      window.localStorage.setItem(k, 'seen')
    }
  })
  // 不用 win.reload()（会让 activeProjectId 恒 null，面板静默空掉）——冷启动已加载，直接清残留浮层。
  for (let i = 0; i < 5; i += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛|Skip/i }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(220)
  }
}

async function openLocalModelCard(win) {
  // 顶栏齿轮 → 设置「模型」页签（内含 OnboardingDrawer）：经 _shell.mjs。
  await openModelSettings(win, { label: '连接助手模型入口', timeout: 8000 })
  // 「本地模型」卡在「可接入」桶（种子默认 enabled:false）。稳定 data 锚点，不靠文案。
  // 有已接入项时它收在「其他接入方式」折叠里（没有已接入项时直接摆在首页）：没看见就先展开。
  const localCard = await revealModelConnection(win, win.locator('[data-model-home-available="local-text"]'), { label: '展开「其他接入方式」', timeout: stationTimeout() })
  await clickOrFail(localCard, '本地模型 可接入卡', { timeout: stationTimeout() })
}

// ── 场景一：探到 stub → 连 → 能力预检「支持 Agent」──────────────────────────────
async function scenarioDetected() {
  const stub = startStub()
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
  const stubBaseUrl = `http://127.0.0.1:${stub.address().port}/v1`
  console.log(`Stub local runtime: ${stubBaseUrl}`)

  const userData = path.join(repoRoot, '.tmp', 'nomi-localmodel-detected-userdata')
  const settingsDir = path.join(repoRoot, '.tmp', 'nomi-localmodel-detected-settings')
  for (const dir of [userData, settingsDir]) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
  }

  const { app, win } = await launchNomiApp({
    name: 'local-model-detected',
    userDataDir: userData,
    settingsDir,
    // 探测指向 stub 随机端口，不碰真实端口。
    env: { NODE_ENV: 'production', NOMI_LOCAL_TEXT_PROBE_BASE_URLS: stubBaseUrl },
    settleMs: 0,
  })
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) { w.setSize(1500, 1000); w.center() }
    }).catch(() => {})
    await dismissChrome(win)
    await openLocalModelCard(win)

    // 探到的模型行可见（自动重试等 stub 探测回来）——不用墙钟 sleep。
    await expectText(
      win.locator('[data-model-settings-page], [data-model-home-connection="local-text"]').first(),
      /qwen2\.5-7b-instruct/,
      '探到 stub 上的模型 id',
    )
    await snap(win, 'detected-card')

    // 点「连接」→ 建档 + 触发能力预检（对 stub 发 tool-call 探针）。
    await clickOrFail(win.locator('button', { hasText: /^连接$|^Connect$/ }).first(), '连接按钮', { timeout: 8000 })

    // 已建档 + 能力徽标「支持 Agent」（stub 回了 tool_calls）——自动重试等预检跑完。
    await expectVisible(win.locator('text=/支持 Agent|Agent-ready/').first(), '能力徽标 支持 Agent')
    await snap(win, 'connected-agent-badge')
    console.log('  ✓ 场景一：探到→连→列表→能力预检「支持 Agent」→建档')
  } finally {
    await app.close().catch(() => {})
    await new Promise((resolve) => stub.close(resolve))
  }
}

// ── 场景二：什么本地服务都没开 → 卡片安静提示，不报错 ─────────────────────────────
async function scenarioQuiet() {
  const userData = path.join(repoRoot, '.tmp', 'nomi-localmodel-quiet-userdata')
  const settingsDir = path.join(repoRoot, '.tmp', 'nomi-localmodel-quiet-settings')
  for (const dir of [userData, settingsDir]) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
  }
  // 探测指向一个几乎不可能开着的端口 → hits 为空 → 安静态。
  const { app, win } = await launchNomiApp({
    name: 'local-model-quiet',
    userDataDir: userData,
    settingsDir,
    env: { NODE_ENV: 'production', NOMI_LOCAL_TEXT_PROBE_BASE_URLS: 'http://127.0.0.1:59997/v1' },
    settleMs: 0,
  })
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) { w.setSize(1500, 1000); w.center() }
    }).catch(() => {})
    await dismissChrome(win)
    await openLocalModelCard(win)
    // 安静提示可见（没检测到）——自动重试等探测超时后回落安静态；这是卡内一行温和文案，不是错误弹窗。
    await expectVisible(
      win.locator('text=/没检测到本地模型服务|No local model service detected/').first(),
      '未检测到 安静提示',
    )
    await snap(win, 'not-detected-quiet')
    console.log('  ✓ 场景二：未开服务时卡片安静不打扰')
  } finally {
    await app.close().catch(() => {})
  }
}

console.log('▶ 本地模型接入旅程走查')
await scenarioDetected()
await scenarioQuiet()
console.log(`✓ 走查完成，截图见 ${shotsDir}`)
