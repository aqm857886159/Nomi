// Phase C 端到端「参考宿主渲染」验证（不花额度）：证实我们这侧合规——真 Nomi MCP server
// （app 二进制 NOMI_MCP_STDIO）吐出的 widget，在一个符合 MCP Apps 规范的宿主里真的能渲染。
// 绕开 Claude 桌面版当前的 #671 前端 bug（custom server 不渲 iframe，Claude 侧未修）——那不是我们的问题。
//
// 流程：起真 stdio server → initialize(声明 io.modelcontextprotocol/ui) → tools/list 拿 nomi_generate 的
// _meta.ui.resourceUri → resources/read 取**server 真吐的 widget HTML** → 在 chromium 里当 iframe 装进一个
// 迷你宿主页（做 ui/initialize↔tool-result postMessage 握手）→ 注入 canonical nomiRun → 截图。零生成、零额度。
// 用法：pnpm run build && node tests/ux/mcp-apps-host-render.e2e.mjs
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import fs from 'node:fs'
import readline from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/mcp-apps-host')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-mcpapps-'))
let passed = 0
const ok = (c, l) => { if (!c) throw new Error(`FAIL: ${l}`); passed += 1; console.log(`  ✓ ${l}`) }
const UI_EXT = 'io.modelcontextprotocol/ui'
const MIME = 'text/html;profile=mcp-app'

const child = spawn(require('electron'), [repoRoot, '--disable-gpu'], {
  cwd: repoRoot,
  env: { ...process.env, NOMI_MCP_STDIO: '1', NOMI_SETTINGS_DIR: tmp, NOMI_ELECTRON_USER_DATA_DIR: tmp, NOMI_PROJECTS_DIR: path.join(tmp, 'projects'), NOMI_CAPABILITY_DIR: path.join(tmp, 'cap') },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const pending = new Map()
let seq = 0
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  const t = line.trim(); if (!t.startsWith('{')) return
  let m; try { m = JSON.parse(t) } catch { return }
  if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id); clearTimeout(p.timer); pending.delete(m.id); p.resolve(m) }
})
const rpc = (method, params, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const id = (seq += 1); const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC 超时: ${method}`)) }, timeoutMs)
  pending.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})

let exitCode = 0
try {
  // 1) initialize —— 声明 UI 扩展（像一个真 MCP Apps 宿主）。
  let init = null
  for (let i = 0; i < 20 && !init; i++) {
    try { init = await rpc('initialize', { protocolVersion: '2026-01-26', capabilities: { extensions: { [UI_EXT]: { mimeTypes: [MIME] } } } }, 4000) } catch { await new Promise((r) => setTimeout(r, 1000)) }
  }
  ok(init?.result, '真 Nomi stdio server 起来了（app 二进制 NOMI_MCP_STDIO）')

  // 2) tools/list —— nomi_generate 应带 _meta.ui.resourceUri。
  const tools = (await rpc('tools/list', {})).result.tools
  const gen = tools.find((t) => t.name === 'nomi_generate')
  const uri = gen?._meta?.ui?.resourceUri
  ok(uri && uri.startsWith('ui://'), `nomi_generate 带 _meta.ui.resourceUri（${uri}）`)

  // 3) resources/read —— 取 server 真吐的 widget HTML（不是读 .ts，是走协议拿）。
  const read = (await rpc('resources/read', { uri })).result
  const c0 = read?.contents?.[0]
  ok(c0?.mimeType === MIME, `widget 资源 mimeType 正确（${c0?.mimeType}）`)
  const widgetHtml = c0?.text || ''
  ok(widgetHtml.includes('<!DOCTYPE html>') && widgetHtml.includes('ui/notifications/tool-result'), 'server 吐出自包含 widget HTML（含宿主注入通道）')

  // 4) 在 chromium 里当真宿主渲染：iframe 装 widget，做 ui/initialize↔tool-result 握手，注入代表性数据。
  const thumb = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#241c12"/><circle cx="80" cy="55" r="22" fill="#e0a84e"/><rect y="84" width="160" height="16" fill="#12100a"/></svg>')
  const run = {
    kind: 'production',
    title: 'Nomi · brand.promo',
    status: 'available',
    message: '分镜已准备好；尚未批准付费或导出。',
    projectId: 'project-demo',
    runId: 'run-demo',
    deepLink: 'nomi://project/project-demo/run/run-demo',
    shots: [{ index: 1, title: 'video', status: 'success', kind: 'video', thumbnailUrl: thumb }],
  }
  const browser = await chromium.launch()
  async function render(colorScheme, name) {
    const page = await browser.newPage({ colorScheme, viewport: { width: 460, height: 560 } })
    // 迷你宿主页：把 server 吐的 widget 作为 iframe srcdoc；收到 widget 的握手就回注 tool-result。
    await page.setContent('<div id="host" style="padding:12px"></div>')
    await page.evaluate(({ html, data }) => {
      const f = document.createElement('iframe')
      f.style.cssText = 'width:420px;height:520px;border:0'
      window.addEventListener('message', (e) => {
        const m = e.data
        if (m && (m.method === 'ui/initialize' || m.method === 'ui/notifications/initialized')) {
          f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { nomiRun: data } } }, '*')
        }
      })
      f.srcdoc = html
      document.getElementById('host').appendChild(f)
    }, { html: widgetHtml, data: run })
    await page.waitForTimeout(700)
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
    const evidence = frame ? await frame.evaluate(() => ({
      previewCount: document.querySelectorAll('.shot').length,
      message: document.querySelector('#msg')?.textContent || '',
      actionCount: [...document.querySelectorAll('button')].filter((button) => button.textContent?.trim() === '在 Nomi 打开').length,
      status: document.querySelector('#badge')?.textContent || '',
    })) : null
    await page.screenshot({ path: path.join(shotsDir, name) })
    console.log(`  · shot ${name}`)
    await page.close()
    return evidence
  }
  const rendered = await render('light', 'host-render-light.png')
  await render('dark', 'host-render-dark.png')
  ok(rendered?.previewCount === 1, 'canonical nomiRun 只渲染一个最新预览')
  ok(rendered?.message === run.message && rendered?.status === '可查看', '状态与一句话说明真实可核对')
  ok(rendered?.actionCount === 1, '只有一个精确的「在 Nomi 打开」动作')

  // ChatGPT 桥：数据经 window.openai.toolOutput（非标准 postMessage）。注入 window.openai 于 widget 脚本前，
  // 验证同一份 widget 在 ChatGPT 那条桥上也能渲染出数据（双桥并存）。
  async function renderOpenAi(colorScheme, name) {
    const injected = widgetHtml.replace('<body>', `<body><script>window.openai={toolOutput:${JSON.stringify({ nomiRun: run })}}</script>`)
    const page = await browser.newPage({ colorScheme, viewport: { width: 460, height: 560 } })
    await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(injected))
    await page.waitForTimeout(500)
    const hasShots = await page.evaluate(() => /镜 1|已出/.test(document.body.innerText) && document.querySelectorAll('.shot').length === 1)
    await page.screenshot({ path: path.join(shotsDir, name) })
    await page.close()
    return hasShots
  }
  const openAiRendered = await renderOpenAi('light', 'host-render-chatgpt-bridge.png')
  await browser.close()
  ok(true, '标准 postMessage 桥渲染出真 server 的 widget（host-render-light/dark.png）')
  ok(openAiRendered, 'ChatGPT window.openai 桥也渲染出数据（host-render-chatgpt-bridge.png）——双桥并存')

  console.log(`\nMCP-APPS-HOST-RENDER PASS: ${passed} 断言——我们这侧合规、能在符合规范的宿主里渲染。`)
  console.log('  截图 →', shotsDir)
} catch (err) {
  console.log(`✗ ${err?.message || err}`)
  exitCode = 1
} finally {
  child.kill('SIGTERM')
  setTimeout(() => process.exit(exitCode), 300)
}
