// 真实端到端（零额度）：证明「生成画布助手的**面板专长层 systemPrompt** 真的上了 wire，
// 并进了最终送往模型的 system 消息」。
//
// 背景（2026-08-24 修的存量 bug）：画布助手的 buildStaticAgentSystemPrompt（本面工具手册 + 硬约束）
// 经 runWorkbenchAgent 一路传下来，却在 buildWorkbenchAiPayload 处被静默丢弃——payload.systemPrompt
// 对所有现役 caller 恒为空，专长层从未生效过。后端接收侧一直是齐的，只差渲染层没塞进 payload。
//
// 为什么必须走真实 UI 路径：直调 window.nomiDesktop.agents.chatV2Start 的 e2e 是自己手搓 payload、
// **绕过** buildWorkbenchAiPayload 的——那条路修没修都会绿，是假绿。这里从「用户在助手栏打字按回车」
// 出发，真 UI → 真 IPC → 真 transport，只把远端 vendor 换成本地 loopback，于是能直接在 wire 上验。
//
// 判定（硬证据，不看截图也成立）：送往 /v1/chat/completions 的 system 消息里必须出现专长层原文。
// 用法：pnpm run build && node tests/ux/agent-panel-system-prompt.walk.mjs
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible, expectText, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/agent-panel-system-prompt')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-panel-sysprompt-'))
const settingsDir = path.join(tempRoot, 'settings')
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [shotsDir, settingsDir, userDataDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const NOW = '2026-08-24T00:00:00.000Z'
const VENDOR = 'panel-sysprompt-mock'
const TEXT_MODEL = 'mock-text-brain'
// 专长层第一行（generationCanvasAgentClient.buildStaticAgentSystemPrompt 的开头）——
// 它出现在 system 里，就证明这一层真的到了模型面前。
const PANEL_LAYER_MARKER = '你现在在「生成画布」工作'
// 后端共享身份层（NOMI_AGENT_IDENTITY）也该在 —— 用来区分「system 整个没送」和「只丢了专长层」。
const REPLY = '收到。我先读一下画布，再给你一个分镜计划。'

/** 记下每一次打到 /v1/chat/completions 的请求体（我们要验的证物）。 */
const chatCalls = []

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

const server = http.createServer(async (req, res) => {
  const raw = await readBody(req)
  if (!(req.url || '').startsWith('/v1/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `No route ${req.method} ${req.url}` } }))
    return
  }
  let parsed = {}
  try { parsed = raw ? JSON.parse(raw) : {} } catch { parsed = {} }
  chatCalls.push(parsed)

  if (parsed.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const id = 'chatcmpl-panel-sysprompt'
    const model = parsed.model || TEXT_MODEL
    const frame = (delta, finish) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    res.write(frame({ role: 'assistant', content: '' }, null))
    res.write(frame({ content: REPLY }, null))
    res.write(frame({}, 'stop'))
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    id: 'c1', object: 'chat.completion', created: 1, model: parsed.model,
    choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
  }))
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const origin = `http://127.0.0.1:${port}`

fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{
    key: VENDOR, name: 'Panel SysPrompt Mock', enabled: true,
    baseUrlHint: origin, authType: 'bearer', authHeader: null, authQueryParam: null,
    providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW,
  }],
  models: [
    { modelKey: TEXT_MODEL, vendorKey: VENDOR, labelZh: 'Mock 文本大脑', kind: 'text', enabled: true, createdAt: NOW, updatedAt: NOW },
  ],
  mappings: [],
  apiKeysByVendor: {
    [VENDOR]: { apiKey: 'sk-panel-mock', vendorKey: VENDOR, enabled: true, enc: 'plain', createdAt: NOW, updatedAt: NOW },
  },
}, null, 2))

let shotIndex = 0
async function snap(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`  screenshot: ${path.basename(file)}`)
  return file
}

function fail(message) {
  console.error(`\n❌ ${message}`)
  process.exitCode = 1
}

const { app, win } = await launchNomiApp({
  name: 'agent-panel-system-prompt',
  settingsDir, userDataDir, projectsDir,
  args: ['--disable-gpu', '--disable-software-rasterizer'],
})

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2200)
  // 先把首启蒙层/引导标成 seen，再 reload —— 此时还没进项目，reload 安全
  // （进项目后再 reload 会让 getActiveWorkbenchProjectId() 恒 null，面板静默空掉）。
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2500)

  // ① 新建空白项目 → 切「生成」工作区
  const blankCta = win.locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await clickOrFail(blankCta, '新建空白项目')
  await win.waitForTimeout(3000)

  const genTab = win.locator('button, [role="button"], [role="tab"]', { hasText: /^生成$/ }).first()
  await clickOrFail(genTab, '生成 工作区页签')
  // 不睡固定时长——等舞台真的挂上来（expectVisible 自带轮询/超时）。
  await expectVisible(win.locator('.generation-canvas-v2__stage').first(), '生成画布舞台')

  // ② 打开右侧助手栏（launcher 用原生 DOM click，避开 actionability 抖动）
  // Host cutover: 画布内旧助手已退役，Agent 现居 ResidentShell dock（default-off agentHost flag, #194）。
  // 折叠态 launcher 是 [data-agent-resident-collapsed] 药丸；展开后输入框在 [data-agent-composer] 内。
  await win.evaluate(() => {
    const btn = document.querySelector('[data-agent-resident-collapsed="true"]')
    if (btn) btn.click()
  })
  const composer = win.locator('[data-agent-composer="true"] textarea').first()
  // 同上：等输入框真的出现，别拿 sleep 当「面板已展开」的信号。
  await expectVisible(composer, '助手输入框')
  await snap(win, 'assistant-open')

  // ③ 真实发一条消息（回车即发，同真人）
  await composer.fill('帮我把这个画布搭起来')
  await composer.press('Enter')

  // ④ 等 wire 上真的落下一次 chat/completions
  const deadline = Date.now() + 60_000
  while (chatCalls.length === 0 && Date.now() < deadline) {
    await win.waitForTimeout(500)
  }
  await win.waitForTimeout(2500)
  await snap(win, 'assistant-reply')

  // ========== 判定 ==========
  if (chatCalls.length === 0) {
    fail('助手没有向 vendor 发出任何 chat/completions 请求——这条走查没走到现场，判定不成立。')
  } else {
    const call = chatCalls[0]
    const messages = Array.isArray(call.messages) ? call.messages : []
    const systemText = messages
      .filter((m) => m && m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n')

    console.log(`\n  wire 上收到 ${chatCalls.length} 次 chat/completions；system 长度 ${systemText.length}`)

    if (!systemText) {
      fail('送往模型的消息里根本没有 system 段——比预期更糟，整层都没送。')
    } else if (!systemText.includes(PANEL_LAYER_MARKER)) {
      fail(`system 里找不到面板专长层原文「${PANEL_LAYER_MARKER}」——systemPrompt 仍在半路被丢弃。\n` +
        `  实际 system 开头：${systemText.slice(0, 240)}`)
    } else {
      console.log(`  ✅ system 里找到了面板专长层「${PANEL_LAYER_MARKER}」`)
    }

    // 专长层该带着它的硬约束一起到（证明是整段而不是被截断的一行）。
    for (const clause of ['create_staging_reference', 'run_generation_batch', '硬约束']) {
      if (systemText.includes(clause)) continue
      fail(`system 里缺少专长层的「${clause}」——像是只到了一部分，检查是否被截断。`)
    }
  }

  // ⑤ 助手真的把回复渲染出来了（用户看得见这一轮跑通了）
  await expectText(
    win.locator('[aria-label="生成区 AI 助手"]').first(),
    /收到。我先读一下画布/,
    '助手把模型回复渲染到面板里',
  ).catch((error) => fail(`助手面板没渲染出模型回复：${error.message}`))

  if (process.exitCode === 1) {
    console.error('\n走查失败（见上）。截图在 tests/ux/shots/agent-panel-system-prompt/')
  } else {
    console.log('\n✅ 面板专长层 systemPrompt 已真实抵达模型的 system 消息，且助手一轮对话跑通。')
  }
} catch (error) {
  fail(`走查异常：${error && error.stack ? error.stack : error}`)
  await snap(win, 'error').catch(() => {})
} finally {
  await app.close().catch(() => {})
  server.close()
}
