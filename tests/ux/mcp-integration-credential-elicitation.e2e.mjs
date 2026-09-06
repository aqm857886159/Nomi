// Real-transport journey for the ONE step where an external MCP host has to obtain a secret:
// `nomi_integration action=open_credentials`.
//
// MCP spec 2025-11-25 (client/elicitation) forbids asking for an API key in form mode — "Servers MUST
// NOT use form mode elicitation to request sensitive information such as passwords, API keys" — and
// mandates URL mode instead, so the key never reaches the MCP client or the model context. This
// journey plays both hosts against the real headless stdio server, with zero provider quota:
//
//   A. Claude-Code-shaped client (capabilities.elicitation = { form, url }):
//      begin → open_credentials → server sends elicitation/create (mode: "url") → we act as the user
//      in the browser: GET the page, POST /test, POST /save → the blocked tool call returns a session
//      whose credential is ready → notifications/elicitation/complete arrives.
//   B. Form-only client (capabilities.elicitation = {}): no URL is ever handed over; the result names
//      the in-app manual path instead. The server must never send a mode the client did not declare.
//
// The load-bearing assertion in both arms: the fake key appears in NO frame the client ever received.
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import {
  assertBuilt,
  makeIsolatedDirs,
  parseToolResult,
  spawnMcpStdioClient,
} from './_mcpJourney.mjs'

const FAKE_KEY = 'sk-nomi-walkthrough-not-a-real-key-8f3ac1'
// 证据落 artifacts/（.gitignore 内，跟仓库既有做法一致：走查产物不进 git，但路径稳定可复看）。
const EVIDENCE = path.resolve('artifacts/mcp-credential-elicitation')

const checks = []
function check(condition, label) {
  checks.push({ ok: Boolean(condition), label })
  console.log(`${condition ? '✓' : '✗'} ${label}`)
}

async function startProvider() {
  const hits = []
  const server = createServer((req, res) => {
    hits.push({ url: req.url, auth: Boolean(req.headers.authorization) })
    if (req.url === '/v1/models' || req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'relay-image' }, { id: 'relay-video' }] }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll for the server→client url-mode elicitation instead of a blind sleep. */
async function waitForUrlElicitation(mcp, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = mcp.urlElicitations()
    if (found.length) return found[found.length - 1]
    if (Date.now() >= deadline) throw new Error('no url-mode elicitation arrived within the timeout')
    await delay(150)
  }
}

async function urlModeArm(dirs, provider, evidence) {
  // Claude Code declares both modes (spec §Capabilities: an empty object would mean form only).
  const mcp = spawnMcpStdioClient({
    ...dirs,
    capabilities: { elicitation: { form: {}, url: {} } },
    clientInfo: { name: 'Claude Code', version: 'credential-elicitation-e2e' },
    syntheticCredentialStorage: true,
    tracePath: path.join(EVIDENCE, 'mcp-credential-elicitation-url-mode.jsonl'),
  })
  try {
    await mcp.initialize(20_000)
    const begun = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'begin',
      kind: 'http-api-provider',
      name: 'Walkthrough relay',
      baseUrl: provider.baseUrl,
      providerKind: 'openai-compatible',
      authType: 'bearer',
      clientRequestId: 'credential-elicitation-j1',
    }))
    check(!begun.isError && begun.json?.stage === 'needs_credential', 'A1 begin 建出待补密钥的接入会话')
    const sessionId = begun.json?.id
    const revision = begun.json?.revision

    // open_credentials blocks until the out-of-band page is completed, so drive both halves at once.
    const pending = mcp.callTool('nomi_integration', {
      action: 'open_credentials', sessionId, expectedRevision: revision,
    }, { timeoutMs: 120_000 })

    const elicit = await waitForUrlElicitation(mcp)
    evidence.elicitation = elicit
    check(elicit.mode === 'url', 'A2 服务端发的是 elicitation/create mode="url"（不是 form）')
    check(typeof elicit.elicitationId === 'string' && elicit.elicitationId.length >= 8, 'A2 带 elicitationId（2025-11-25 URL 模式必填）')
    check(typeof elicit.message === 'string' && elicit.message.length > 0, 'A2 带人读 message 说明为什么要这个')
    check(!('requestedSchema' in elicit), 'A2 URL 模式不带 requestedSchema —— 客户端没有可填密钥的表单')
    const url = new URL(String(elicit.url))
    check(url.protocol === 'http:' && url.hostname === '127.0.0.1', 'A3 URL 指向本机回环页面，不是任何远端')
    check(/^[a-f0-9]{64}$/.test(url.searchParams.get('t') || ''), 'A3 URL 只带一个不可猜的一次性 token')
    check(!url.href.includes(String(sessionId)), 'A3 URL 不泄露会话身份等任何可识别信息')

    // ── 用户在浏览器里的那一段 ───────────────────────────────────────────
    const page = await fetch(url.href)
    const html = await page.text()
    evidence.pageStatus = page.status
    check(page.status === 200, 'A4 一次性页面打得开')
    check(html.includes('Walkthrough relay') && html.includes(provider.baseUrl), 'A4 页面把供应商名和 base URL 只读地摆出来')
    check(html.includes('type="password"'), 'A4 页面有密钥输入框')
    check(!/src="https?:/.test(html), 'A4 页面自包含，不拉任何外部脚本/样式')
    check(String(page.headers.get('content-security-policy') || '').includes("default-src 'none'"), 'A4 页面带收紧的 CSP')

    const postJson = (route, body) => fetch(`${url.origin}/integration-credential${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const tested = await (await postJson('/test', { t: url.searchParams.get('t'), apiKey: FAKE_KEY })).json()
    check(tested.ok === true && tested.count === 2, 'A5 「测试连接」用刚输入的 key 真连了一次供应商')
    check(provider.hits.some((hit) => hit.auth), 'A5 测试请求确实带上了鉴权头（key 用在了该用的地方）')

    const saveResponse = await postJson('/save', { t: url.searchParams.get('t'), apiKey: FAKE_KEY })
    const saveBody = await saveResponse.text()
    check(saveResponse.status === 200 && JSON.parse(saveBody).ok === true, 'A6 保存成功')
    check(!saveBody.includes(FAKE_KEY), 'A6 保存响应体里没有 key')
    const replayed = await postJson('/save', { t: url.searchParams.get('t'), apiKey: FAKE_KEY })
    check(replayed.status === 400, 'A6 同一个 token 不能再用第二次（一次性）')

    // ── 回到 MCP：阻塞的那次调用应当拿到「已配置」 ───────────────────────
    const opened = parseToolResult(await pending)
    evidence.openedStage = opened.json?.stage
    check(!opened.isError, 'A7 open_credentials 正常返回（不是错误）')
    check(opened.json?.credentialStatus === 'ready', 'A7 返回的会话显示密钥已就绪')
    check(!opened.json?.credentialEntry, 'A7 用掉的一次性链接不再回流给模型')
    check(mcp.elicitationCompletions().includes(elicit.elicitationId), 'A8 服务端发了 notifications/elicitation/complete')

    const read = parseToolResult(await mcp.callTool('nomi_read', { target: 'integration', sessionId }))
    check(read.json?.credentialStatus === 'ready', 'A9 nomi_read 也显示已配置')
    check(!JSON.stringify(read.json || {}).includes(FAKE_KEY), 'A9 读回来的投影里没有 key')

    const allFrames = JSON.stringify(mcp.messages())
    check(!allFrames.includes(FAKE_KEY), 'A10 整条 MCP 通道从头到尾没出现过 key')
    check(mcp.urlElicitations().length === 1, 'A10 全程只问了这一次')
    return { sessionId }
  } finally {
    await mcp.terminate()
  }
}

async function formOnlyArm(dirs, provider) {
  // capabilities.elicitation = {} is the spec's backwards-compatible "form mode only".
  const mcp = spawnMcpStdioClient({
    ...dirs,
    capabilities: { elicitation: {} },
    clientInfo: { name: 'form-only-host', version: 'credential-elicitation-e2e' },
    syntheticCredentialStorage: true,
    tracePath: path.join(EVIDENCE, 'mcp-credential-elicitation-form-only.jsonl'),
  })
  try {
    await mcp.initialize(20_000)
    const begun = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'begin',
      kind: 'http-api-provider',
      name: 'Form-only relay',
      baseUrl: provider.baseUrl,
      authType: 'bearer',
      clientRequestId: 'credential-elicitation-j2',
    }))
    check(!begun.isError, 'B1 form-only 宿主也能建接入会话')
    const opened = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'open_credentials', sessionId: begun.json?.id, expectedRevision: begun.json?.revision,
    }, { timeoutMs: 60_000 }))
    check(mcp.urlElicitations().length === 0, 'B2 没向只声明 form 的宿主发 mode="url"（规范禁止）')
    check(mcp.elicitationCount() === 0, 'B2 也没退化成 form 模式问密钥')
    check(opened.json?.credentialEntry?.mode === 'manual', 'B3 给出明确的手动路径而不是一个它打不开的链接')
    check(/设置|Settings/.test(String(opened.json?.credentialEntry?.instructions || '')), 'B3 手动路径写明「Nomi → 设置 → 模型」')
    check(/Nomi 没在运行|Nomi is not running/.test(String(opened.json?.credentialEntry?.instructions || '')), 'B3 Nomi 未运行时明确提示先启动 Nomi')
    // baseUrl 在本走查里本就是回环的 mock 供应商，所以判据是「凭据页那条 URL」而不是「127.0.0.1」。
    check(!JSON.stringify(opened.json || {}).includes('/integration-credential'), 'B3 不把一次性凭据页 URL 交给拿不住它的宿主')
    check(!JSON.stringify(mcp.messages()).includes(FAKE_KEY), 'B4 这条通道同样没有 key')
  } finally {
    await mcp.terminate()
  }
}

async function main() {
  assertBuilt()
  fs.mkdirSync(EVIDENCE, { recursive: true })
  const provider = await startProvider()
  const evidence = {}
  try {
    await urlModeArm(makeIsolatedDirs('nomi-mcp-credential-url-'), provider, evidence)
    await formOnlyArm(makeIsolatedDirs('nomi-mcp-credential-form-'), provider)
  } finally {
    await provider.close()
  }
  fs.writeFileSync(
    path.join(EVIDENCE, 'mcp-credential-elicitation-summary.json'),
    `${JSON.stringify({ at: new Date().toISOString(), evidence, checks }, null, 2)}\n`,
  )
  const failed = checks.filter((entry) => !entry.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} 项通过`)
  if (failed.length) {
    console.error('失败项：', failed.map((entry) => entry.label).join(' | '))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
