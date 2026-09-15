// 真机验收：接入验证会话「一定落终态 + certifying 一定能取消」（2026-09-15）
//
// 为什么走 MCP 而不是点界面：用户 09-11/09-12 撞到的那次死锁就是从外部宿主
// （WorkBuddy）驱动 `nomi_integration` 撞的——run 卡在 certifying、cancel 被拒、
// 只能重启 app。要在真机上复现「同一条路」，就得走同一条路：真实 Electron 主进程、
// 真实 stdio MCP 通道、隔离 profile、真实密钥与真实上游端点。
//
// 用法：
//   pnpm build && source ~/.nomi-secrets.env && node tests/ux/integration-session-terminal.e2e.mjs
//   （没有 DEEPSEEK_API_KEY 时 A 臂自动跳过，B 臂照跑——B 臂零额度、零外网。）
//
// A 臂（真花钱那条路，DeepSeek 官方 OpenAI 兼容端点）：
//   begin → open_credentials（真人在一次性安全页里贴真 key）→ propose → start
//   → 轮询到**终态**。证的是本轮把结果回写改成「先攒局部变量再查终态」之后，
//   正常路径照旧能落 completed（回归保护）。
//
// B 臂（本轮真正修的那三个窗口里最容易复现的一个，零额度）：
//   `comfyui-workflow` 会话指向一个**只接受连接、永不回应**的本机 socket
//   → certifyComfy 挂住 → 会话停在 certifying。此时：
//     ① cancel 必须返回 cancelled（修前这里抛 "Cannot cancel certification in progress"）
//     ② 迟到的认证结果不许把已取消的会话复活
//   这条路是**免费自检**，压根不创建 providerAdapter 的 run，所以 09-12 那一版的
//   run 层保证一个字都覆盖不到它。
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import {
  assertBuilt,
  makeIsolatedDirs,
  parseToolResult,
  spawnMcpStdioClient,
} from './_mcpJourney.mjs'

const EVIDENCE = path.resolve('artifacts/integration-session-terminal')
fs.mkdirSync(EVIDENCE, { recursive: true })

const TERMINAL_STAGES = new Set(['completed', 'partial', 'failed', 'cancelled'])
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const checks = []
function check(condition, label, detail) {
  checks.push({ ok: Boolean(condition), label })
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** A 臂的固定隔离 profile（跑完留给 UI 走查截图用；每次从零开始，不继承上一轮）。 */
function stableIsolatedDirs(tempRoot) {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  const dirs = {
    tempRoot,
    settingsDir: tempRoot,
    userDataDir: path.join(tempRoot, 'user-data'),
    projectsDir: path.join(tempRoot, 'projects'),
    capabilityDir: path.join(tempRoot, 'capability'),
  }
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
  return dirs
}

/** 只接受 TCP 连接、永不写一个字节的上游：吊死一条认证的最便宜也最真实的方式。 */
async function startBlackHole() {
  const sockets = []
  const server = net.createServer((socket) => { sockets.push(socket) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/** 轮询会话阶段直到终态。不用私有墙钟 waitFor（R18）：读的是产品自己的投影。 */
async function waitForTerminal(mcp, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    const read = parseToolResult(await mcp.callTool('nomi_read', { target: 'integration', sessionId }))
    last = read.json || {}
    if (TERMINAL_STAGES.has(String(last.stage))) return last
    if (Date.now() >= deadline) return last
    await delay(1_000)
  }
}

const COMFY_WORKFLOW = JSON.stringify({
  1: { class_type: 'LoadImage', inputs: { image: 'first.png' } },
  2: { class_type: 'CLIPTextEncode', inputs: { text: '{{request.prompt}}', clip: ['3', 0] } },
  3: { class_type: 'SaveImage', inputs: { image: ['2', 0] } },
})

// ── A 臂：真 key + 真端点，正常路径仍然落终态 ────────────────────────────
async function realProviderArm(apiKey) {
  // A 臂用**固定**的隔离 profile：跑完之后 UI 走查
  // （integration-session-terminal.walk.mjs）直接拿这份真实认证结果起界面截图，
  // 不重跑一次真实请求、也不去动用户真实资料库。
  const dirs = stableIsolatedDirs(path.join(EVIDENCE, 'profile-arm-a'))
  const mcp = spawnMcpStdioClient({
    ...dirs,
    capabilities: { elicitation: { form: {}, url: {} } },
    clientInfo: { name: 'Claude Code', version: 'integration-session-terminal' },
    syntheticCredentialStorage: true,
    tracePath: path.join(EVIDENCE, 'arm-a-real-provider.jsonl'),
  })
  try {
    await mcp.initialize(20_000)
    const begun = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'begin',
      kind: 'http-api-provider',
      name: 'DeepSeek 兼容端点',
      baseUrl: 'https://api.deepseek.com/v1',
      providerKind: 'openai-compatible',
      authType: 'bearer',
      clientRequestId: 'session-terminal-real-1',
    }))
    check(begun.json?.stage === 'needs_credential', 'A1 begin 建出待补密钥的接入会话', begun.json?.stage)
    const sessionId = begun.json?.id

    // 真人在一次性安全页里贴真 key（密钥永不进 MCP 通道，那条不变量由既有 e2e 盯）。
    const pending = mcp.callTool('nomi_integration', {
      action: 'open_credentials', sessionId, expectedRevision: begun.json?.revision,
    }, { timeoutMs: 120_000 })
    let elicit
    for (const deadline = Date.now() + 30_000; ;) {
      const found = mcp.urlElicitations()
      if (found.length) { elicit = found[found.length - 1]; break }
      if (Date.now() >= deadline) throw new Error('安全页链接没来')
      await delay(150)
    }
    const url = new URL(String(elicit.url))
    const token = url.searchParams.get('t')
    const save = await fetch(`${url.origin}/integration-credential/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ t: token, apiKey }),
    })
    check(save.status === 200, 'A2 真 key 经一次性安全页存进本机加密存储', `HTTP ${save.status}`)
    const opened = parseToolResult(await pending)
    check(opened.json?.credentialStatus === 'ready', 'A2 会话显示密钥已就绪')

    // 空 propose = 让 Nomi 自己去真实上游拉模型清单。
    const discovered = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'propose', sessionId, expectedRevision: opened.json?.revision, proposal: {},
    }, { timeoutMs: 90_000 }))
    const candidates = discovered.json?.candidates || []
    check(candidates.length > 0, 'A3 从真实 /v1/models 拉到候选模型', `n=${candidates.length}`)
    const pick = candidates.find((item) => item.kind === 'text') || candidates[0]

    const selected = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'propose', sessionId, expectedRevision: discovered.json?.revision,
      proposal: { candidates: [{ modelKey: pick.modelKey, kind: pick.kind }], selections: [{ modelKey: pick.modelKey }] },
    }, { timeoutMs: 60_000 }))
    check(selected.json?.stage === 'ready_to_certify', 'A4 选一个文本模型后可以开跑', selected.json?.stage)

    const started = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'start', sessionId, expectedRevision: selected.json?.revision,
      idempotencyKey: 'session-terminal-real-start',
    }, { timeoutMs: 120_000 }))
    check(!started.isError, 'A5 start 不报错', started.json?.stage)

    const final = await waitForTerminal(mcp, sessionId, 12 * 60_000)
    check(TERMINAL_STAGES.has(String(final.stage)), 'A6 会话落到终态（不再无限期停在 certifying）', `stage=${final.stage} reason=${final.blockingReason?.code ?? '—'}`)
    check(final.certifyingDeadlineAt, 'A6 会话带着落盘的认证 deadline（本轮新增，看门狗据它收尸）', String(final.certifyingDeadlineAt))
    fs.writeFileSync(path.join(EVIDENCE, 'arm-a-final-session.json'), JSON.stringify(final, null, 2))
    return final
  } finally {
    await mcp.terminate()
  }
}

// ── B 臂：免费自检那条路吊死之后，certifying 必须有出口 ────────────────────
async function escapeHatchArm() {
  const hole = await startBlackHole()
  const dirs = makeIsolatedDirs('nomi-session-terminal-hatch-')
  const mcp = spawnMcpStdioClient({
    ...dirs,
    capabilities: { elicitation: { form: {}, url: {} } },
    clientInfo: { name: 'Claude Code', version: 'integration-session-terminal' },
    syntheticCredentialStorage: true,
    tracePath: path.join(EVIDENCE, 'arm-b-escape-hatch.jsonl'),
  })
  try {
    await mcp.initialize(20_000)
    const begun = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'begin',
      kind: 'comfyui-workflow',
      name: '吊死的本机 ComfyUI',
      baseUrl: hole.baseUrl,
      clientRequestId: 'session-terminal-hatch-1',
    }))
    check(!begun.isError, 'B1 begin 建出 ComfyUI 接入会话（免费自检那条路）', begun.json?.stage)
    const sessionId = begun.json?.id

    const proposed = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'propose', sessionId, expectedRevision: begun.json?.revision,
      proposal: { workflow: COMFY_WORKFLOW, modelKey: 'hatch-probe' },
    }, { timeoutMs: 60_000 }))
    check(proposed.json?.stage === 'ready_to_certify', 'B2 工作流通过分析，可以开跑', proposed.json?.stage)

    // start 会挂住（上游只接受连接不回应）。**不 await**：这正是死锁那一刻的现场。
    const hanging = mcp.callTool('nomi_integration', {
      action: 'start', sessionId, expectedRevision: proposed.json?.revision,
      idempotencyKey: 'session-terminal-hatch-start',
    }, { timeoutMs: 8 * 60_000 }).catch((error) => ({ swallowed: String(error?.message || error) }))

    let certifying
    for (const deadline = Date.now() + 60_000; ;) {
      const read = parseToolResult(await mcp.callTool('nomi_read', { target: 'integration', sessionId }))
      certifying = read.json || {}
      if (certifying.stage === 'certifying' || TERMINAL_STAGES.has(String(certifying.stage))) break
      if (Date.now() >= deadline) break
      await delay(500)
    }
    check(certifying.stage === 'certifying', 'B3 会话确实停在 certifying（死锁那一刻的现场）', `stage=${certifying.stage}`)
    check(Boolean(certifying.certifyingDeadlineAt), 'B3 中间态带着到期时间 —— 没人按取消时看门狗据它收尸', String(certifying.certifyingDeadlineAt))
    check(!certifying.childRunRef, 'B3 这条路没有 childRunRef（09-12 那版的 run 层保证覆盖不到它）')
    fs.writeFileSync(path.join(EVIDENCE, 'arm-b-certifying-session.json'), JSON.stringify(certifying, null, 2))

    // ★ 本轮的核心断言：修前这里抛 "Cannot cancel certification in progress"。
    const cancelled = parseToolResult(await mcp.callTool('nomi_integration', {
      action: 'cancel', sessionId, expectedRevision: certifying.revision,
    }, { timeoutMs: 60_000 }))
    check(!cancelled.isError, 'B4 cancel 不再报错（修前：Cannot cancel certification in progress）',
      cancelled.isError ? JSON.stringify(cancelled.json || cancelled.text) : '')
    check(cancelled.json?.stage === 'cancelled', 'B4 会话真的落到 cancelled —— certifying 有出口了', cancelled.json?.stage)
    check(cancelled.json?.blockingReason?.code === 'certification_abandoned_locally',
      'B4 如实标注「本地放弃」而不是假装撤销了远端', cancelled.json?.blockingReason?.code)
    fs.writeFileSync(path.join(EVIDENCE, 'arm-b-cancelled-session.json'), JSON.stringify(cancelled.json, null, 2))

    // 放开逃生口的对偶：迟到的结果不许复活已取消的会话。
    await hole.close() // 掐掉上游 → 那个挂住的 certifyComfy 现在会以失败 settle
    await Promise.race([hanging, delay(90_000)])
    const after = parseToolResult(await mcp.callTool('nomi_read', { target: 'integration', sessionId }))
    check(after.json?.stage === 'cancelled', 'B5 迟到的认证结果没有把已取消的会话复活（终态是封的）', after.json?.stage)
  } finally {
    await mcp.terminate()
    await hole.close().catch(() => {})
  }
}

assertBuilt()

const apiKey = process.env.DEEPSEEK_API_KEY || ''
if (apiKey) {
  console.log('\n▶ A 臂：真 key + DeepSeek 官方 OpenAI 兼容端点')
  await realProviderArm(apiKey)
} else {
  console.log('\n▶ A 臂跳过：没有 DEEPSEEK_API_KEY（source ~/.nomi-secrets.env 后再跑）')
}

console.log('\n▶ B 臂：免费自检那条路吊死之后的逃生口（零额度、零外网）')
await escapeHatchArm()

const failed = checks.filter((entry) => !entry.ok)
console.log(`\n${failed.length ? '✗' : '✓'} ${checks.length - failed.length}/${checks.length} 通过；证据 ${EVIDENCE}`)
if (failed.length) {
  for (const entry of failed) console.log(`   ✗ ${entry.label}`)
  process.exit(1)
}
