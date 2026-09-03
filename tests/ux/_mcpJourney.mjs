// Shared infra for real-process MCP journeys — the ONE spawn/framing/teardown/mock-vendor implementation
// (P1: no copy-paste) driven by the L1/L2 MCP journeys and production-mcp-journey.e2e.mjs, plus
// any future real-transport MCP test. Client-specific differences (initialize capabilities, clientInfo,
// extra env) are options on spawnMcpStdioClient; error semantics come in two shapes — callTool (returns
// raw, isError inspectable) and callToolOrThrow (throws on isError) — so both call sites stay clean.
//
// NOT reused by packaged-mcp-smoke.e2e.mjs, on purpose: that test boots the PACKAGED node launcher
// (`Nomi Helper` + mcpNodeLauncher.js under ELECTRON_RUN_AS_NODE, with per-client HMAC origin proofs) to
// prove the release launcher's signing path — a materially different spawn than this module's
// `electron <repoRoot>` stdio server, and its whole point. Folding it in would add a launcher-vs-electron
// mode switch here for no dedup benefit, so it keeps its own small framing.
//
// Transport under test = the REAL in-Electron MCP stdio server: `electron <repoRoot>` with
// NOMI_MCP_STDIO=1. That process is genuinely headless (no window, app.dock.hide, disk gateway) and
// speaks real newline-delimited JSON-RPC 2.0 over stdio — the exact framing mcpProtocol.ts implements.
// It is the same real-process transport production-mcp-journey uses; see the journey headers for
// why this (not the bare-Node mcpNodeLauncher wrapper) is the faithful path for a zero-dialog headless
// spend: the launcher always ensures a *GUI* app instance whose unopened-project spend routes through
// the renderer confirm card (createHybridGateway) and cannot complete without a human click, whereas the
// headless stdio server routes spend through elicitation → makeConfirmedGateway (mcpStdioServer.ts:99).
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { withLinuxNoSandbox, withLinuxSyntheticCredentialStorage } from './_launchApp.mjs'

const require = createRequire(import.meta.url)
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Per-kind default node sizes, imported from the BUILT production table (compiled CommonJS) rather than
// hand-copied — so the AABB-overlap check in mcp-journey automatically covers whatever kinds production
// defines, and can never silently drift from electron/capabilityCore/nodeKindDomain.ts. The harness
// already requires a fresh dist-electron (assertBuilt), so this compiled module is guaranteed present.
export const NODE_KIND_DEFAULT_SIZE =
  require(path.join(repoRoot, 'dist-electron/capabilityCore/nodeKindDomain.js')).NODE_KIND_DEFAULT_SIZE
// Extreme fallback size (theoretically unreachable; only guards an illegal kind slipping in). Mirrors the
// FALLBACK_SIZE the built module falls back to for unknown kinds.
export const NODE_KIND_FALLBACK_SIZE = { width: 340, height: 280 }

/** Assert dist-electron is built (the stdio server runs compiled JS, mirroring _launchApp.assertBuilt). */
export function assertBuilt() {
  const mainEntry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).main
  const entryPath = path.join(repoRoot, mainEntry)
  if (!fs.existsSync(entryPath)) {
    throw new Error(
      `Electron main entry missing: ${mainEntry}\n→ the MCP stdio server runs the dist-electron build, run: pnpm run build`,
    )
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A tiny loopback "vendor" HTTP server. runTask's no-mapping fallback POSTs to
 * `{baseUrl}/v1/images/generations` and `{baseUrl}/v1/videos/generations` (runtime.ts). We answer with an
 * OpenAI-images-shaped body carrying a `data:` URL, so the REAL request pipeline (requestJson → fetch) and
 * REAL asset store (importRemoteAsset decodes the data URL → writeAsset → nomi-local:// asset) both run,
 * with zero provider quota. The image is a real, decodable PNG so T2's nativeImage thumbnail block fires.
 *
 * Returns { origin, url(s hit), close }. Records every request for assertion/debugging.
 */
export async function startMockVendorServer() {
  const http = await import('node:http')
  const hits = []
  // A real 16x16 opaque PNG (deterministic bytes) — decodable by nativeImage.createFromBuffer so the
  // thumbnail enrichment can resize + re-encode it to a JPEG image content block.
  const pngBytes = buildTinyPng()
  const pngDataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      hits.push({ url: req.url, method: req.method, body })

      // W1 shot-verify judge: streamTextTask POSTs here for kind:image_to_prompt (billed as text → returns
      // BEFORE any spend grant in runtime.ts, zero generation quota). AI SDK defaults to SSE (body.stream);
      // reply with an event-stream carrying a score JSON. Route by the injected marker: low identity when the
      // shot prompt (echoed into the judge prompt) contains BAD_SHOT_MARKER, all-5 otherwise. SSE frame shape
      // copied from the already-verified local-gateway-onboarding.walk.mjs.
      if (typeof req.url === 'string' && req.url.startsWith('/v1/chat/completions')) {
        let parsed = {}
        try { parsed = body ? JSON.parse(body) : {} } catch { parsed = {} }
        const messagesText = JSON.stringify(parsed.messages || [])
        const bad = messagesText.includes(BAD_SHOT_MARKER)
        const verdict = bad
          ? '{"scores":{"identity":1,"composition":5,"continuity":5},"reason":"注入的坏镜：主体身份对不上(换人换装)"}'
          : '{"scores":{"identity":5,"composition":5,"continuity":5},"reason":"三轴达标"}'
        if (parsed.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
          const id = 'chatcmpl-mock-judge'
          const model = parsed.model || 'nomi-mock-judge'
          const frame = (delta, finish) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
          res.write(frame({ role: 'assistant', content: '' }, null))
          res.write(frame({ content: verdict }, null))
          res.write(frame({}, 'stop'))
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        const payload = JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: parsed.model, choices: [{ index: 0, message: { role: 'assistant', content: verdict }, finish_reason: 'stop' }] })
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
        res.end(payload)
        return
      }

      // Image + video both resolve to the same tiny PNG data URL. Video's fallback localizer sets
      // thumbnailUrl:null (runtime.localizeTaskAsset), so the video result legitimately carries no image
      // block — exactly T2's "video may omit" rule; the harness asserts images strictly, video loosely.
      const payload = JSON.stringify({ created: Date.now(), data: [{ url: pngDataUrl }] })
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
      res.end(payload)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** Deterministic minimal PNG (16x16, single IDAT, solid teal). Hand-built so no asset file is needed. */
function buildTinyPng() {
  const zlib = require('node:zlib')
  const width = 16
  const height = 16
  // Raw RGBA scanlines, each prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 4
      raw[p] = 32 // R
      raw[p + 1] = 160 // G
      raw[p + 2] = 160 // B
      raw[p + 3] = 255 // A
    }
  }
  const idat = zlib.deflateSync(raw)
  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type, 'ascii')
    const lenBuf = Buffer.alloc(4)
    lenBuf.writeUInt32BE(data.length, 0)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0)
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff]
  return crc ^ -1
}

/**
 * Write an ISOLATED synthetic model catalog into settingsDir/model-catalog.json.
 * Shapes it for J-MCP1 step (e): a usable no-key mock vendor (authType none → keyStatus ok) exposing an
 * image and a video model, PLUS a real no-key vendor kept enabled so nomi_read(target=models) must flag it
 * not-usable (keyStatus missing) rather than hide it. Each media row carries explicit verified publication
 * evidence, matching the production catalog invariant; mockOrigin points the mock vendor at the loopback
 * server so runTask's fallback path reaches it.
 *
 * W1 (draft-journey 幕 5b/6): also exposes a TEXT model `nomi-mock-judge` on the mock vendor so the
 * headless shot-verify judge (resolveOnboardingAgentFromCatalog → first usable text model → streamTextTask
 * → POST {baseUrl}/v1/chat/completions) resolves and runs end-to-end at zero quota. Auth-free local gateways
 * do not require a credential; the mock server ignores auth. PRODUCTION and L2 run the SAME code — the only difference is
 * that catalog text model points at the mock server; there is no env branch and no `if (test)` in the
 * judge path (P1: zero escape hatch). The mock's /v1/chat/completions returns a controllable score JSON
 * (low when the shot prompt carries the injected BAD_SHOT_MARKER, all-5 otherwise) — see startMockVendorServer.
 */
export function writeIsolatedCatalog(settingsDir, mockOrigin) {
  const now = new Date().toISOString()
  const catalog = {
    version: 3,
    vendors: [
      {
        key: 'nomi-mock', name: 'Nomi Mock Vendor', enabled: true,
        baseUrlHint: mockOrigin, authType: 'none', providerKind: 'openai-compatible',
        createdAt: now, updatedAt: now,
      },
      {
        // A real no-key vendor left enabled on purpose: list_models must say "missing key", not hide it.
        key: 'apimart', name: 'APImart', enabled: true,
        baseUrlHint: 'https://api.apimart.ai', authType: 'bearer', authHeader: 'Authorization',
        providerKind: 'openai-compatible', createdAt: now, updatedAt: now,
      },
    ],
    models: [
      { modelKey: 'nomi-mock-image', vendorKey: 'nomi-mock', labelZh: 'Mock 图片', kind: 'image', enabled: true, meta: { adapter: { state: 'verified', activeRevision: 'fixture-image-v1', modes: [{ taskKind: 'text_to_image', state: 'verified' }], updatedAt: now } }, createdAt: now, updatedAt: now },
      { modelKey: 'nomi-mock-video', vendorKey: 'nomi-mock', labelZh: 'Mock 视频', kind: 'video', enabled: true, meta: { adapter: { state: 'verified', activeRevision: 'fixture-video-v1', modes: [{ taskKind: 'text_to_video', state: 'verified' }, { taskKind: 'image_to_video', state: 'verified' }], updatedAt: now } }, createdAt: now, updatedAt: now },
      // W1 judge model: the FIRST usable text model → resolveOnboardingAgentFromCatalog picks it for shot-verify.
      { modelKey: 'nomi-mock-judge', vendorKey: 'nomi-mock', labelZh: 'Mock 审片', kind: 'text', enabled: true, meta: { adapter: { state: 'verified', activeRevision: 'fixture-judge-v1', modes: [{ taskKind: 'chat', state: 'verified' }], updatedAt: now } }, createdAt: now, updatedAt: now },
      { modelKey: 'apimart-image-nokey', vendorKey: 'apimart', labelZh: 'APImart 图片(无Key)', kind: 'image', enabled: true, meta: { adapter: { state: 'verified', activeRevision: 'fixture-apimart-v1', modes: [{ taskKind: 'text_to_image', state: 'verified' }], updatedAt: now } }, createdAt: now, updatedAt: now },
    ],
    mappings: [],
    // No credential material is needed for the auth-free mock gateway. Keeping
    // this object empty also ensures the fixture cannot exercise legacy plaintext
    // execution by accident.
    apiKeysByVendor: {},
  }
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify(catalog), 'utf8')
}

/**
 * Marker embedded in an injected "bad shot" prompt (W1 幕 5b). ASCII so sanitizeForBroadCompat leaves it
 * intact through streamTextTask. The mock judge returns a low identity score whenever it sees this marker in
 * the request messages → shot-verify triggers targeted retry. Because regenerate re-sends the SAME base
 * prompt (still carrying the marker), the mock keeps scoring it low → K=2 exhausted → red-flagged delivery.
 */
export const BAD_SHOT_MARKER = '#BADSHOT'

/**
 * Seed a verified MCP client identity for an isolated capability dir: ensure the capability-core
 * bearer token exists (the headless stdio server never mints one — only the GUI app's ensureToken
 * does), then derive the same HMAC proof `signMcpClient` computes (security.ts:139-146,
 * context `nomi-mcp-client:v1:<client>`). Returns the env pair the startup gate
 * (mcpStdioProjectSessionBinding.ts:21-24, since M1 round-2 0b6441c6) requires — without it every
 * journey dies at initialize with "A verified MCP client connection is required" (audit E-02,
 * docs/research/2026-09-02-mcp-editing-chain-audit.md). Never overwrites an existing token, so
 * journeys sharing the capability dir with a live GUI instance keep the GUI-minted token.
 */
export function seedMcpClientIdentityEnv(capabilityDir, client = 'claude') {
  const tokenPath = path.join(capabilityDir, 'token')
  let token = ''
  try { token = fs.readFileSync(tokenPath, 'utf8').trim() } catch { /* not seeded yet */ }
  if (!token) {
    token = crypto.randomBytes(24).toString('hex')
    fs.mkdirSync(capabilityDir, { recursive: true })
    fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 })
  }
  const proof = crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
  return { NOMI_MCP_CLIENT: client, NOMI_MCP_CLIENT_PROOF: proof }
}

/**
 * Spawn the real in-Electron MCP stdio server (headless) and return a JSON-RPC client.
 * The client:
 *   · declares the given `capabilities` at initialize (default: elicitation, so plan/spend confirmations
 *     route to chat; the Production-Run sibling passes the io.modelcontextprotocol/ui extension instead), and
 *   · attaches _meta.progressToken on long calls (so notifications/progress frames are emitted),
 *   · auto-accepts every server→client elicitation/create (records elicitationUsed), and
 *   · buffers notifications/progress per progressToken (records progressNotifs).
 *
 * env is fully isolated: caller passes settingsDir / userDataDir / projectsDir / capabilityDir, plus an
 * optional `env` bag merged over the base isolation env (the sibling adds NOMI_E2E_PRODUCTION_FIXTURE).
 * The base env always carries a verified client identity (seedMcpClientIdentityEnv, default 'claude') —
 * the production binding refuses to start without one — and the `env` bag can override the pair for
 * journeys that pin a different registered client (both mcp-generation journeys pin 'codex').
 * NOMI_LOOP_SPEND_OK is intentionally NOT set — spend must flow through elicitation → makeConfirmedGateway,
 * proving the headless zero-dialog spend path (mcpStdioServer.ts:99), not an env escape hatch.
 */
export function spawnMcpStdioClient({
  settingsDir, userDataDir, projectsDir, capabilityDir, clientInfo, capabilities, env, captureStderr = false,
  tracePath, elicitationAction = 'accept', syntheticCredentialStorage = false,
}) {
  const child = spawn(require('electron'), withLinuxSyntheticCredentialStorage(
    withLinuxNoSandbox([repoRoot, '--disable-gpu']), syntheticCredentialStorage,
  ), {
    cwd: repoRoot,
    env: {
      ...process.env,
      NOMI_E2E: '1',
      NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
      NOMI_MCP_STDIO: '1',
      NOMI_SETTINGS_DIR: settingsDir,
      NOMI_ELECTRON_USER_DATA_DIR: userDataDir,
      NOMI_PROJECTS_DIR: projectsDir,
      NOMI_CAPABILITY_DIR: capabilityDir,
      ...(syntheticCredentialStorage ? { NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE: '1' } : {}),
      ...seedMcpClientIdentityEnv(capabilityDir),
      ...(env || {}),
    },
    stdio: ['pipe', 'pipe', captureStderr ? 'pipe' : 'inherit'],
  })

  const pending = new Map()
  let seq = 0
  // Progress frames observed per progressToken (token → count). elicitation acceptance counter.
  const progressByToken = new Map()
  let elicitationCount = 0
  let childExit = null
  let stderrText = ''
  const messages = []
  if (tracePath) {
    fs.mkdirSync(path.dirname(tracePath), { recursive: true })
    fs.writeFileSync(tracePath, '', 'utf8')
  }
  function trace(direction, frame) {
    if (!tracePath) return
    fs.appendFileSync(tracePath, `${JSON.stringify({ at: new Date().toISOString(), direction, frame })}\n`, 'utf8')
  }

  // Transport died (spawn error or the child exited) → reject every in-flight RPC instead of leaving it to
  // time out. This is why pending stores `reject` alongside `resolve`/`timer`.
  function failPending(error) {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      pending.delete(id)
      entry.reject(error)
    }
  }
  child.on('error', (error) => { failPending(error instanceof Error ? error : new Error(String(error))) })
  child.on('exit', (code, signal) => {
    childExit = { code, signal }
    failPending(new Error(`MCP stdio server exited: code=${code} signal=${signal}`))
  })
  if (captureStderr) child.stderr.on('data', (chunk) => { stderrText += String(chunk) })

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const text = line.trim()
    if (!text.startsWith('{')) return
    let msg
    try { msg = JSON.parse(text) } catch { return }
    messages.push(msg)
    trace('in', msg)
    // Server→client request: elicitation/create → auto-accept (headless test authorization).
    if (msg.method === 'elicitation/create' && msg.id != null) {
      elicitationCount += 1
      const result = elicitationAction === 'decline'
        ? { action: 'decline', content: { confirm: false } }
        : { action: 'accept', content: { confirm: true } }
      const frame = { jsonrpc: '2.0', id: msg.id, result }
      trace('out', frame)
      child.stdin.write(JSON.stringify(frame) + '\n')
      return
    }
    // Server→client notification: progress frame → tally per token.
    if (msg.method === 'notifications/progress' && msg.params) {
      const token = String(msg.params.progressToken)
      progressByToken.set(token, (progressByToken.get(token) || 0) + 1)
      return
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, timer } = pending.get(msg.id)
      clearTimeout(timer)
      pending.delete(msg.id)
      resolve(msg)
    }
  })

  function rpc(method, params, timeoutMs = 30_000, meta) {
    const id = (seq += 1)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)) }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      const outParams = meta ? { ...params, _meta: meta } : params
      const frame = { jsonrpc: '2.0', id, method, params: outParams }
      trace('out', frame)
      child.stdin.write(JSON.stringify(frame) + '\n')
    })
  }

  function notify(method, params = {}) {
    const frame = { jsonrpc: '2.0', method, params }
    trace('out', frame)
    child.stdin.write(`${JSON.stringify(frame)}\n`)
  }

  function nextRequestId() { return seq + 1 }

  /**
   * Call a tool. If progressToken given, attach it under _meta so the server emits notifications/progress.
   * Returns the raw CallToolResult (content[] + structuredContent + isError). Throws on the JSON-RPC
   * protocol error only — an application-level isError result is returned as-is so callers can inspect it
   * (parseToolResult reads .isError). Use callToolOrThrow when a tool-level isError should also throw.
   */
  async function callTool(name, args, { timeoutMs = 60_000, progressToken } = {}) {
    const meta = progressToken != null ? { progressToken } : undefined
    const response = await rpc('tools/call', { name, arguments: args }, timeoutMs, meta)
    if (response?.error) {
      const err = new Error(response.error.message || JSON.stringify(response.error))
      err.rpcError = response.error
      throw err
    }
    return response.result
  }

  /**
   * Call a tool and throw on EITHER a JSON-RPC protocol error OR a tool-level isError result (unwrapping
   * the first text block as the message). This is the strict shape the Production-Run sibling needs: any
   * failure aborts the journey rather than flowing a bad result forward.
   */
  async function callToolOrThrow(name, args, options) {
    const result = await callTool(name, args, options)
    if (result?.isError) {
      const text = Array.isArray(result.content)
        ? result.content.find((block) => block?.type === 'text')?.text
        : undefined
      throw new Error(text || `MCP ${name} failed`)
    }
    return result
  }

  async function initialize(timeoutMs = 4_000) {
    return rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: capabilities || { elicitation: {} },
      clientInfo: clientInfo || { name: 'Claude Code', version: 'jmcp1-e2e' },
    }, timeoutMs)
  }

  async function terminate(graceMs = 2_000) {
    try { child.stdin.end() } catch { /* already closed */ }
    if (child.exitCode !== null || child.signalCode !== null) return
    try { child.kill('SIGTERM') } catch { /* best effort */ }
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(graceMs),
    ])
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL') } catch { /* best effort */ }
    }
  }

  // Drop only the transport pipe so the server's stdin-close cancellation path
  // is exercised; terminate() additionally sends SIGTERM.
  function disconnect() {
    try { child.stdin.end() } catch { /* already closed */ }
    if (childExit) return Promise.resolve(childExit)
    return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  }

  return {
    child,
    initialize,
    rpc,
    notify,
    nextRequestId,
    callTool,
    callToolOrThrow,
    terminate,
    disconnect,
    progressForToken: (token) => progressByToken.get(String(token)) || 0,
    elicitationCount: () => elicitationCount,
    childExited: () => childExit,
    stderrText: () => stderrText,
    messages: () => messages.slice(),
  }
}

/** Parse a CallToolResult into the fields J-MCP1 records: parsed JSON (from first text block if JSON), image-block count, deep link. */
export function parseToolResult(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  const textBlock = content.find((block) => block?.type === 'text')
  const imageBlocks = content.filter((block) => block?.type === 'image' && typeof block.data === 'string' && block.data).length
  let json = null
  if (textBlock && typeof textBlock.text === 'string') {
    // Generate/read results embed JSON in the text; try direct parse, else the first {...} slice.
    // Assumes the embedded object is the outermost/only brace pair (prose may wrap it, but not a second
    // sibling JSON object) — true for every tool result these journeys read.
    try { json = JSON.parse(textBlock.text) } catch {
      const start = textBlock.text.indexOf('{')
      const end = textBlock.text.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try { json = JSON.parse(textBlock.text.slice(start, end + 1)) } catch { json = null }
      }
    }
  }
  const outcome = result?.structuredContent?.nomiOutcome || result?.structuredContent?.nomiRunData || {}
  const deepLink = typeof outcome.openInNomi === 'string' && outcome.openInNomi
    ? outcome.openInNomi
    : (typeof outcome.nomiUri === 'string' && outcome.nomiUri ? outcome.nomiUri : null)
  // outcome = the stable structured field (e.g. list_models entries live in nomiOutcome.models, not the
  // human-readable text block); callers that need structured data read it here rather than parsing prose.
  return { json, outcome, imageBlocks, deepLink, isError: Boolean(result?.isError), text: textBlock?.text || '' }
}

/** Make an isolated temp root with the four sandbox dirs J-MCP1 needs. */
export function makeIsolatedDirs(prefix = 'nomi-mcp-journey-') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const dirs = {
    tempRoot,
    settingsDir: tempRoot,
    userDataDir: path.join(tempRoot, 'user-data'),
    projectsDir: path.join(tempRoot, 'projects'),
    capabilityDir: path.join(tempRoot, 'capability'),
  }
  for (const dir of [dirs.userDataDir, dirs.projectsDir, dirs.capabilityDir]) fs.mkdirSync(dir, { recursive: true })
  return dirs
}
