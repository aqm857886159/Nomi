// Cross-process J1 fixture: the agent owns the MCP steps, while credentials and
// spend confirmation cross only Nomi's trusted renderer IPC boundary.
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  assert,
  assertNoCredentialMaterial,
  makeIsolatedRoot,
  parseToolResult,
  repoRoot,
  spawnModelIntegrationMcp,
} from './_modelIntegrationHarness.mjs'
import { launchNomiApp } from './_launchApp.mjs'

const require = createRequire(import.meta.url)

function silentWave() {
  const sampleRate = 8_000
  const samples = 800
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  return bytes
}

async function startProvider() {
  const requests = []
  const wave = silentWave()
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url })
    if (request.method === 'GET' && (request.url === '/v1/models' || request.url === '/models')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'tts-journey-audio' }] }))
      return
    }
    if (request.method === 'POST' && request.url === '/v1/audio/speech') {
      response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wave.length })
      response.end(wave)
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'not found' } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object', 'fixture provider bound a local port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function devRuntime() {
  const command = require('electron')
  const compiledEntry = path.join(repoRoot, 'dist-electron', 'main.js')
  assert(fs.existsSync(compiledEntry), `compiled Electron entry missing: ${compiledEntry}`)
  return { command, args: [compiledEntry, '--disable-gpu'], packaged: false, executablePath: command }
}

async function withMcp(dirs, runtime, run) {
  const client = spawnModelIntegrationMcp({ dirs, client: 'codex', signed: true, runtime })
  try {
    await client.initialize()
    return await run(client)
  } finally {
    await client.terminate()
  }
}

async function withTrustedRenderer(dirs, run) {
  const app = await launchNomiApp({
    name: 'model-integration-trusted-audio',
    tempRoot: dirs.tempRoot,
    userDataDir: dirs.userDataDir,
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    capabilityDir: dirs.capabilityDir,
    settleMs: 300,
  })
  try {
    return await run(app.win)
  } finally {
    await app.close()
  }
}

async function run() {
  const dirs = makeIsolatedRoot('nomi-model-integration-trusted-audio-')
  const provider = await startProvider()
  const runtime = devRuntime()
  let sessionId = ''
  let revision = 0
  try {
    await withMcp(dirs, runtime, async (mcp) => {
      const begin = parseToolResult(await mcp.callTool('nomi_integration', {
        action: 'begin',
        kind: 'http-api-provider',
        name: 'Trusted audio journey',
        baseUrl: provider.baseUrl,
        providerKind: 'openai-compatible',
        authType: 'bearer',
        clientRequestId: 'trusted-audio-j1',
      }))
      assert(!begin.isError && begin.json?.stage === 'needs_credential', 'MCP creates an unverified audio session')
      sessionId = begin.json.id
      revision = begin.json.revision
      const handoff = parseToolResult(await mcp.callTool('nomi_integration', {
        action: 'open_credentials',
        sessionId,
        expectedRevision: revision,
      }))
      assert(!handoff.isError && handoff.json?.stage === 'needs_credential', 'MCP requests the credential handoff')
    })

    await withTrustedRenderer(dirs, async (win) => {
      const saved = await win.evaluate(async ({ id }) => {
        const onboarding = window.nomiDesktop?.onboarding
        const current = await onboarding?.integrationSessionGet?.(id)
        const revision = Number(current?.revision)
        const result = await onboarding?.integrationSessionSaveCredential?.({
          sessionId: id,
          expectedRevision: revision,
          apiKey: 'isolated-fixture-key',
        })
        return result
      }, { id: sessionId })
      assert(saved?.credentialStatus === 'ready' && saved?.stage === 'draft', 'trusted renderer stores the credential')
      assertNoCredentialMaterial(saved, 'trusted credential projection')
    })

    await withMcp(dirs, runtime, async (mcp) => {
      const current = parseToolResult(await mcp.callTool('nomi_read', { target: 'integration', sessionId }))
      const proposed = parseToolResult(await mcp.callTool('nomi_integration', {
        action: 'propose',
        sessionId,
        expectedRevision: current.json.revision,
        proposal: {
          candidates: [{ modelKey: 'tts-journey-audio', kind: 'audio', evidence: ['docs', 'manual'], classification: 'supported' }],
          selections: [{ modelKey: 'tts-journey-audio' }],
        },
      }))
      assert(!proposed.isError && proposed.json?.stage === 'ready_to_certify', `MCP accepts the audio proposal: ${proposed.text}`)
    })

    // 接模型没有付费验证，也就没有花费确认：可信 UI 这一跳整个不存在了（2026-09-12 拍板）。
    // 外部宿主提完方案直接 start——这正是旧版本走不通的那一步。
    //
    // 先证一件**反面**的事：这条会话归 codex 所有，Nomi 窗口里就不该冒出要人点的交接单。
    // 冒出来 = 在 Nomi 里放了一个按下去必然 integration_owner_mismatch 的按钮
    // （会话服务只对 ownerClientId === 'nomi' 发这张单）。它会静默退化，所以钉在这里。
    await withTrustedRenderer(dirs, async (win) => {
      const handoffs = await win.evaluate(
        async () => (await window.nomiDesktop?.onboarding?.integrationHandoffList?.()) || [],
      )
      const mine = handoffs.filter((item) => item.sessionId === sessionId)
      const verification = mine.filter((item) => item.target === 'verification')
      // 阳性对照：这条会话确实有交接单（凭据那张），所以「没有 verification」不是因为列表恒空。
      if (mine.length === 0) throw new Error('handoff list returned nothing for this session — the probe itself is dead')
      if (verification.length > 0)
        throw new Error(`external session must not queue a Nomi-side confirmation: ${JSON.stringify(verification)}`)
    })

    await withMcp(dirs, runtime, async (mcp) => {
      const ready = parseToolResult(await mcp.callTool('nomi_read', { target: 'integration', sessionId }))
      assert(ready.json?.stage === 'ready_to_certify', `session waits for start, not for a person: ${ready.text}`)
      assertNoCredentialMaterial(ready.json, 'ready-to-certify projection')
      let state = parseToolResult(await mcp.callTool('nomi_integration', {
        action: 'start',
        sessionId,
        expectedRevision: ready.json.revision,
        idempotencyKey: 'trusted-audio-certification',
      }, 60_000))
      assert(
        !state.isError && (state.json?.stage === 'certifying' || state.json?.stage === 'completed'),
        `certification starts without a false terminal failure: ${state.text}`,
      )
      const deadline = Date.now() + 30_000
      while (state.json?.stage === 'certifying' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        state = parseToolResult(await mcp.callTool('nomi_read', { target: 'integration', sessionId }))
      }
      let adapterEvidence = null
      try {
        const stored = JSON.parse(fs.readFileSync(path.join(dirs.settingsDir, 'provider-adapters.json'), 'utf8'))
        const run = stored.runs?.find((item) => item.id === state.json?.childRunRef?.runId)
        adapterEvidence = run
          ? {
              stage: run.stage,
              error: run.error,
              models: run.models?.map((model) => ({
                modelKey: model.modelKey,
                modes: model.modes?.map((mode) => ({
                  taskKind: mode.taskKind,
                  state: mode.state,
                  stage: mode.stage,
                  error: mode.error,
                  reasonCode: mode.reasonCode,
                  errorParams: mode.errorParams,
                })),
              })),
            }
          : null
      } catch {
        adapterEvidence = null
      }
      assert(
        state.json?.stage === 'completed',
        `audio certification completes: ${state.text}; adapter=${JSON.stringify(adapterEvidence)}; requests=${JSON.stringify(provider.requests)}; stderr=${JSON.stringify(mcp.stderr())}`,
      )
      const models = parseToolResult(await mcp.callTool('nomi_read', { target: 'models' }))
      const promoted = models.outcome?.models?.find((item) => item.modelKey === 'tts-journey-audio')
        || models.json?.models?.find((item) => item.modelKey === 'tts-journey-audio')
      assert(promoted?.kind === 'audio' && promoted?.keyStatus === 'ok', 'promoted audio model appears in the ordinary usable picker contract')
      assertNoCredentialMaterial({ state: state.json, promoted }, 'completed MCP journey')
    })

    const audioCreates = provider.requests.filter((item) => item.method === 'POST' && item.path === '/v1/audio/speech')
    assert(audioCreates.length === 1, 'canonical certification creates exactly one audio request')
    console.log('MODEL INTEGRATION TRUSTED AUDIO PASS: MCP -> trusted renderer -> certification -> ordinary model list')
  } finally {
    await provider.close().catch(() => undefined)
    fs.rmSync(dirs.tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
